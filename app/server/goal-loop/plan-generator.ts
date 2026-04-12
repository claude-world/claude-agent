/**
 * Plan generator — uses Claude to create a DailyActionPlan from user's goals.
 */

import { AgentSession } from "../agent.ts";
import { AGENT_ROOT } from "../paths.ts";
import store from "../db.ts";
import type { GoalEntry } from "../db.ts";
import { DAILY_PLAN_PROMPT } from "./prompts.ts";
import { randomUUID } from "crypto";

/**
 * Sanitize user-controlled text before interpolating into LLM prompts.
 * Removes XML-like closing tags that could break delimiter structure,
 * and caps length to prevent unbounded prompt growth.
 */
function sanitizeForPrompt(text: string): string {
  return text.replace(/<\//g, '< /').slice(0, 500);
}

export interface PlannedTask {
  id: string;
  goalId: string;
  goalTitle: string;
  taskType: "research" | "draft" | "reminder" | "execution";
  prompt: string;
  priority: number;
  status: "pending" | "done" | "skipped";
  result?: string;
}

export interface DailyActionPlan {
  date: string;
  tasks: PlannedTask[];
  insight: string;
  generatedAt: string;
}

export async function generateDailyPlan(): Promise<DailyActionPlan> {
  const goals = store.listGoals();
  if (goals.length === 0) {
    return {
      date: new Date().toISOString().split("T")[0],
      tasks: [],
      insight: "No active goals found. Add goals to get personalized daily plans.",
      generatedAt: new Date().toISOString(),
    };
  }

  const goalsSummary = goals.map(g => {
    const doneMilestones = g.milestones.filter(m => m.done).length;
    const totalMilestones = g.milestones.length;
    return `- ID: ${g.id}
  <title>${sanitizeForPrompt(g.title.slice(0, 200))}</title>
  <description>${sanitizeForPrompt((g.description || "(no description)").slice(0, 1000))}</description>
  Priority: ${["low", "medium", "high"][g.priority - 1] || "medium"}
  Progress: ${doneMilestones}/${totalMilestones} milestones done
  <tags>${sanitizeForPrompt(g.tags.join(", ") || "none")}</tags>`;
  }).join("\n\n");

  const today = new Date().toISOString().split("T")[0];

  const sessionId = `goal-planner-${randomUUID()}`;
  const session = new AgentSession(sessionId, process.env.AGENT_ROOT || AGENT_ROOT);

  session.sendMessage(`${DAILY_PLAN_PROMPT}

Today's date: ${today}

Active Goals:
${goalsSummary}`);

  let rawOutput = "";
  try {
    for await (const msg of session.getOutputStream()) {
      if (msg.type === "assistant") {
        const content = msg.message?.content;
        if (typeof content === "string") rawOutput += content;
        else if (Array.isArray(content)) {
          rawOutput += content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        }
      }
    }
  } finally {
    session.interrupt();
  }

  return parsePlan(rawOutput, goals, today);
}

/**
 * Extract the first balanced JSON object from text.
 * String-aware: ignores { } inside string literals (handles escaped chars too).
 */
function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { if (--depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function parsePlan(raw: string, goals: GoalEntry[], today: string): DailyActionPlan {
  const jsonMatch = extractJson(raw);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch);
      const tasks: PlannedTask[] = (parsed.tasks || []).map((t: any) => ({
        id: randomUUID(),
        goalId: String(t.goalId || ""),
        goalTitle: String(t.goalTitle || ""),
        taskType: ["research", "draft", "reminder", "execution"].includes(t.taskType)
          ? t.taskType
          : "research",
        prompt: String(t.prompt || ""),
        priority: typeof t.priority === "number" ? t.priority : 1,
        status: "pending" as const,
      }));

      return {
        date: today,
        tasks,
        insight: String(parsed.insight || ""),
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn("[PlanGenerator] Failed to parse LLM JSON:", err instanceof Error ? err.message : err, "\nRaw:", jsonMatch?.slice(0, 200));
    }
  }

  // Fallback: one generic task per goal
  return {
    date: today,
    tasks: goals.slice(0, 3).map(g => ({
      id: randomUUID(),
      goalId: g.id,
      goalTitle: g.title,
      taskType: "research" as const,
      prompt: `Review progress on goal "${g.title}" and identify the most important next step.`,
      priority: g.priority,
      status: "pending" as const,
    })),
    insight: "Daily plan generated (fallback mode — check AI connectivity)",
    generatedAt: new Date().toISOString(),
  };
}
