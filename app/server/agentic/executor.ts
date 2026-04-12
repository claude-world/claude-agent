/**
 * AgenticExecutor — hierarchical multi-agent state machine.
 * States: IDLE → PLANNING → DISPATCHING → RUNNING → AGGREGATING → REFLECTING → DONE
 * Persists state to DB for crash recovery.
 */

import { randomUUID } from "crypto";
import store from "../db.ts";
import { generatePlan } from "./supervisor.ts";
import { executeSpecialist } from "./specialist.ts";
import type { SupervisorPlan, PlanStep } from "./supervisor.ts";
import type { SpecialistResult } from "./specialist.ts";
import type { SpecialistType, ExecutionMode } from "../executors/types.ts";
import { AgentSession } from "../agent.ts";
import { AGENT_ROOT } from "../paths.ts";

export type ExecutionStatus =
  | "idle" | "planning" | "dispatching" | "running"
  | "aggregating" | "reflecting" | "done" | "error" | "cancelled";

export interface AgenticExecutorEvent {
  type:
    | "status_change"
    | "plan_ready"
    | "step_start"
    | "step_stream"
    | "step_done"
    | "step_error"
    | "aggregation_done"
    | "reflection_done"
    | "execution_done"
    | "execution_error";
  executionId: string;
  status?: ExecutionStatus;
  stepId?: string;
  specialistType?: SpecialistType;
  stepIndex?: number;
  text?: string;
  result?: SpecialistResult;
  plan?: SupervisorPlan;
  finalResult?: string;
  error?: string;
}

const MAX_CONCURRENT_SPECIALISTS = 3; // Prevent API rate limit saturation

export class AgenticExecutor {
  private executionId: string;
  private status: ExecutionStatus = "idle";
  private plan: SupervisorPlan | null = null;
  private completedSteps: SpecialistResult[] = [];
  private eventCallback: ((event: AgenticExecutorEvent) => void) | null = null;
  private cancelled = false;

  constructor(executionId: string) {
    this.executionId = executionId;
  }

  cancel(): void {
    this.cancelled = true;
  }

  onEvent(cb: (event: AgenticExecutorEvent) => void): void {
    this.eventCallback = cb;
  }

  private emit(event: AgenticExecutorEvent): void {
    this.eventCallback?.(event);
  }

  private async setState(status: ExecutionStatus, extra: Partial<{ state_data: string; supervisor_plan: string; result: string; error: string }> = {}): Promise<void> {
    this.status = status;
    store.updateAgentExecution(this.executionId, {
      status,
      state_data: JSON.stringify({ status, plan: this.plan, completedSteps: this.completedSteps.length }),
      ...extra,
    });
    this.emit({ type: "status_change", executionId: this.executionId, status });
  }

  async run(goal: string): Promise<void> {
    try {
      // Phase 1: Planning
      await this.setState("planning");
      if (this.cancelled) { await this.setState("cancelled"); return; }
      this.plan = await generatePlan(goal);
      if (this.cancelled) { await this.setState("cancelled"); return; }
      await this.setState("dispatching", { supervisor_plan: JSON.stringify(this.plan) });
      this.emit({ type: "plan_ready", executionId: this.executionId, plan: this.plan });

      // Phase 2: Dispatching + Running
      await this.setState("running");
      this.completedSteps = await this.executeSteps(this.plan);
      if (this.cancelled) { await this.setState("cancelled"); return; }

      // Phase 3: Aggregating
      await this.setState("aggregating");
      const aggregated = await this.aggregate(goal, this.completedSteps);
      if (this.cancelled) { await this.setState("cancelled"); return; }

      // Phase 4: Reflecting
      await this.setState("reflecting");
      const finalResult = await this.reflect(goal, aggregated);
      if (this.cancelled) { await this.setState("cancelled"); return; }

      // Done
      const totalCost = this.completedSteps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
      if (this.cancelled) { await this.setState("cancelled"); return; }
      store.updateAgentExecution(this.executionId, {
        status: "done",
        result: finalResult,
        cost_usd: totalCost,
      });
      // setState also calls updateAgentExecution; COALESCE ensures the result/cost written above
      // are preserved (null fields from setState don't overwrite existing values)
      await this.setState("done");
      this.emit({ type: "execution_done", executionId: this.executionId, finalResult });

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      store.updateAgentExecution(this.executionId, { status: "error", error: errorMsg });
      await this.setState("error", { error: errorMsg });
      this.emit({ type: "execution_error", executionId: this.executionId, error: errorMsg });
    }
  }

  private async executeSteps(plan: SupervisorPlan): Promise<SpecialistResult[]> {
    const results: SpecialistResult[] = [];

    if (plan.mode === "parallel") {
      // Run all independent steps concurrently (with concurrency limit)
      const batches = this.buildParallelBatches(plan.steps);
      for (const batch of batches) {
        if (this.cancelled) { await this.setState("cancelled"); return results; }
        const batchResults = await this.runBatch(batch, results);
        results.push(...batchResults);
      }
    } else if (plan.mode === "swarm") {
      // All steps are the same specialist — run concurrently
      if (this.cancelled) { await this.setState("cancelled"); return results; }
      const batchResults = await this.runBatch(plan.steps, results);
      results.push(...batchResults);
    } else if (plan.mode === "auto") {
      // Auto: use parallel batches if any steps have dependencies, else run all concurrently
      const hasDeps = plan.steps.some(s => s.dependsOn.length > 0);
      if (hasDeps) {
        const batches = this.buildParallelBatches(plan.steps);
        for (const batch of batches) {
          if (this.cancelled) { await this.setState("cancelled"); return results; }
          const batchResults = await this.runBatch(batch, results);
          results.push(...batchResults);
        }
      } else {
        if (this.cancelled) { await this.setState("cancelled"); return results; }
        const batchResults = await this.runBatch(plan.steps, results);
        results.push(...batchResults);
      }
    } else {
      // Sequential: run one by one
      for (const step of plan.steps) {
        if (this.cancelled) { await this.setState("cancelled"); return results; }
        const result = await this.runSingleStep(step, results);
        results.push(result);
      }
    }

    return results;
  }

  private buildParallelBatches(steps: PlanStep[]): PlanStep[][] {
    // Group steps that can run concurrently
    const batches: PlanStep[][] = [];
    const completed = new Set<number>();

    while (completed.size < steps.length) {
      const ready = steps.filter(s =>
        !completed.has(s.index) &&
        s.dependsOn.every(dep => completed.has(dep))
      );
      if (ready.length === 0) break; // avoid infinite loop on bad plans

      batches.push(ready);
      ready.forEach(s => completed.add(s.index));
    }

    return batches;
  }

  private async runBatch(steps: PlanStep[], previousResults: SpecialistResult[]): Promise<SpecialistResult[]> {
    // Apply concurrency limit using a semaphore-like pattern
    const semaphore = new Semaphore(MAX_CONCURRENT_SPECIALISTS);
    const results = await Promise.allSettled(
      steps.map(step => semaphore.acquire().then(async release => {
        if (this.cancelled) {
          release();
          return { stepId: `cancelled-${randomUUID()}`, stepIndex: step.index, specialistType: step.specialistType, output: '', costUsd: null, durationMs: 0, error: "cancelled" } as SpecialistResult & { stepIndex: number };
        }
        try {
          return await this.runSingleStep(step, previousResults);
        } finally {
          release();
        }
      }))
    );
    return results
      .map((r, idx) => r.status === "fulfilled"
        ? r.value
        : {
            stepId: randomUUID(),
            stepIndex: steps[idx].index,
            specialistType: steps[idx].specialistType,
            output: "",
            costUsd: null,
            durationMs: 0,
            error: String((r as PromiseRejectedResult).reason),
          }
      ) as SpecialistResult[];
  }

  private async runSingleStep(step: PlanStep, previousResults: SpecialistResult[]): Promise<SpecialistResult & { stepIndex: number }> {
    // Create DB record
    const dbStep = store.createExecutionStep({
      execution_id: this.executionId,
      step_index: step.index,
      specialist_type: step.specialistType,
      input: step.input,
    });
    store.updateExecutionStep(dbStep.id, { status: "running" });
    this.emit({ type: "step_start", executionId: this.executionId, stepId: dbStep.id, specialistType: step.specialistType, stepIndex: step.index });

    // Inject previous results context if there are dependencies
    let enrichedInput = step.input;
    if (step.dependsOn.length > 0 && previousResults.length > 0) {
      const depOutputs = previousResults
        .filter(r => step.dependsOn.includes((r as any).stepIndex ?? -1))
        .map(r => `[${r.specialistType}] ${r.output.slice(0, 1000)}`)
        .join("\n\n");
      if (depOutputs) {
        enrichedInput = `Previous specialist outputs:\n${depOutputs}\n\nYour task: ${step.input}`;
      }
    }

    try {
      const result = await executeSpecialist(
        step.specialistType,
        enrichedInput,
        (text) => this.emit({ type: "step_stream", executionId: this.executionId, stepId: dbStep.id, text })
      );
      result.stepId = dbStep.id;

      store.updateExecutionStep(dbStep.id, {
        status: result.error ? "error" : "done",
        output: result.output,
        cost_usd: result.costUsd,
        duration_ms: result.durationMs,
      });

      this.emit({ type: result.error ? "step_error" : "step_done", executionId: this.executionId, stepId: dbStep.id, result });
      return { ...result, stepIndex: step.index };
    } catch (err) {
      // Ensure step always gets a terminal status even on unexpected throws
      try { store.updateExecutionStep(dbStep.id, { status: "error", output: String(err) }); } catch {}
      throw err; // re-throw so runBatch handles it
    }
  }

  private async aggregate(goal: string, results: SpecialistResult[]): Promise<string> {
    if (results.length === 0) return "No results to aggregate.";
    if (results.length === 1) {
      if (results[0].error) return `[Step error: ${results[0].error}]`;
      return results[0].output;
    }

    const sessionId = `aggregator-${randomUUID()}`;
    const session = new AgentSession(sessionId, process.env.AGENT_ROOT || AGENT_ROOT);

    const outputsText = results
      .map((r, i) => `## ${r.specialistType.toUpperCase()} (Step ${i + 1})\n${r.output.slice(0, 2000)}`)
      .join("\n\n---\n\n");

    session.sendMessage(`You are synthesizing results from multiple AI specialists.

Goal: ${goal}

Specialist Outputs:
${outputsText}

Create a comprehensive, coherent final response that:
1. Integrates all specialist perspectives
2. Resolves any contradictions
3. Presents a unified conclusion
4. Includes any important details from each specialist`);

    let aggregated = "";
    try {
      for await (const msg of session.getOutputStream()) {
        if (msg.type === "assistant") {
          const content = msg.message?.content;
          if (typeof content === "string") aggregated += content;
          else if (Array.isArray(content)) {
            aggregated += content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
          }
        }
      }
    } finally {
      session.interrupt();
    }

    this.emit({ type: "aggregation_done", executionId: this.executionId, text: aggregated });
    return aggregated || results.map(r => r.output).join("\n\n");
  }

  private async reflect(goal: string, aggregated: string): Promise<string> {
    // For now, return aggregated result with a brief reflection note
    const reflection = `[Execution complete. Goal: "${goal.slice(0, 80)}"]\n\n${aggregated}`;
    this.emit({ type: "reflection_done", executionId: this.executionId, text: reflection });
    return reflection;
  }
}

/** Simple semaphore for concurrency limiting */
class Semaphore {
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  acquire(): Promise<() => void> {
    return new Promise(resolve => {
      const tryRun = () => {
        if (this.running < this.max) {
          this.running++;
          resolve(() => {
            this.running--;
            const next = this.queue.shift();
            if (next) next();
          });
        } else {
          this.queue.push(tryRun);
        }
      };
      tryRun();
    });
  }
}

/**
 * Registry: manage all active executors, support crash recovery.
 */
export class AgenticExecutorRegistry {
  private static active = new Map<string, AgenticExecutor>();

  static get(id: string): AgenticExecutor | undefined {
    return this.active.get(id);
  }

  static create(executionId: string): AgenticExecutor {
    const executor = new AgenticExecutor(executionId);
    this.active.set(executionId, executor);
    return executor;
  }

  static remove(id: string): void {
    this.active.delete(id);
  }

  private static resuming = false;

  /**
   * Resume any executions that were interrupted (server crash recovery).
   * Resets "running" steps back to "pending" and re-runs the execution.
   */
  static resumeInterrupted(): void {
    if (this.resuming) return;
    this.resuming = true;
    try {
      const pending = store.listPendingAgentExecutions();
      if (pending.length === 0) return;
      console.log(`[AgenticRegistry] Found ${pending.length} interrupted execution(s) — marking as cancelled (no auto-resume)`);
      for (const exec of pending) {
        // Mark as cancelled rather than auto-resuming (to avoid duplicate side effects)
        store.updateAgentExecution(exec.id, { status: "cancelled", error: "Server restarted while execution was in progress" });
        AgenticExecutorRegistry.remove(exec.id); // clear stale in-memory reference
      }
    } catch (err) {
      console.error("[AgenticRegistry] Could not resume interrupted executions:", err);
    } finally {
      this.resuming = false;
    }
  }
}
