import { Router } from "express";
import path from "path";
import fs from "fs";

function parseAgentFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {} as Record<string, string>, body: content };
  const meta: Record<string, string> = {};
  let currentKey = "";
  let multiline = false;
  let multiVal = "";
  for (const line of match[1].split("\n")) {
    if (multiline) {
      if (line.startsWith("  ") || line.startsWith("\t")) { multiVal += " " + line.trim(); continue; }
      else { meta[currentKey] = multiVal.trim(); multiline = false; }
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === ">" || val === "|") { multiline = true; multiVal = ""; }
      else meta[currentKey] = val.replace(/^["']|["']$/g, "");
    }
  }
  if (multiline) meta[currentKey] = multiVal.trim();
  return { meta, body: match[2] };
}

export function createAgentsRouter(deps: { agentRoot: string }): Router {
  const router = Router();
  const AGENTS_DIR = path.join(deps.agentRoot, ".claude/agents");

  router.get("/", (_req, res) => {
    try {
      if (!fs.existsSync(AGENTS_DIR)) return res.json([]);
      const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith(".md"))
        .map((f) => {
          const agentName = f.name.replace(/\.md$/, "");
          const content = fs.readFileSync(path.join(AGENTS_DIR, f.name), "utf8");
          const { meta } = parseAgentFrontmatter(content);
          return { id: agentName, name: meta.name || agentName, description: (meta.description || "").slice(0, 200), model: meta.model || "", tools: meta.tools || "" };
        });
      res.json(agents);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.get("/export", (_req, res) => {
    try {
      if (!fs.existsSync(AGENTS_DIR)) return res.json({ agents: [] });
      const bundle: { name: string; content: string }[] = [];
      for (const f of fs.readdirSync(AGENTS_DIR, { withFileTypes: true })) {
        if (!f.isFile() || !f.name.endsWith(".md")) continue;
        bundle.push({ name: f.name.replace(/\.md$/, ""), content: fs.readFileSync(path.join(AGENTS_DIR, f.name), "utf8") });
      }
      res.setHeader("Content-Disposition", "attachment; filename=claude-agent-agents.json")
        .json({ exported_at: new Date().toISOString(), count: bundle.length, agents: bundle });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/import", (req, res) => {
    try {
      const { name, content } = req.body ?? {};
      if (!name || !content) return res.status(400).json({ error: "name and content required" });
      const sName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });
      fs.writeFileSync(path.join(AGENTS_DIR, `${sName}.md`), content, "utf8");
      res.json({ success: true, name: sName });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  // NOTE: must come AFTER /export to avoid "export" matching :name
  router.get("/:name/raw", (req, res) => {
    try {
      const sName = path.basename(req.params.name);
      const filePath = path.join(AGENTS_DIR, `${sName}.md`);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Agent not found" });
      res.json({ name: sName, content: fs.readFileSync(filePath, "utf8") });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.delete("/:name", (req, res) => {
    try {
      const sName = path.basename(req.params.name);
      const filePath = path.join(AGENTS_DIR, `${sName}.md`);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Agent not found" });
      fs.unlinkSync(filePath);
      res.json({ success: true, deleted: sName });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  return router;
}
