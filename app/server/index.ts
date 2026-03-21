import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import store from "./db.ts";
import { AgentSession } from "./agent.ts";
import { TelegramBridge } from "./telegram.ts";
import { DiscordBridge } from "./discord.ts";
import scheduler from "./scheduler.ts";

// --- Channel bridge instances ---
const bridges: {
  telegram: TelegramBridge | null;
  discord: DiscordBridge | null;
} = { telegram: null, discord: null };

function startBridges() {
  const accounts = store.listChannelAccounts();
  for (const acct of accounts) {
    if (!acct.enabled || !acct.bot_token) continue;
    try {
      if (acct.platform === "telegram" && !bridges.telegram) {
        bridges.telegram = new TelegramBridge(store);
        bridges.telegram.start(acct.bot_token, acct.allowed_users);
        console.log(`[Bridges] Telegram started`);
      } else if (acct.platform === "discord" && !bridges.discord) {
        bridges.discord = new DiscordBridge(store);
        bridges.discord.start(acct.bot_token, acct.allowed_users);
        console.log(`[Bridges] Discord started`);
      }
    } catch (err) {
      console.error(`[Bridges] Failed to start ${acct.platform}:`, err);
    }
  }
}

function stopBridge(platform: "telegram" | "discord") {
  if (platform === "telegram" && bridges.telegram) {
    bridges.telegram.stop();
    bridges.telegram = null;
    console.log("[Bridges] Telegram stopped");
  } else if (platform === "discord" && bridges.discord) {
    bridges.discord.stop();
    bridges.discord = null;
    console.log("[Bridges] Discord stopped");
  }
}

function restartBridge(platform: "telegram" | "discord") {
  stopBridge(platform);
  const acct = store.listChannelAccounts().find(a => a.platform === platform && a.enabled);
  if (acct && acct.bot_token) {
    const bridge = platform === "telegram" ? new TelegramBridge(store) : new DiscordBridge(store);
    bridge.start(acct.bot_token, acct.allowed_users);
    (bridges as Record<string, unknown>)[platform] = bridge;
    console.log(`[Bridges] ${platform} restarted`);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3456;
const HOST = "127.0.0.1";

// claude-agent root (two levels up from app/server)
const AGENT_ROOT = path.resolve(__dirname, "../..");

const ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

// Extend WebSocket with session tracking
interface WSClient extends WebSocket {
  isAlive: boolean;
  sessionId?: string;
}

// -------------------------------------------------------------------
// In-memory session store
// -------------------------------------------------------------------
interface ActiveSession {
  agent: AgentSession;
  subscribers: Set<WSClient>;
  isListening: boolean;
}

const activeSessions = new Map<string, ActiveSession>();

// -------------------------------------------------------------------
// Session helpers
// -------------------------------------------------------------------

function getOrCreateActive(sessionId: string): ActiveSession | null {
  if (activeSessions.has(sessionId)) {
    return activeSessions.get(sessionId)!;
  }
  const dbSession = store.getSession(sessionId);
  if (!dbSession) return null;

  const agent = new AgentSession(sessionId, AGENT_ROOT);
  const active: ActiveSession = {
    agent,
    subscribers: new Set(),
    isListening: false,
  };
  activeSessions.set(sessionId, active);
  return active;
}

function broadcast(active: ActiveSession, payload: any) {
  const str = JSON.stringify(payload);
  for (const client of active.subscribers) {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(str);
      }
    } catch {
      active.subscribers.delete(client);
    }
  }
}

async function startListening(sessionId: string, active: ActiveSession) {
  if (active.isListening) return;
  active.isListening = true;

  try {
    for await (const message of active.agent.getOutputStream()) {
      handleSDKMessage(sessionId, active, message);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Session ${sessionId}] Error:`, errorMsg);
    broadcast(active, { type: "error", error: errorMsg });
  } finally {
    active.isListening = false;
  }
}

function handleSDKMessage(
  sessionId: string,
  active: ActiveSession,
  message: any
) {
  if (message.type === "assistant") {
    const content = message.message?.content;
    if (!content) return;

    if (typeof content === "string") {
      store.addMessage(sessionId, { role: "assistant", content });
      broadcast(active, { type: "assistant_message", content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          store.addMessage(sessionId, {
            role: "assistant",
            content: block.text,
          });
          broadcast(active, {
            type: "assistant_message",
            content: block.text,
          });
        } else if (block.type === "tool_use" && block.name) {
          store.addMessage(sessionId, {
            role: "tool_use",
            tool_name: block.name,
            tool_input: JSON.stringify(block.input),
          });
          broadcast(active, {
            type: "tool_use",
            toolName: block.name,
            toolInput: block.input,
          });
        } else if (block.type === "tool_result") {
          const resultContent =
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content);
          store.addMessage(sessionId, {
            role: "tool_result",
            content: resultContent,
          });
          broadcast(active, { type: "tool_result", content: resultContent });
        }
      }
    }
  } else if (message.type === "result") {
    broadcast(active, {
      type: "result",
      success: message.subtype === "success",
      cost: message.total_cost_usd,
      duration: message.duration_ms,
    });
  }
}

function removeActive(sessionId: string) {
  const active = activeSessions.get(sessionId);
  if (active) {
    active.agent.interrupt();
    activeSessions.delete(sessionId);
  }
}

// -------------------------------------------------------------------
// Express app
// -------------------------------------------------------------------
const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

// Serve built client in production
const distDir = path.join(__dirname, "../dist/client");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// -------------------------------------------------------------------
// REST: Sessions
// -------------------------------------------------------------------
app.get("/api/sessions", (_req, res) => {
  try {
    res.json(store.listSessions());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/sessions", (req, res) => {
  try {
    const { title } = req.body ?? {};
    const session = store.createSession(title);
    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete("/api/sessions/:id", (req, res) => {
  try {
    removeActive(req.params.id);
    const ok = store.deleteSession(req.params.id);
    if (!ok) return res.status(404).json({ error: "Session not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/sessions/:id/messages", (req, res) => {
  try {
    const session = store.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(store.getMessages(req.params.id));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------------
// REST: Settings
// -------------------------------------------------------------------
app.get("/api/settings", (_req, res) => {
  try {
    res.json(store.getAllSettings());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put("/api/settings", (req, res) => {
  try {
    const updates = req.body ?? {};
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === "string") {
        store.setSetting(key, value);
      }
    }
    res.json(store.getAllSettings());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------------
// REST: Skills
// -------------------------------------------------------------------
// Skill category mapping
const SKILL_CATEGORIES: Record<string, string> = {
  'memory-manager': 'Core', 'task-tracker': 'Core', 'daily-briefing': 'Core',
  'context-health': 'Core', 'brainstorm': 'Core', 'draft-message': 'Core',
  'quick-research': 'Core', 'summarize': 'Core', 'skill-creator': 'Core', 'setup': 'Core',
  'trend-scout': 'Content', 'content-creator': 'Content', 'podcast-maker': 'Content',
  'deep-read': 'Content', 'image-gen': 'Content', 'rss-monitor': 'Content',
  'email': 'Productivity', 'google-workspace': 'Productivity', 'github-ops': 'Productivity',
  'gh-issues': 'Productivity', 'notion': 'Productivity', 'obsidian': 'Productivity',
  'trello': 'Productivity', 'things-mac': 'Productivity', 'pdf-editor': 'Productivity',
  'bear-notes': 'Productivity', 'apple-notes': 'Productivity', 'apple-reminders': 'Productivity',
  'imessage': 'Messaging', 'whatsapp': 'Messaging', 'slack-ops': 'Messaging', 'x-twitter': 'Messaging',
  'spotify': 'Smart Home', 'sonos': 'Smart Home', 'hue-lights': 'Smart Home',
  'smart-bed': 'Smart Home', 'camera': 'Smart Home',
  'video-extract': 'Media', 'speech-to-text': 'Media', 'text-to-speech': 'Media',
  'gif-search': 'Media',
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
      if (line.startsWith('  ') || line.startsWith('\t')) {
        multiVal += ' ' + line.trim();
        continue;
      } else {
        meta[currentKey] = multiVal.trim();
        multiline = false;
      }
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
  // Extract prerequisites from body
  const prereqMatch = match[2].match(/```bash\n([\s\S]*?)```/);
  return { meta, body: match[2], prereq: prereqMatch ? prereqMatch[1].trim().split('\n').filter((l: string) => l.trim() && !l.startsWith('#')) : [] };
}

app.get("/api/skills", (_req, res) => {
  try {
    const skillsDir = path.join(AGENT_ROOT, ".claude/skills");
    if (!fs.existsSync(skillsDir)) return res.json([]);

    const skills = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const skillFile = path.join(skillsDir, d.name, "SKILL.md");
        if (!fs.existsSync(skillFile)) return null;
        const content = fs.readFileSync(skillFile, "utf8");
        const { meta, body, prereq } = parseSkillFrontmatter(content);
        return {
          id: d.name,
          name: meta.name || d.name,
          command: `/${d.name}`,
          model: meta.model || 'haiku',
          category: SKILL_CATEGORIES[d.name] || 'System',
          description: (meta.description || '').slice(0, 200),
          full_description: (meta['when_to_use'] || meta.description || '').slice(0, 500),
          prerequisites: prereq || [],
        };
      })
      .filter(Boolean);
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET single skill raw content (for export)
app.get("/api/skills/:name/raw", (req, res) => {
  try {
    const skillFile = path.join(AGENT_ROOT, ".claude/skills", req.params.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) return res.status(404).json({ error: "Skill not found" });
    const content = fs.readFileSync(skillFile, "utf8");
    res.json({ name: req.params.name, content });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Export all skills as JSON bundle
app.get("/api/skills/export", (_req, res) => {
  try {
    const skillsDir = path.join(AGENT_ROOT, ".claude/skills");
    if (!fs.existsSync(skillsDir)) return res.json({ skills: [] });
    const bundle: { name: string; content: string }[] = [];
    for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const f = path.join(skillsDir, d.name, "SKILL.md");
      if (fs.existsSync(f)) {
        bundle.push({ name: d.name, content: fs.readFileSync(f, "utf8") });
      }
    }
    res.setHeader("Content-Disposition", "attachment; filename=claude-agent-skills.json");
    res.json({ exported_at: new Date().toISOString(), count: bundle.length, skills: bundle });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Import a skill (upload SKILL.md content)
app.post("/api/skills/import", (req, res) => {
  try {
    const { name, content } = req.body ?? {};
    if (!name || !content) return res.status(400).json({ error: "name and content required" });
    // Sanitize name
    const safeName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const skillDir = path.join(AGENT_ROOT, ".claude/skills", safeName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
    res.json({ success: true, name: safeName });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Bulk import skills from export bundle
app.post("/api/skills/import-bundle", (req, res) => {
  try {
    const { skills } = req.body ?? {};
    if (!Array.isArray(skills)) return res.status(400).json({ error: "skills array required" });
    const results: { name: string; success: boolean }[] = [];
    for (const { name, content } of skills) {
      if (!name || !content) continue;
      const safeName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      const skillDir = path.join(AGENT_ROOT, ".claude/skills", safeName);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
      results.push({ name: safeName, success: true });
    }
    res.json({ imported: results.length, results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete a skill
app.delete("/api/skills/:name", (req, res) => {
  try {
    const skillDir = path.join(AGENT_ROOT, ".claude/skills", req.params.name);
    if (!fs.existsSync(skillDir)) return res.status(404).json({ error: "Skill not found" });
    fs.rmSync(skillDir, { recursive: true });
    res.json({ success: true, deleted: req.params.name });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------------
// REST: MCP Configuration
// -------------------------------------------------------------------
const MCP_JSON_PATH = path.join(AGENT_ROOT, ".mcp.json");

app.get("/api/mcp", (_req, res) => {
  try {
    if (!fs.existsSync(MCP_JSON_PATH)) return res.json({ mcpServers: {} });
    const content = JSON.parse(fs.readFileSync(MCP_JSON_PATH, "utf8"));
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put("/api/mcp", (req, res) => {
  try {
    const { mcpServers } = req.body ?? {};
    if (!mcpServers || typeof mcpServers !== "object") {
      return res.status(400).json({ error: "mcpServers object required" });
    }
    const content = JSON.stringify({ mcpServers }, null, 2) + "\n";
    fs.writeFileSync(MCP_JSON_PATH, content, "utf8");
    res.json({ success: true, mcpServers });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Add a single MCP server
app.post("/api/mcp/:name", (req, res) => {
  try {
    const config = fs.existsSync(MCP_JSON_PATH)
      ? JSON.parse(fs.readFileSync(MCP_JSON_PATH, "utf8"))
      : { mcpServers: {} };
    config.mcpServers[req.params.name] = req.body;
    fs.writeFileSync(MCP_JSON_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
    res.json({ success: true, name: req.params.name });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete a single MCP server
app.delete("/api/mcp/:name", (req, res) => {
  try {
    if (!fs.existsSync(MCP_JSON_PATH)) return res.status(404).json({ error: "No MCP config" });
    const config = JSON.parse(fs.readFileSync(MCP_JSON_PATH, "utf8"));
    delete config.mcpServers[req.params.name];
    fs.writeFileSync(MCP_JSON_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
    res.json({ success: true, deleted: req.params.name });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------------
// REST: CLI Detection
// -------------------------------------------------------------------
const CLI_LIST = [
  { name: 'claude', cmd: 'claude', vFlag: '--version' },
  { name: 'codex', cmd: 'codex', vFlag: '--version' },
  { name: 'gemini', cmd: 'gemini', vFlag: '--version' },
  { name: 'opencode', cmd: 'opencode', vFlag: 'version' },
  { name: 'node', cmd: 'node', vFlag: '--version' },
  { name: 'uvx', cmd: 'uvx', vFlag: '--version' },
  { name: 'gh', cmd: 'gh', vFlag: '--version' },
];

app.get("/api/cli-detect", async (_req, res) => {
  const { execSync } = await import("child_process");
  // Use login shell to get full PATH (Electron/Finder launches with minimal PATH)
  const shellExec = (cmd: string, timeout = 5000) =>
    execSync(`/bin/zsh -lc '${cmd}'`, { encoding: "utf8", timeout }).trim();

  const results = CLI_LIST.map(({ name, cmd, vFlag }) => {
    try {
      const p = shellExec(`which ${cmd}`, 3000);
      let version: string | null = null;
      try {
        version = shellExec(`${cmd} ${vFlag}`).split("\n")[0];
      } catch {}
      return { name, path: p, version };
    } catch {
      return { name, path: null, version: null };
    }
  });
  res.json(results);
});

// -------------------------------------------------------------------
// REST: OpenClaw Migration
// -------------------------------------------------------------------
app.get("/api/migrate/check", (_req, res) => {
  const openclawDir = path.join(process.env.HOME || "", ".openclaw");
  const found = fs.existsSync(openclawDir);
  let summary = "";
  if (found) {
    const parts: string[] = [`Found: ${openclawDir}`];
    const workspace = path.join(openclawDir, "workspace");
    if (fs.existsSync(workspace)) {
      if (fs.existsSync(path.join(workspace, "SOUL.md"))) parts.push("SOUL.md (personality)");
      if (fs.existsSync(path.join(workspace, "MEMORY.md"))) parts.push("MEMORY.md (knowledge)");
      const skillsDir = path.join(workspace, "skills");
      if (fs.existsSync(skillsDir)) {
        const count = fs.readdirSync(skillsDir).filter(d =>
          fs.existsSync(path.join(skillsDir, d, "SKILL.md"))
        ).length;
        parts.push(`${count} skills`);
      }
    }
    const sessionsDir = path.join(openclawDir, "sessions");
    if (fs.existsSync(sessionsDir)) {
      const count = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl")).length;
      parts.push(`${count} sessions`);
    }
    summary = parts.join("\n");
  }
  res.json({ found, summary });
});

app.post("/api/migrate/run", (_req, res) => {
  const { execSync } = require("child_process");
  const scriptPath = path.join(AGENT_ROOT, "scripts/migrate-openclaw.cjs");
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: "Migration script not found" });
  }
  try {
    const output = execSync(`node "${scriptPath}" --verbose`, {
      encoding: "utf8",
      timeout: 60000,
      cwd: AGENT_ROOT,
    });
    // Read report if generated
    const reportPath = path.join(AGENT_ROOT, "workspace/migration-report.md");
    const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : output;
    res.json({ success: true, report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// -------------------------------------------------------------------
// REST: Memory files
// -------------------------------------------------------------------
const MEMORY_DIR = path.join(AGENT_ROOT, "memory");

app.get("/api/memory", (_req, res) => {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      return res.json([]);
    }
    const files = fs
      .readdirSync(MEMORY_DIR, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith(".md"))
      .map((f) => ({ filename: f.name }));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/memory/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // prevent traversal
    const filePath = path.join(MEMORY_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ filename, content });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put("/api/memory/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(MEMORY_DIR, filename);
    const { content } = req.body ?? {};
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content must be a string" });
    }
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ filename, saved: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------------
// REST: History (cross-session message search)
// -------------------------------------------------------------------
app.get("/api/history", (req, res) => {
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

// -------------------------------------------------------------------
// REST: Agents (read/write .claude/agents/*.md)
// -------------------------------------------------------------------
const AGENTS_DIR = path.join(AGENT_ROOT, ".claude/agents");

function parseAgentFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {} as Record<string, string>, body: content };
  const meta: Record<string, string> = {};
  let currentKey = "";
  let multiline = false;
  let multiVal = "";
  for (const line of match[1].split("\n")) {
    if (multiline) {
      if (line.startsWith("  ") || line.startsWith("\t")) {
        multiVal += " " + line.trim();
        continue;
      } else {
        meta[currentKey] = multiVal.trim();
        multiline = false;
      }
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === ">" || val === "|") {
        multiline = true;
        multiVal = "";
      } else {
        meta[currentKey] = val.replace(/^["']|["']$/g, "");
      }
    }
  }
  if (multiline) meta[currentKey] = multiVal.trim();
  return { meta, body: match[2] };
}

// GET /api/agents — list all agents with parsed metadata
app.get("/api/agents", (_req, res) => {
  try {
    if (!fs.existsSync(AGENTS_DIR)) return res.json([]);

    const agents = fs
      .readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith(".md"))
      .map((f) => {
        const agentName = f.name.replace(/\.md$/, "");
        const filePath = path.join(AGENTS_DIR, f.name);
        const content = fs.readFileSync(filePath, "utf8");
        const { meta } = parseAgentFrontmatter(content);
        return {
          id: agentName,
          name: meta.name || agentName,
          description: (meta.description || "").slice(0, 200),
          model: meta.model || "",
          tools: meta.tools || "",
        };
      });

    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/agents/export — all agents as JSON bundle
app.get("/api/agents/export", (_req, res) => {
  try {
    if (!fs.existsSync(AGENTS_DIR)) return res.json({ agents: [] });

    const bundle: { name: string; content: string }[] = [];
    for (const f of fs.readdirSync(AGENTS_DIR, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith(".md")) continue;
      const agentName = f.name.replace(/\.md$/, "");
      const content = fs.readFileSync(path.join(AGENTS_DIR, f.name), "utf8");
      bundle.push({ name: agentName, content });
    }

    res
      .setHeader("Content-Disposition", "attachment; filename=claude-agent-agents.json")
      .json({
        exported_at: new Date().toISOString(),
        count: bundle.length,
        agents: bundle,
      });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/agents/import — import agent .md {name, content}
app.post("/api/agents/import", (req, res) => {
  try {
    const { name, content } = req.body ?? {};
    if (!name || !content) {
      return res.status(400).json({ error: "name and content required" });
    }
    const safeName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    if (!fs.existsSync(AGENTS_DIR)) {
      fs.mkdirSync(AGENTS_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(AGENTS_DIR, `${safeName}.md`), content, "utf8");
    res.json({ success: true, name: safeName });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/agents/:name/raw — raw .md content
// NOTE: must come AFTER /api/agents/export to avoid "export" matching :name
app.get("/api/agents/:name/raw", (req, res) => {
  try {
    const safeName = path.basename(req.params.name);
    const filePath = path.join(AGENTS_DIR, `${safeName}.md`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Agent not found" });
    }
    const content = fs.readFileSync(filePath, "utf8");
    res.json({ name: safeName, content });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/agents/:name — delete agent file
app.delete("/api/agents/:name", (req, res) => {
  try {
    const safeName = path.basename(req.params.name);
    const filePath = path.join(AGENTS_DIR, `${safeName}.md`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Agent not found" });
    }
    fs.unlinkSync(filePath);
    res.json({ success: true, deleted: safeName });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------------
// REST: Scheduled tasks
// -------------------------------------------------------------------

// GET /api/scheduled-tasks — list all
app.get("/api/scheduled-tasks", (_req, res) => {
  try {
    res.json(store.listScheduledTasks());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/scheduled-tasks — create
app.post("/api/scheduled-tasks", (req, res) => {
  try {
    const { name, prompt, agent, schedule, timezone } = req.body ?? {};
    if (!name || !prompt || !schedule) {
      return res.status(400).json({ error: "name, prompt, and schedule required" });
    }
    const task = store.createScheduledTask({ name, prompt, agent, schedule, timezone });
    // Register cron job immediately if enabled
    if (task.enabled) {
      scheduler.registerJob(task.id);
    }
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/scheduled-tasks/:id — update
app.put("/api/scheduled-tasks/:id", (req, res) => {
  try {
    const task = store.updateScheduledTask(req.params.id, req.body ?? {});
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Re-register (handles enable/disable and schedule changes)
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

// DELETE /api/scheduled-tasks/:id — delete
app.delete("/api/scheduled-tasks/:id", (req, res) => {
  try {
    scheduler.unregisterJob(req.params.id);
    const ok = store.deleteScheduledTask(req.params.id);
    if (!ok) return res.status(404).json({ error: "Task not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /api/scheduled-tasks/:id/toggle — enable/disable
app.patch("/api/scheduled-tasks/:id/toggle", (req, res) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled (boolean) required" });
    }
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

// POST /api/scheduled-tasks/:id/run — manual trigger
app.post("/api/scheduled-tasks/:id/run", async (req, res) => {
  try {
    const task = store.getScheduledTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Kick off execution without waiting for it to finish
    scheduler.executeTask(req.params.id, "manual").catch((err) => {
      console.error(`[Scheduler] Manual trigger error for ${req.params.id}:`, err);
    });
    res.json({ success: true, message: "Task execution started" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/scheduled-tasks/:id/executions — execution history
app.get("/api/scheduled-tasks/:id/executions", (req, res) => {
  try {
    const task = store.getScheduledTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    res.json(store.listTaskExecutions(req.params.id, limit));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------------
// REST: Channel accounts
// -------------------------------------------------------------------
app.get("/api/channels", (_req, res) => {
  try {
    // Return accounts without exposing raw tokens
    const accounts = store.listChannelAccounts().map((a) => ({
      ...a,
      bot_token: a.bot_token ? "***" : "",
    }));
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/channels", (req, res) => {
  try {
    const { platform, bot_token, allowed_users, enabled } = req.body ?? {};
    if (!platform || !bot_token) {
      return res.status(400).json({ error: "platform and bot_token required" });
    }
    const account = store.setChannelAccount({
      platform,
      bot_token,
      allowed_users,
      enabled,
    });
    res.status(201).json({ ...account, bot_token: "***" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete("/api/channels/:id", (req, res) => {
  try {
    const acct = store.getChannelAccount(req.params.id);
    const ok = store.deleteChannelAccount(req.params.id);
    if (!ok) return res.status(404).json({ error: "Channel account not found" });
    // Stop bridge if running
    if (acct) stopBridge(acct.platform as "telegram" | "discord");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Channel bridge control
app.get("/api/channels/status", (_req, res) => {
  res.json({
    telegram: { running: bridges.telegram !== null },
    discord: { running: bridges.discord !== null },
  });
});

app.post("/api/channels/:id/start", (req, res) => {
  try {
    const acct = store.getChannelAccount(req.params.id);
    if (!acct) return res.status(404).json({ error: "Not found" });
    restartBridge(acct.platform as "telegram" | "discord");
    res.json({ success: true, platform: acct.platform, running: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/channels/:id/stop", (req, res) => {
  try {
    const acct = store.getChannelAccount(req.params.id);
    if (!acct) return res.status(404).json({ error: "Not found" });
    stopBridge(acct.platform as "telegram" | "discord");
    res.json({ success: true, platform: acct.platform, running: false });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------------
// HTTP server + WebSocket
// -------------------------------------------------------------------
const server = createServer(app);

const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient: ({ origin }: { origin?: string }) => {
    if (!origin) return true; // allow CLI / native tools
    return ALLOWED_ORIGINS.includes(origin);
  },
});

wss.on("connection", (ws: WSClient) => {
  ws.isAlive = true;

  ws.send(JSON.stringify({ type: "connected" }));

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case "subscribe": {
          // Unsubscribe from previous session
          if (ws.sessionId) {
            const prev = activeSessions.get(ws.sessionId);
            if (prev) prev.subscribers.delete(ws);
          }

          const active = getOrCreateActive(msg.sessionId);
          if (!active) {
            ws.send(
              JSON.stringify({ type: "error", error: "Session not found" })
            );
            break;
          }

          ws.sessionId = msg.sessionId;
          active.subscribers.add(ws);

          const messages = store.getMessages(msg.sessionId);
          ws.send(
            JSON.stringify({
              type: "history",
              messages,
              running: active.isListening,
            })
          );
          break;
        }

        case "chat": {
          if (!msg.content?.trim()) {
            ws.send(JSON.stringify({ type: "error", error: "Empty message" }));
            break;
          }

          // Switch sessions if needed
          if (ws.sessionId && ws.sessionId !== msg.sessionId) {
            const prev = activeSessions.get(ws.sessionId);
            if (prev) prev.subscribers.delete(ws);
          }

          const active = getOrCreateActive(msg.sessionId);
          if (!active) {
            ws.send(
              JSON.stringify({ type: "error", error: "Session not found" })
            );
            break;
          }

          ws.sessionId = msg.sessionId;
          active.subscribers.add(ws);

          store.addMessage(msg.sessionId, {
            role: "user",
            content: msg.content,
          });
          broadcast(active, { type: "user_message", content: msg.content });

          active.agent.sendMessage(msg.content);

          if (!active.isListening) {
            startListening(msg.sessionId, active);
          }
          break;
        }

        case "interrupt": {
          removeActive(msg.sessionId);
          // Notify all subscribers that the session was interrupted
          const interruptStr = JSON.stringify({
            type: "interrupted",
            sessionId: msg.sessionId,
          });
          wss.clients.forEach((client) => {
            const c = client as WSClient;
            if (
              c.sessionId === msg.sessionId &&
              c.readyState === WebSocket.OPEN
            ) {
              c.send(interruptStr);
            }
          });
          break;
        }

        default:
          ws.send(
            JSON.stringify({ type: "error", error: "Unknown message type" })
          );
      }
    } catch (err) {
      console.error("[WS] Error handling message:", err);
      try {
        ws.send(
          JSON.stringify({ type: "error", error: "Invalid message format" })
        );
      } catch {
        // client already disconnected
      }
    }
  });

  ws.on("close", () => {
    for (const active of activeSessions.values()) {
      active.subscribers.delete(ws);
    }
  });
});

// Heartbeat: detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    const client = ws as WSClient;
    if (client.isAlive === false) {
      client.terminate();
      return;
    }
    client.isAlive = false;
    client.ping();
  });
}, 30_000);

wss.on("close", () => {
  clearInterval(heartbeat);
});

// Prevent stray SDK errors from crashing the process
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception (non-fatal):", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection (non-fatal):", reason);
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`Claude Agent server running at http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT}/ws`);

  // Auto-start enabled channel bridges
  try {
    startBridges();
  } catch (err) {
    console.error("[Bridges] Auto-start error:", err);
  }

  // Start scheduled task cron jobs
  try {
    scheduler.start();
  } catch (err) {
    console.error("[Scheduler] Auto-start error:", err);
  }
});

// Graceful shutdown
function shutdown() {
  for (const [id] of activeSessions) {
    removeActive(id);
  }
  scheduler.stop();
  wss.close();
  server.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { removeActive };
