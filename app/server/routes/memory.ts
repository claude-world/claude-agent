import { Router } from "express";
import path from "path";
import fs from "fs";

export function createMemoryRouter(deps: { agentRoot: string }): Router {
  const router = Router();
  const MEMORY_DIR = path.join(deps.agentRoot, "memory");

  router.get("/", (_req, res) => {
    try {
      if (!fs.existsSync(MEMORY_DIR)) return res.json([]);
      const files = fs
        .readdirSync(MEMORY_DIR, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith(".md"))
        .map((f) => ({ filename: f.name }));
      res.json(files);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(MEMORY_DIR, filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
      const content = fs.readFileSync(filePath, "utf-8");
      res.json({ filename, content });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      if (!filename.endsWith(".md")) return res.status(400).json({ error: "Only .md files are allowed" });
      const filePath = path.join(MEMORY_DIR, filename);
      const { content } = req.body ?? {};
      if (typeof content !== "string") return res.status(400).json({ error: "content must be a string" });
      if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      res.json({ filename, saved: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
