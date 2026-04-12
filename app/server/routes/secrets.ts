import { Router } from "express";
import store from "../db.ts";

export function createSecretsRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      res.json(store.listSecrets());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/", (req, res) => {
    try {
      const { name, value, description, category } = req.body ?? {};
      if (!name || !value) return res.status(400).json({ error: "name and value required" });
      const secret = store.createSecret({ name, value, description, category });
      res.status(201).json(secret);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/:id", (req, res) => {
    try {
      const secret = store.updateSecret(req.params.id, req.body ?? {});
      if (!secret) return res.status(404).json({ error: "Secret not found" });
      res.json(secret);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      const ok = store.deleteSecret(req.params.id);
      if (!ok) return res.status(404).json({ error: "Secret not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
