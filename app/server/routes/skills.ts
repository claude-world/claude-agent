import { Router } from "express";
import path from "path";
import fs from "fs";
import { safeName } from "../middleware/security.ts";
import store from "../db.ts";

const SKILL_CATEGORIES: Record<string, string> = {
  'memory-manager': 'Core', 'task-tracker': 'Core', 'daily-briefing': 'Core',
  'context-health': 'Core', 'brainstorm': 'Core', 'draft-message': 'Core',
  'quick-research': 'Core', 'summarize': 'Core', 'skill-creator': 'Core', 'setup': 'Core',
  'exa-search': 'Content', 'trend-scout': 'Content', 'content-creator': 'Content', 'podcast-maker': 'Content',
  'deep-read': 'Content', 'image-gen': 'Content', 'rss-monitor': 'Content',
  'email': 'Productivity', 'google-workspace': 'Productivity', 'github-ops': 'Productivity',
  'gh-issues': 'Productivity', 'notion': 'Productivity', 'obsidian': 'Productivity',
  'trello': 'Productivity', 'things-mac': 'Productivity', 'pdf-editor': 'Productivity',
  'bear-notes': 'Productivity', 'apple-notes': 'Productivity', 'apple-reminders': 'Productivity',
  'imessage': 'Messaging', 'whatsapp': 'Messaging', 'slack-ops': 'Messaging', 'x-twitter': 'Messaging',
  'spotify': 'Smart Home', 'sonos': 'Smart Home', 'hue-lights': 'Smart Home',
  'smart-bed': 'Smart Home', 'camera': 'Smart Home',
  'video-extract': 'Media', 'speech-to-text': 'Media', 'text-to-speech': 'Media', 'gif-search': 'Media',
  'weather': 'System', 'places': 'System', 'password-manager': 'System',
  'security-audit': 'System', 'tmux-control': 'System', 'session-logs': 'System', 'peekaboo': 'System',
  'migrate-openclaw': 'Migration',
};

function parseSkillFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {} as Record<string, string>, body: content };
  const meta: Record<string, string> = {};
  let currentKey = '';
  let multiline = false;
  let multiVal = '';
  for (const line of match[1].split('\n')) {
    if (multiline) {
      if (line.startsWith('  ') || line.startsWith('\t')) { multiVal += ' ' + line.trim(); continue; }
      else { meta[currentKey] = multiVal.trim(); multiline = false; }
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === '>' || val === '|') { multiline = true; multiVal = ''; }
      else meta[currentKey] = val.replace(/^["']|["']$/g, '');
    }
  }
  if (multiline) meta[currentKey] = multiVal.trim();
  const prereqMatch = match[2].match(/```bash\n([\s\S]*?)```/);
  return { meta, body: match[2], prereq: prereqMatch ? prereqMatch[1].trim().split('\n').filter((l: string) => l.trim() && !l.startsWith('#')) : [] };
}

export function createSkillsRouter(deps: { agentRoot: string }): Router {
  const router = Router();
  const getSkillsDir = () =>
    path.join(store.getSetting("agent_root") || process.env.AGENT_ROOT || deps.agentRoot, ".claude/skills");

  router.get("/", (_req, res) => {
    try {
      const skillsDir = getSkillsDir();
      if (!fs.existsSync(skillsDir)) return res.json([]);
      const skills = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const skillFile = path.join(skillsDir, d.name, "SKILL.md");
          if (!fs.existsSync(skillFile)) return null;
          const content = fs.readFileSync(skillFile, "utf8");
          const { meta, prereq } = parseSkillFrontmatter(content);
          return {
            id: d.name, name: meta.name || d.name, command: `/${d.name}`,
            model: meta.model || 'haiku', category: SKILL_CATEGORIES[d.name] || 'System',
            description: (meta.description || '').slice(0, 200),
            full_description: (meta['when_to_use'] || meta.description || '').slice(0, 500),
            prerequisites: prereq || [],
          };
        }).filter(Boolean);
      res.json(skills);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.get("/export", (_req, res) => {
    try {
      const skillsDir = getSkillsDir();
      if (!fs.existsSync(skillsDir)) return res.json({ skills: [] });
      const bundle: { name: string; content: string }[] = [];
      for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const f = path.join(skillsDir, d.name, "SKILL.md");
        if (fs.existsSync(f)) bundle.push({ name: d.name, content: fs.readFileSync(f, "utf8") });
      }
      res.setHeader("Content-Disposition", "attachment; filename=claude-agent-skills.json");
      res.json({ exported_at: new Date().toISOString(), count: bundle.length, skills: bundle });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.get("/:name/raw", (req, res) => {
    try {
      const skillsDir = getSkillsDir();
      const skillFile = path.join(skillsDir, safeName(req.params.name), "SKILL.md");
      if (!fs.existsSync(skillFile)) return res.status(404).json({ error: "Skill not found" });
      res.json({ name: req.params.name, content: fs.readFileSync(skillFile, "utf8") });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/import", (req, res) => {
    try {
      const skillsDir = getSkillsDir();
      const { name, content } = req.body ?? {};
      if (!name || !content) return res.status(400).json({ error: "name and content required" });
      const sName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      const dir = path.join(skillsDir, sName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf8");
      res.json({ success: true, name: sName });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/import-bundle", (req, res) => {
    try {
      const skillsDir = getSkillsDir();
      const { skills } = req.body ?? {};
      if (!Array.isArray(skills)) return res.status(400).json({ error: "skills array required" });
      const results: { name: string; success: boolean }[] = [];
      for (const { name, content } of skills) {
        if (!name || !content) continue;
        const sName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
        const dir = path.join(skillsDir, sName);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf8");
        results.push({ name: sName, success: true });
      }
      res.json({ imported: results.length, results });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.delete("/:name", (req, res) => {
    try {
      const skillsDir = getSkillsDir();
      const dir = path.join(skillsDir, safeName(req.params.name));
      if (!fs.existsSync(dir)) return res.status(404).json({ error: "Skill not found" });
      fs.rmSync(dir, { recursive: true });
      res.json({ success: true, deleted: req.params.name });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  return router;
}
