import cron from "node-cron";
import { AgentSession, CliSession } from "./agent.ts";
import type { CliType } from "./agent.ts";
import store from "./db.ts";

/**
 * Collects all text output from an AgentSession into a single string.
 * Returns { output, cost_usd } when the session completes or hits an error.
 */
async function collectSessionOutput(
  session: AgentSession
): Promise<{ output: string; cost_usd: number | null }> {
  const parts: string[] = [];
  let cost_usd: number | null = null;

  try {
    for await (const message of session.getOutputStream()) {
      if (message.type === "assistant") {
        const content = message.message?.content;
        if (typeof content === "string") {
          parts.push(content);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              parts.push(block.text);
            }
          }
        }
      } else if (message.type === "result") {
        if (typeof message.total_cost_usd === "number") {
          cost_usd = message.total_cost_usd;
        }
      }
    }
  } catch (err) {
    // If stream ends with an error, rethrow so the caller can record it
    throw err;
  }

  return { output: parts.join("\n"), cost_usd };
}

class TaskScheduler {
  private jobs = new Map<string, cron.ScheduledTask>();
  private inFlight = new Set<string>();

  /**
   * Load all enabled tasks from the database and register cron jobs.
   */
  start() {
    const tasks = store.listScheduledTasks();
    for (const task of tasks) {
      if (task.enabled) {
        this.registerJob(task.id);
      }
    }
    console.log(
      `[Scheduler] Started — ${this.jobs.size} job(s) registered`
    );
  }

  /**
   * Stop all running cron jobs.
   */
  stop() {
    for (const [id, job] of this.jobs) {
      if (typeof (job as any).destroy === 'function') {
        (job as any).destroy();
      } else {
        job.stop();
      }
      console.log(`[Scheduler] Stopped job ${id}`);
    }
    this.jobs.clear();
  }

  /**
   * Register a cron job for the given task id.
   * If a job already exists for this id it is replaced.
   */
  registerJob(taskId: string) {
    // Remove any existing job first
    this.unregisterJob(taskId);

    const task = store.getScheduledTask(taskId);
    if (!task || !task.enabled) return;

    if (!cron.validate(task.schedule)) {
      console.warn(
        `[Scheduler] Invalid cron expression for task ${taskId}: "${task.schedule}"`
      );
      return;
    }

    const job = cron.schedule(
      task.schedule,
      () => {
        // Fire-and-forget; errors are captured inside executeTask
        this.executeTask(taskId, "schedule").catch((err) => {
          console.error(`[Scheduler] Unhandled error in executeTask ${taskId}:`, err);
        });
      },
      {
        timezone: task.timezone || "Asia/Taipei",
      }
    );

    this.jobs.set(taskId, job);
    console.log(
      `[Scheduler] Registered job ${taskId} (${task.name}) schedule="${task.schedule}"`
    );
  }

  /**
   * Stop and remove the cron job for a given task id.
   */
  unregisterJob(taskId: string) {
    const existing = this.jobs.get(taskId);
    if (existing) {
      if (typeof (existing as any).destroy === 'function') {
        (existing as any).destroy();
      } else {
        existing.stop();
      }
      this.jobs.delete(taskId);
      console.log(`[Scheduler] Unregistered job ${taskId}`);
    }
  }

  /**
   * Execute a scheduled task immediately, record an execution entry, and
   * update it when the agent finishes or fails.
   */
  async executeTask(taskId: string, triggeredBy: string = "manual") {
    if (this.inFlight.has(taskId)) {
      console.log(`[Scheduler] Task ${taskId} is already running, skipping`);
      return;
    }
    this.inFlight.add(taskId);

    try {
      const task = store.getScheduledTask(taskId);
      if (!task) {
        console.error(`[Scheduler] Task ${taskId} not found`);
        return;
      }

      const execution = store.createTaskExecution({ task_id: taskId, triggered_by: triggeredBy });
      const startedAt = Date.now();

      console.log(
        `[Scheduler] Executing task ${taskId} (${task.name}), execution ${execution.id}`
      );

      const cli = (task.agent as CliType) || 'claude';

      if (cli !== 'claude') {
        // Use CliSession for non-Claude CLIs
        const cliSession = new CliSession(cli, process.env.AGENT_ROOT || process.cwd());
        try {
          const output = await cliSession.execute(task.prompt);
          const duration_ms = Date.now() - startedAt;
          store.updateTaskExecution(execution.id, {
            status: "success",
            output,
            cost_usd: null,
            duration_ms,
          });
          console.log(
            `[Scheduler] Task ${taskId} (${cli}) completed in ${duration_ms}ms`
          );
        } catch (err) {
          const duration_ms = Date.now() - startedAt;
          const errorMsg = err instanceof Error ? err.message : String(err);
          store.updateTaskExecution(execution.id, {
            status: "error",
            error: errorMsg,
            duration_ms,
          });
          console.error(`[Scheduler] Task ${taskId} (${cli}) failed: ${errorMsg}`);
        }
        return;
      }

      // Each execution gets its own ephemeral AgentSession.
      // We do not persist this session in the sessions table — it's scheduler-internal.
      const session = new AgentSession(`sched-${execution.id}`);
      session.sendMessage(task.prompt);

      try {
        const { output, cost_usd } = await collectSessionOutput(session);
        const duration_ms = Date.now() - startedAt;

        store.updateTaskExecution(execution.id, {
          status: "success",
          output,
          cost_usd,
          duration_ms,
        });

        console.log(
          `[Scheduler] Task ${taskId} completed in ${duration_ms}ms, cost=$${cost_usd ?? 0}`
        );
      } catch (err) {
        const duration_ms = Date.now() - startedAt;
        const errorMsg = err instanceof Error ? err.message : String(err);

        store.updateTaskExecution(execution.id, {
          status: "error",
          error: errorMsg,
          duration_ms,
        });

        console.error(`[Scheduler] Task ${taskId} failed: ${errorMsg}`);
      }
    } finally {
      this.inFlight.delete(taskId);
    }
  }
}

// Singleton instance
export const scheduler = new TaskScheduler();
export default scheduler;
