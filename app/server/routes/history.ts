import { Router } from "express";
import store from "../db.ts";

export function createHistoryRouter(): Router {
  const router = Router();

  router.get("/", (req, res) => {
    try {
      const rows = store.queryHistory({
        session_id: req.query.session_id as string | undefined,
        search: req.query.search as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
        offset: parseInt(req.query.offset as string) || 0,
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
