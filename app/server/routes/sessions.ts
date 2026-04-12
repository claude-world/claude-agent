import { Router } from "express";
import store from "../db.ts";

export function createSessionsRouter(deps: {
  removeActive: (sessionId: string) => void;
}): Router {
  const router = Router();

  router.get("/", (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const sessions = store.listSessions(limit, offset);
      res.json(sessions);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/", (req, res) => {
    try {
      const { title } = req.body ?? {};
      const session = store.createSession(title);
      res.status(201).json(session);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      deps.removeActive(req.params.id);
      const ok = store.deleteSession(req.params.id);
      if (!ok) return res.status(404).json({ error: "Session not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/:id/messages", (req, res) => {
    try {
      const session = store.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: "Session not found" });
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const offset = parseInt(req.query.offset as string) || 0;
      const messages = store.getMessages(req.params.id, limit, offset);
      const total = store.countMessages(req.params.id);
      res.json({ messages, total, limit, offset });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
