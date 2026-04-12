/**
 * Goal management routes — CRUD for proactive goal entries.
 */

import { Router } from "express";
import { validate as validateCron } from "node-cron";
import store from "../db.ts";
import { goalLoop } from "../goal-loop/engine.ts";

const VALID_DELIVERY_PLATFORMS = ["telegram", "discord"];
const VALID_GOAL_STATUSES = ["active", "paused", "completed"];

export function createGoalsRouter(): Router {
  const router = Router();

  /**
   * GET /api/goals
   * List all goals (all statuses — active, paused, completed).
   */
  router.get("/", (_req, res) => {
    try {
      const goals = store.listAllGoals();
      return res.json(goals);
    } catch (err) {
      return res.status(500).json({ error: "Failed to list goals" });
    }
  });

  /**
   * POST /api/goals
   * Create a new goal.
   */
  router.post("/", (req, res) => {
    try {
      const { title, description, priority = 2, milestones = [], tags = [] } = req.body as {
        title: string;
        description?: string;
        priority?: number;
        milestones?: Array<{ title: string; done: boolean }>;
        tags?: string[];
      };

      if (!title?.trim()) return res.status(400).json({ error: "title required" });

      if (priority !== undefined && (priority < 1 || priority > 3 || !Number.isInteger(priority))) {
        return res.status(400).json({ error: "priority must be 1 (low), 2 (medium), or 3 (high)" });
      }

      const goal = store.createGoal({ title, description, priority, milestones, tags });
      return res.status(201).json(goal);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Create failed" });
    }
  });

  /**
   * GET /api/goals/loop/status
   * Get goal loop state.
   */
  router.get("/loop/status", (_req, res) => {
    try {
      const state = store.getGoalLoopState();
      return res.json({
        status: goalLoop.status,
        dbState: state,
      });
    } catch (err) {
      return res.status(500).json({ error: "Failed to get status" });
    }
  });

  /**
   * POST /api/goals/loop/trigger
   * Manually trigger a goal loop cycle (for testing).
   */
  router.post("/loop/trigger", async (_req, res) => {
    try {
      res.json({ triggered: true, message: "Goal loop cycle started in background" });
      // Run after response is sent
      goalLoop.triggerNow().catch(err =>
        console.error("[GoalLoop] Manual trigger error:", err)
      );
    } catch (err) {
      return res.status(500).json({ error: "Trigger failed" });
    }
  });

  /**
   * PUT /api/goals/loop/config
   * Update goal loop configuration (schedule, delivery).
   */
  router.put("/loop/config", (req, res) => {
    try {
      const { schedule, timezone, delivery_chat_id, delivery_platform } = req.body as {
        schedule?: string;
        timezone?: string;
        delivery_chat_id?: string;
        delivery_platform?: string;
      };

      if (schedule !== undefined) {
        if (!validateCron(schedule)) {
          return res.status(400).json({ error: `Invalid cron expression: ${schedule}` });
        }
        store.setSetting("goal_loop_schedule", schedule);
      }
      if (timezone) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: timezone }); // throws if invalid
          store.setSetting("goal_loop_timezone", timezone);
        } catch {
          return res.status(400).json({ error: "Invalid timezone. Use IANA format (e.g. Asia/Taipei)" });
        }
      }
      if (delivery_chat_id !== undefined) store.setSetting("goal_loop_delivery_chat_id", delivery_chat_id);
      if (delivery_platform !== undefined) {
        if (!VALID_DELIVERY_PLATFORMS.includes(delivery_platform)) {
          return res.status(400).json({ error: `delivery_platform must be one of: ${VALID_DELIVERY_PLATFORMS.join(", ")}` });
        }
        store.setSetting("goal_loop_delivery_platform", delivery_platform);
      }

      // Restart the cron job with new schedule
      if (schedule || timezone) {
        goalLoop.start();
      }

      return res.json({ updated: true });
    } catch (err) {
      return res.status(500).json({ error: "Config update failed" });
    }
  });

  /**
   * GET /api/goals/logs/all
   * Get all progress logs.
   */
  router.get("/logs/all", (_req, res) => {
    try {
      const logs = store.listAllProgressLogs(50);
      return res.json(logs);
    } catch (err) {
      return res.status(500).json({ error: "Failed to get logs" });
    }
  });

  /**
   * PUT /api/goals/:id/milestones/:index
   * Toggle a milestone done/not-done.
   */
  router.put("/:id/milestones/:index", (req, res) => {
    try {
      const goal = store.getGoal(req.params.id);
      if (!goal) return res.status(404).json({ error: "Goal not found" });

      const idx = parseInt(req.params.index);
      if (isNaN(idx) || idx < 0 || idx >= goal.milestones.length) {
        return res.status(400).json({ error: "Invalid milestone index" });
      }

      const milestones = [...goal.milestones];
      milestones[idx] = { ...milestones[idx], done: !milestones[idx].done };
      const updated = store.updateGoal(req.params.id, { milestones });
      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: "Update failed" });
    }
  });

  /**
   * GET /api/goals/:id
   * Get a goal with progress log.
   */
  router.get("/:id", (req, res) => {
    try {
      const goal = store.getGoal(req.params.id);
      if (!goal) return res.status(404).json({ error: "Goal not found" });
      const logs = store.listGoalProgressLogs(req.params.id, 20);
      return res.json({ ...goal, logs });
    } catch (err) {
      return res.status(500).json({ error: "Failed to get goal" });
    }
  });

  /**
   * PUT /api/goals/:id
   * Update a goal (whitelisted fields only).
   */
  router.put("/:id", (req, res) => {
    try {
      let { title, description, priority, milestones, tags, status } = req.body as {
        title?: string;
        description?: string;
        priority?: number;
        milestones?: Array<{ title: string; done: boolean }>;
        tags?: string[];
        status?: string;
      };
      if (title !== undefined) {
        title = title.trim();
        if (!title) return res.status(400).json({ error: "Title is required" });
      }
      if (priority !== undefined && (priority < 1 || priority > 3 || !Number.isInteger(priority))) {
        return res.status(400).json({ error: "priority must be 1 (low), 2 (medium), or 3 (high)" });
      }
      if (status !== undefined && !VALID_GOAL_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_GOAL_STATUSES.join(", ")}` });
      }
      if (milestones !== undefined) {
        if (!Array.isArray(milestones)) {
          return res.status(400).json({ error: "milestones must be an array" });
        }
        for (const m of milestones) {
          if (typeof m.title !== 'string' || typeof m.done !== 'boolean') {
            return res.status(400).json({ error: "Each milestone must have title (string) and done (boolean)" });
          }
        }
      }
      const updated = store.updateGoal(req.params.id, { title, description, priority, milestones, tags, status });
      if (!updated) return res.status(404).json({ error: "Goal not found" });
      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Update failed" });
    }
  });

  /**
   * DELETE /api/goals/:id
   */
  router.delete("/:id", (req, res) => {
    try {
      const deleted = store.deleteGoal(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Goal not found" });
      return res.json({ deleted: true });
    } catch (err) {
      return res.status(500).json({ error: "Delete failed" });
    }
  });

  return router;
}
