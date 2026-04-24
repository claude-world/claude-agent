import { Router } from "express";
import { validate as validateCron } from "node-cron";
import store from "../db.ts";
import scheduler from "../scheduler.ts";

function isValidTimezone(timezone: unknown): boolean {
  if (timezone === undefined || timezone === null) return true;
  if (typeof timezone !== "string" || !timezone.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function createScheduledTasksRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      res.json(store.listScheduledTasks());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/", (req, res) => {
    try {
      const { name, prompt, agent, schedule, timezone } = req.body ?? {};
      if (!name || !prompt || !schedule) {
        return res.status(400).json({ error: "name, prompt, and schedule required" });
      }
      if (!validateCron(schedule)) {
        return res.status(400).json({ error: "Invalid cron expression" });
      }
      if (!isValidTimezone(timezone)) {
        return res.status(400).json({ error: "Invalid timezone. Use IANA format (e.g. Asia/Taipei)" });
      }
      const task = store.createScheduledTask({ name, prompt, agent, schedule, timezone });
      if (task.enabled) scheduler.registerJob(task.id);
      res.status(201).json(task);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/:id", (req, res) => {
    try {
      const { schedule, timezone } = req.body ?? {};
      if (schedule && !validateCron(schedule)) {
        return res.status(400).json({ error: "Invalid cron expression" });
      }
      if (timezone !== undefined && !isValidTimezone(timezone)) {
        return res.status(400).json({ error: "Invalid timezone. Use IANA format (e.g. Asia/Taipei)" });
      }
      const task = store.updateScheduledTask(req.params.id, req.body ?? {});
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (task.enabled) {
        scheduler.registerJob(task.id);
      } else {
        scheduler.unregisterJob(task.id);
      }
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      scheduler.unregisterJob(req.params.id);
      const ok = store.deleteScheduledTask(req.params.id);
      if (!ok) return res.status(404).json({ error: "Task not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch("/:id/toggle", (req, res) => {
    try {
      const { enabled } = req.body ?? {};
      if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled (boolean) required" });
      const task = store.toggleScheduledTask(req.params.id, enabled);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (enabled) {
        scheduler.registerJob(task.id);
      } else {
        scheduler.unregisterJob(task.id);
      }
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/:id/run", async (req, res) => {
    try {
      const task = store.getScheduledTask(req.params.id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      scheduler.executeTask(req.params.id, "manual").catch((err) => {
        console.error(`[Scheduler] Manual trigger error for ${req.params.id}:`, err);
      });
      res.json({ success: true, message: "Task execution started" });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/executions", (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      res.json(store.listTaskExecutions(undefined, limit));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/:id/executions", (req, res) => {
    try {
      const task = store.getScheduledTask(req.params.id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      res.json(store.listTaskExecutions(req.params.id, limit));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
