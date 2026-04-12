/**
 * Vector memory search routes — semantic search over role_memories.
 */

import { Router } from "express";
import { hybridMemory } from "../memory/hybrid-store.ts";

export function createVectorMemoryRouter(): Router {
  const router = Router();

  /**
   * POST /api/memory/search
   * Semantic search over memories for a chat.
   * Body: { chatId: string, query: string, limit?: number }
   */
  router.post("/search", async (req, res) => {
    try {
      const { chatId, query, limit = 5 } = req.body as {
        chatId: string;
        query: string;
        limit?: number;
      };

      if (!chatId || !query) {
        return res.status(400).json({ error: "chatId and query are required" });
      }

      const results = await hybridMemory.searchSimilar(
        chatId,
        query,
        Math.min(Number(limit) || 5, 20)
      );

      return res.json({ results });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Search failed" });
    }
  });

  /**
   * GET /api/memory/stats
   * Vector store statistics.
   */
  router.get("/stats", (_req, res) => {
    try {
      const stats = hybridMemory.getStats();
      return res.json(stats);
    } catch (err) {
      return res.status(500).json({ error: "Failed to get stats" });
    }
  });

  return router;
}
