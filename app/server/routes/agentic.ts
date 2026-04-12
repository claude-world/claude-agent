/**
 * Agentic execution routes — create and manage hierarchical multi-agent executions.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import store from "../db.ts";
import { AgenticExecutor, AgenticExecutorRegistry } from "../agentic/executor.ts";
import { createRootLineage, spawnChildLineage, getLineageTree } from "../agentic/lineage.ts";

interface AgenticRouterDeps {
  broadcastExecution: (executionId: string, payload: any) => void;
}

export function createAgenticRouter({ broadcastExecution }: AgenticRouterDeps): Router {
  const router = Router();

  // ── Executions ──────────────────────────────────────────────────────

  /**
   * GET /api/executions
   * List recent agent executions.
   */
  router.get("/", (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
      const executions = store.listAgentExecutions(limit);
      return res.json(executions);
    } catch (err) {
      return res.status(500).json({ error: "Failed to list executions" });
    }
  });

  /**
   * POST /api/executions
   * Create a new execution (does NOT start it yet).
   */
  router.post("/", (req, res) => {
    try {
      const { title, goal, mode = "auto" } = req.body as {
        title?: string;
        goal: string;
        mode?: string;
      };

      if (!goal?.trim()) {
        return res.status(400).json({ error: "goal is required" });
      }

      const VALID_MODES = ["auto", "parallel", "sequential", "swarm"] as const;
      if (mode && !VALID_MODES.includes(mode as typeof VALID_MODES[number])) {
        return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
      }

      const execution = store.createAgentExecution({
        title: title || goal.slice(0, 60),
        goal,
        mode,
        triggered_by: "manual",
      });

      return res.status(201).json(execution);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Create failed" });
    }
  });

  // ── Lineages ─────────────────────────────────────────────────────────

  /**
   * GET /api/executions/lineages
   * List root lineages.
   */
  router.get("/lineages", (_req, res) => {
    try {
      const lineages = store.listRootLineages();
      return res.json(lineages);
    } catch (err) {
      return res.status(500).json({ error: "Failed to list lineages" });
    }
  });

  /**
   * POST /api/executions/lineages
   * Create a root lineage.
   */
  router.post("/lineages", (req, res) => {
    try {
      const { name, memory_scope = "full" } = req.body as { name: string; memory_scope?: string };
      if (!name?.trim()) return res.status(400).json({ error: "name required" });
      const VALID_SCOPES = ["full", "summary", "none"] as const;
      if (memory_scope && !VALID_SCOPES.includes(memory_scope as typeof VALID_SCOPES[number])) {
        return res.status(400).json({ error: `memory_scope must be one of: ${VALID_SCOPES.join(", ")}` });
      }
      const lineage = createRootLineage(name, memory_scope as "full" | "summary" | "none");
      return res.status(201).json(lineage);
    } catch (err) {
      return res.status(500).json({ error: "Create failed" });
    }
  });

  /**
   * GET /api/executions/lineages/:id/tree
   * Get full lineage tree.
   */
  router.get("/lineages/:id/tree", (req, res) => {
    try {
      const tree = getLineageTree(req.params.id);
      return res.json(tree);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Not found";
      const isNotFound = msg.toLowerCase().includes("not found");
      return res.status(isNotFound ? 404 : 500).json({ error: msg });
    }
  });

  /**
   * POST /api/executions/lineages/:id/spawn
   * Spawn a child lineage.
   */
  router.post("/lineages/:id/spawn", (req, res) => {
    try {
      const { name, memoryScope = "summary", sourceChatId } = req.body as {
        name: string;
        memoryScope?: "full" | "summary" | "none";
        sourceChatId?: string;
      };
      if (!name?.trim()) return res.status(400).json({ error: "name required" });
      const VALID_SCOPES = ["full", "summary", "none"] as const;
      if (memoryScope && !VALID_SCOPES.includes(memoryScope as typeof VALID_SCOPES[number])) {
        return res.status(400).json({ error: `memoryScope must be one of: ${VALID_SCOPES.join(", ")}` });
      }
      const child = spawnChildLineage({
        name,
        parentId: req.params.id,
        memoryScope,
        sourceChatId,
      });
      return res.status(201).json(child);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Spawn failed" });
    }
  });

  /**
   * GET /api/executions/:id
   * Get execution with its steps.
   */
  router.get("/:id", (req, res) => {
    try {
      const execution = store.getAgentExecution(req.params.id);
      if (!execution) return res.status(404).json({ error: "Execution not found" });

      const steps = store.getExecutionSteps(req.params.id);
      return res.json({ ...execution, steps });
    } catch (err) {
      return res.status(500).json({ error: "Failed to get execution" });
    }
  });

  /**
   * POST /api/executions/:id/start
   * Start an execution (creates executor, runs async).
   */
  router.post("/:id/start", async (req, res) => {
    try {
      const execution = store.getAgentExecution(req.params.id);
      if (!execution) return res.status(404).json({ error: "Execution not found" });

      if (execution.status !== "idle" && execution.status !== "cancelled") {
        return res.status(409).json({ error: `Execution is already ${execution.status}` });
      }

      // Clean up stale steps from a previous cancelled run so GET /:id
      // doesn't return a mix of old and new steps.
      if (execution.status === "cancelled") {
        store.deleteExecutionSteps(execution.id);
        store.updateAgentExecution(execution.id, { status: "idle", result: null, cost_usd: null });
      }

      const executor = AgenticExecutorRegistry.create(execution.id);
      executor.onEvent((event) => {
        broadcastExecution(execution.id, event);
      });

      // Fire and forget — client subscribes via WS
      executor.run(execution.goal).finally(() => {
        AgenticExecutorRegistry.remove(execution.id);
      });

      return res.json({ started: true, executionId: execution.id });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Start failed" });
    }
  });

  /**
   * DELETE /api/executions/:id
   * Cancel and delete an execution.
   */
  router.delete("/:id", (req, res) => {
    try {
      const execution = store.getAgentExecution(req.params.id);
      if (!execution) return res.status(404).json({ error: "Execution not found" });

      // Cancel if running
      const executor = AgenticExecutorRegistry.get(req.params.id);
      if (executor) {
        executor.cancel();
        store.updateAgentExecution(req.params.id, { status: "cancelled" });
        AgenticExecutorRegistry.remove(req.params.id);
      }

      store.deleteAgentExecution(req.params.id);
      return res.json({ deleted: true });
    } catch (err) {
      return res.status(500).json({ error: "Delete failed" });
    }
  });

  return router;
}
