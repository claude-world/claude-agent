/**
 * GoalLoopEngine — proactive daily goal tracking and execution.
 *
 * Runs on a daily schedule (default: 08:00 Asia/Taipei).
 * Cycle: Reading Goals → Generating Plan → Executing Tasks → Monitoring → Reflecting → Reporting → Idle
 */

import cron, { type ScheduledTask, validate } from "node-cron";
import { AgentSession } from "../agent.ts";
import { AGENT_ROOT } from "../paths.ts";
import store from "../db.ts";
import { generateDailyPlan } from "./plan-generator.ts";
import type { DailyActionPlan, PlannedTask } from "./plan-generator.ts";
import { getProgressSummary } from "./progress-monitor.ts";
import { REFLECTION_PROMPT, PROGRESS_REPORT_TEMPLATE } from "./prompts.ts";
import { randomUUID } from "crypto";

export type GoalLoopStatus =
  | "idle"
  | "reading_goals"
  | "generating_plan"
  | "executing_tasks"
  | "monitoring_progress"
  | "self_reflecting"
  | "reporting";

type DeliveryCallback = (chatId: string, platform: string, text: string) => void;

export class GoalLoopEngine {
  private cronJob: ScheduledTask | null = null;
  private currentStatus: GoalLoopStatus = "idle";
  private deliveryCallback: DeliveryCallback | null = null;
  private isRunning = false;

  setDeliveryCallback(cb: DeliveryCallback): void {
    this.deliveryCallback = cb;
  }

  start(): void {
    const rawSchedule = store.getSetting("goal_loop_schedule") || "0 8 * * *";
    const timezone = store.getSetting("goal_loop_timezone") || "Asia/Taipei";

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    if (!store.listGoals().filter((g: any) => g.status === "active").length) {
      console.log("[GoalLoop] No active goals — engine standing by");
      // Still register the cron so it checks daily
    }

    const schedule = validate(rawSchedule) ? rawSchedule : "0 8 * * *";
    if (rawSchedule !== schedule) {
      console.warn(`[GoalLoop] Invalid cron schedule '${rawSchedule}', using default '0 8 * * *'`);
    }

    this.cronJob = cron.schedule(schedule, () => {
      this.runDailyCycle().catch(err =>
        console.error("[GoalLoop] Daily cycle error:", err)
      );
    }, { timezone });

    console.log(`[GoalLoop] Started with schedule '${schedule}' (${timezone}) [requested: '${rawSchedule}']`);

    // Clear any stale next_run_at (e.g. old cron strings persisted by prior bug).
    // next_run_at is only set to a real ISO timestamp after a cycle completes.
    try {
      const existing = store.getGoalLoopState();
      const val = existing?.next_run_at ?? "";
      if (val && !/^\d{4}-\d{2}-\d{2}/.test(val)) {
        this.updateState("idle", { next_run_at: "" });
      } else {
        this.updateState("idle", {});
      }
    } catch {
      this.updateState("idle", {});
    }
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    console.log("[GoalLoop] Stopped");
  }

  /** Manually trigger a cycle (for testing). */
  async triggerNow(): Promise<void> {
    if (this.isRunning) {
      console.log("[GoalLoop] Cycle already running — skipping manual trigger");
      return;
    }
    await this.runDailyCycle();
  }

  private async runDailyCycle(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[GoalLoop] Starting daily cycle");

    try {
      // Phase 1: Reading Goals
      this.updateState("reading_goals", { last_run_at: new Date().toISOString() });
      const goals = store.listGoals();
      const activeGoals = goals.filter(g => g.status === "active");

      if (activeGoals.length === 0) {
        console.log("[GoalLoop] No active goals — skipping cycle");
        this.updateState("idle", {});
        return;
      }

      // Phase 2: Generating Plan
      this.updateState("generating_plan", {});
      let plan: DailyActionPlan;
      try {
        plan = await generateDailyPlan();
        store.addGoalProgressLog({
          event_type: "plan_generated",
          summary: `Generated plan with ${plan.tasks.length} tasks. Insight: ${plan.insight.slice(0, 200)}`,
        });
      } catch (err) {
        console.error("[GoalLoop] Plan generation failed:", err);
        this.updateState("idle", {});
        return;
      }

      this.updateState("executing_tasks", { current_plan: JSON.stringify(plan) });

      // Phase 3: Executing Tasks (only high-priority or research tasks)
      const executedResults: string[] = [];
      for (const task of plan.tasks.slice(0, 2)) { // max 2 auto-executed tasks
        if (task.taskType === "reminder") {
          executedResults.push(`📌 Reminder: ${task.prompt}`);
          continue;
        }
        try {
          const result = await this.executeTask(task);
          executedResults.push(`✅ ${task.goalTitle}: ${result.slice(0, 300)}`);
          store.addGoalProgressLog({
            goal_id: task.goalId || undefined,
            event_type: "task_executed",
            summary: `Task completed: ${task.prompt.slice(0, 100)}. Result: ${result.slice(0, 200)}`,
          });
        } catch (err) {
          executedResults.push(`⚠️ ${task.goalTitle}: Task failed`);
        }
      }

      // Phase 4: Monitoring Progress
      this.updateState("monitoring_progress", {});
      const progressSummary = getProgressSummary();
      const progressText = progressSummary.map(p =>
        `• ${p.goalTitle}: ${p.percentComplete}% complete (${p.milestonesCompleted}/${p.milestonesTotal} milestones)${p.recentActivity ? " 🔥" : ""}`
      ).join("\n");

      // Phase 5: Self-Reflecting
      this.updateState("self_reflecting", {});
      const reflection = await this.generateReflection(plan, executedResults);
      const notes = store.getGoalLoopState();
      const existingNotes: string[] = [];
      try { existingNotes.push(...JSON.parse(notes?.reflection_notes || "[]")); } catch {}
      existingNotes.push(reflection);
      if (existingNotes.length > 7) existingNotes.shift(); // keep last 7 days

      this.updateState("reporting", { reflection_notes: JSON.stringify(existingNotes) });

      // Phase 6: Reporting
      const report = this.buildReport(plan, executedResults, progressText, reflection);

      const deliveryChatId = store.getSetting("goal_loop_delivery_chat_id");
      const deliveryPlatform = store.getSetting("goal_loop_delivery_platform") || "telegram";

      if (deliveryChatId && this.deliveryCallback) {
        this.deliveryCallback(deliveryChatId, deliveryPlatform, report);
        store.addGoalProgressLog({
          event_type: "reflection",
          summary: `Daily report sent to ${deliveryPlatform}:${deliveryChatId}`,
        });
      } else {
        console.log("[GoalLoop] No delivery configured. Report:\n" + report.slice(0, 500));
      }

    } catch (err) {
      console.error("[GoalLoop] Cycle error:", err);
    } finally {
      this.isRunning = false;
      this.updateState("idle", {});
    }
  }

  private async executeTask(task: PlannedTask): Promise<string> {
    const sessionId = `goal-exec-${randomUUID()}`;
    const session = new AgentSession(sessionId, process.env.AGENT_ROOT || AGENT_ROOT);

    session.sendMessage(task.prompt);

    let output = "";
    try {
      for await (const msg of session.getOutputStream()) {
        if (msg.type === "assistant") {
          const content = msg.message?.content;
          if (typeof content === "string") output += content;
          else if (Array.isArray(content)) {
            output += content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
          }
        }
      }
    } finally {
      session.interrupt();
    }

    return output.slice(0, 1000);
  }

  private async generateReflection(plan: DailyActionPlan, results: string[]): Promise<string> {
    const sessionId = `goal-reflect-${randomUUID()}`;
    const session = new AgentSession(sessionId, process.env.AGENT_ROOT || AGENT_ROOT);

    const context = `${REFLECTION_PROMPT}

Today's plan insight: ${plan.insight}
Tasks executed (${results.length}):
${results.join("\n")}`;

    session.sendMessage(context);

    let reflection = "";
    try {
      for await (const msg of session.getOutputStream()) {
        if (msg.type === "assistant") {
          const content = msg.message?.content;
          if (typeof content === "string") reflection += content;
          else if (Array.isArray(content)) {
            reflection += content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
          }
        }
      }
    } finally {
      session.interrupt();
    }

    return reflection.slice(0, 500) || "Daily cycle complete.";
  }

  private buildReport(plan: DailyActionPlan, results: string[], progressText: string, reflection: string): string {
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const taskSummary = results.length > 0
      ? results.join("\n")
      : "No tasks executed today (no goals or tasks were auto-runnable)";

    return PROGRESS_REPORT_TEMPLATE
      .replace(/\{date\}/g, today)
      .replace(/\{taskSummary\}/g, taskSummary + "\n\n📈 **Goal Progress**\n" + (progressText || "No goals tracked yet."))
      .replace(/\{reflection\}/g, reflection || "No reflection generated.")
      .replace(/\{tomorrowFocus\}/g, plan.tasks.length > 0 ? plan.tasks.slice(0, 2).map(t => `• ${t.goalTitle}: ${t.prompt.slice(0, 80)}`).join("\n") : "Continue current goals.");
  }

  private updateState(status: GoalLoopStatus, extra: Partial<{
    current_plan: string;
    last_run_at: string;
    next_run_at: string;
    reflection_notes: string;
  }>): void {
    this.currentStatus = status;
    try {
      store.setGoalLoopState({ status, ...extra });
    } catch {}
  }

  get status(): GoalLoopStatus {
    return this.currentStatus;
  }
}

// Singleton
export const goalLoop = new GoalLoopEngine();
