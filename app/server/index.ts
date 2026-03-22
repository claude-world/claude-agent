import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import store from "./db.ts";
import { AgentSession, CliSession, createSession, CONFIG_BOT_PROMPT } from "./agent.ts";
import type { CliType } from "./agent.ts";
import { generateExperts, runDiscussion, generateConclusion } from "./discussion.ts";
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

// claude-agent root — resolve in order:
// 1. AGENT_ROOT env var (set by Electron main or user)
// 2. DB setting "agent_root"
// 3. Relative from __dirname (works in dev mode)
function resolveAgentRoot(): string {
  if (process.env.AGENT_ROOT) return process.env.AGENT_ROOT;
  try {
    const saved = store.getSetting("agent_root");
    if (saved && fs.existsSync(path.join(saved, "CLAUDE.md"))) return saved;
  } catch {}
  const relative = path.resolve(__dirname, "../..");
  if (fs.existsSync(path.join(relative, "CLAUDE.md"))) return relative;
  // Fallback: ~/.claude-agent/project (user can symlink or configure)
  const fallback = path.join(process.env.HOME || "", ".claude-agent", "project");
  return fs.existsSync(fallback) ? fallback : relative;
}
const AGENT_ROOT = resolveAgentRoot();
console.log(`[Server] AGENT_ROOT: ${AGENT_ROOT}`);

// Security: validate that a path is within user's home directory
function validatePath(targetPath: string): string {
  const home = process.env.HOME || require("os").homedir();
  // Block relative paths and traversal
  if (targetPath.includes("..")) {
    throw new Error("Path traversal (..) is not allowed.");
  }
  const resolved = path.resolve(targetPath.replace(/^~/, home));
  if (!resolved.startsWith(home)) {
    throw new Error(`Path must be within home directory. Got: ${resolved}`);
  }
  return resolved;
}

// Security: sanitize directory/file name (strip traversal chars)
function safeName(name: string): string {
  return path.basename(name).replace(/[^a-z0-9._-]/gi, "-");
}

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
  projectId?: string;
}

// -------------------------------------------------------------------
// In-memory session store
// -------------------------------------------------------------------
interface ActiveSession {
  agent: AgentSession | CliSession;
  subscribers: Set<WSClient>;
  isListening: boolean;
  cli: CliType;
}

const activeSessions = new Map<string, ActiveSession>();

// -------------------------------------------------------------------
// Session helpers
// -------------------------------------------------------------------

function getOrCreateActive(sessionId: string, cli: CliType = 'claude'): ActiveSession | null {
  if (activeSessions.has(sessionId)) {
    const existing = activeSessions.get(sessionId)!;
    // If CLI changed, recreate the session with new CLI
    if (existing.cli !== cli) {
      existing.agent instanceof AgentSession
        ? (existing.agent as AgentSession).interrupt()
        : (existing.agent as CliSession).abort();
      activeSessions.delete(sessionId);
    } else {
      return existing;
    }
  }
  const dbSession = store.getSession(sessionId);
  if (!dbSession) return null;

  const agent = createSession(sessionId, AGENT_ROOT, cli);
  const active: ActiveSession = {
    agent,
    subscribers: new Set(),
    isListening: false,
    cli,
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

// broadcastProject is defined as a late-binding function so it can
// reference `wss` which is initialised after the app routes.
let broadcastProject: (projectId: string, payload: any) => void = () => {};

async function startListening(sessionId: string, active: ActiveSession, pendingContent?: string) {
  if (active.isListening) return;
  active.isListening = true;

  if (active.agent instanceof CliSession) {
    // CliSession: single prompt -> single response
    if (!pendingContent) {
      active.isListening = false;
      return;
    }
    try {
      console.log(`[CliSession] Executing via ${active.cli}: "${pendingContent.slice(0, 80)}..."`);
      const output = await (active.agent as CliSession).execute(pendingContent);
      const taggedOutput = `[${active.cli}] ${output}`;
      store.addMessage(sessionId, { role: "assistant", content: taggedOutput });
      broadcast(active, { type: "assistant_message", content: taggedOutput });
      broadcast(active, { type: "result", success: true, cost: null, duration: null });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Session ${sessionId}] CliSession error:`, errorMsg);
      broadcast(active, { type: "error", error: errorMsg });
    } finally {
      active.isListening = false;
    }
    return;
  }

  // AgentSession: streaming SDK
  try {
    for await (const message of (active.agent as AgentSession).getOutputStream()) {
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
    if (active.agent instanceof AgentSession) {
      (active.agent as AgentSession).interrupt();
    } else {
      (active.agent as CliSession).abort();
    }
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
    const oldDefaultCli = store.getSetting("default_cli");
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === "string") {
        store.setSetting(key, value);
      }
    }
    // If default_cli changed, restart bridges so they pick up new CLI
    const newDefaultCli = store.getSetting("default_cli");
    if (oldDefaultCli !== newDefaultCli && newDefaultCli) {
      console.log(`[Settings] default_cli changed: ${oldDefaultCli} → ${newDefaultCli}`);
      // Restart bridges to use new CLI
      const accounts = store.listChannelAccounts();
      for (const acct of accounts) {
        if (acct.enabled) {
          restartBridge(acct.platform as "telegram" | "discord");
        }
      }
    }
    res.json(store.getAllSettings());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------------
// REST: Project directory management
// -------------------------------------------------------------------
app.get("/api/project", (_req, res) => {
  res.json({
    agent_root: AGENT_ROOT,
    has_claude_md: fs.existsSync(path.join(AGENT_ROOT, "CLAUDE.md")),
    has_skills: fs.existsSync(path.join(AGENT_ROOT, ".claude/skills")),
    has_memory: fs.existsSync(path.join(AGENT_ROOT, "memory")),
  });
});

// Open native directory picker (macOS: osascript, Linux: zenity)
app.get("/api/project/browse", async (_req, res) => {
  try {
    const { execSync } = await import("child_process");
    const platform = process.platform;
    let selected = "";

    if (platform === "darwin") {
      selected = execSync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select project directory")'`,
        { encoding: "utf8", timeout: 60000 }
      ).trim().replace(/\/$/, "");
    } else if (platform === "linux") {
      selected = execSync(
        `zenity --file-selection --directory --title="Select project directory" 2>/dev/null`,
        { encoding: "utf8", timeout: 60000 }
      ).trim();
    } else {
      return res.status(400).json({ error: "Directory picker not supported on this platform. Enter path manually." });
    }

    if (selected) {
      res.json({ path: selected });
    } else {
      res.json({ path: null, cancelled: true });
    }
  } catch {
    res.json({ path: null, cancelled: true });
  }
});

app.post("/api/project/init", async (req, res) => {
  try {
    const { project_path } = req.body ?? {};
    if (!project_path) return res.status(400).json({ error: "project_path required" });

    // Security: validate path is within home directory
    const targetDir = validatePath(project_path);

    // Create directory (safe — uses validated path)
    fs.mkdirSync(targetDir, { recursive: true });

    // Copy .claude/ directory using Node fs API (no shell commands)
    const srcClaude = path.join(AGENT_ROOT, ".claude");
    const destClaude = path.join(targetDir, ".claude");
    if (fs.existsSync(srcClaude) && !fs.existsSync(destClaude)) {
      fs.cpSync(srcClaude, destClaude, { recursive: true });
    }

    // Copy CLAUDE.md
    const srcClaudeMd = path.join(AGENT_ROOT, "CLAUDE.md");
    const destClaudeMd = path.join(targetDir, "CLAUDE.md");
    if (fs.existsSync(srcClaudeMd) && !fs.existsSync(destClaudeMd)) {
      fs.copyFileSync(srcClaudeMd, destClaudeMd);
    }

    // Copy .mcp.json
    const srcMcp = path.join(AGENT_ROOT, ".mcp.json");
    const destMcp = path.join(targetDir, ".mcp.json");
    if (fs.existsSync(srcMcp) && !fs.existsSync(destMcp)) {
      fs.copyFileSync(srcMcp, destMcp);
    }

    // Copy memory/ directory using Node fs API (no shell)
    const destMemory = path.join(targetDir, "memory");
    if (!fs.existsSync(destMemory)) {
      const srcMemory = path.join(AGENT_ROOT, "memory");
      if (fs.existsSync(srcMemory)) {
        fs.cpSync(srcMemory, destMemory, { recursive: true });
      } else {
        fs.mkdirSync(destMemory, { recursive: true });
      }
    }

    // Create workspace/
    fs.mkdirSync(path.join(targetDir, "workspace"), { recursive: true });

    // Save path in settings DB
    store.setSetting("agent_root", targetDir);

    // Save to ~/.claude-agent/project.path for Electron to find
    const configDir = path.join(process.env.HOME || "", ".claude-agent");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "project.path"), targetDir, "utf8");

    res.json({ success: true, path: targetDir });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/project/reset", async (req, res) => {
  try {
    const agentRoot = store.getSetting("agent_root") || AGENT_ROOT;

    // Security: validate path is within home directory
    validatePath(agentRoot);

    // Re-copy .claude/ from bundled defaults using Node fs API (no shell)
    const bundledClaude = path.resolve(__dirname, "../../.claude");
    const destClaude = path.join(agentRoot, ".claude");
    if (fs.existsSync(bundledClaude)) {
      if (fs.existsSync(destClaude)) {
        fs.rmSync(destClaude, { recursive: true, force: true });
      }
      fs.cpSync(bundledClaude, destClaude, { recursive: true });
    }

    // Re-copy CLAUDE.md
    const bundledMd = path.resolve(__dirname, "../../CLAUDE.md");
    if (fs.existsSync(bundledMd)) {
      fs.copyFileSync(bundledMd, path.join(agentRoot, "CLAUDE.md"));
    }

    res.json({ success: true, message: "Reset to default configuration" });
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
    const skillFile = path.join(AGENT_ROOT, ".claude/skills", safeName(req.params.name), "SKILL.md");
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
    const skillDir = path.join(AGENT_ROOT, ".claude/skills", safeName(req.params.name));
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
    config.mcpServers[safeName(req.params.name)] = req.body;
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
    delete config.mcpServers[safeName(req.params.name)];
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
// REST: CLI Available (for CLI selector in chat / tasks)
// Returns only the AI CLIs that are actually installed.
// -------------------------------------------------------------------
app.get("/api/cli-available", async (_req, res) => {
  const { execSync } = await import("child_process");
  const clis: string[] = ['claude']; // always available (we're running in it)
  for (const cli of ['codex', 'gemini', 'opencode']) {
    try {
      execSync(`/bin/zsh -lc 'which ${cli}'`, { timeout: 3000 });
      clis.push(cli);
    } catch {}
  }
  res.json(clis);
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

app.post("/api/migrate/run", async (_req, res) => {
  const { execSync } = await import("child_process");
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
// REST: Secrets
// -------------------------------------------------------------------

// GET /api/secrets — list all (masked values)
app.get("/api/secrets", (_req, res) => {
  try {
    res.json(store.listSecrets());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/secrets — create
app.post("/api/secrets", (req, res) => {
  try {
    const { name, value, description, category } = req.body ?? {};
    if (!name || !value) {
      return res.status(400).json({ error: "name and value required" });
    }
    const secret = store.createSecret({ name, value, description, category });
    res.status(201).json(secret);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/secrets/:id — update
app.put("/api/secrets/:id", (req, res) => {
  try {
    const secret = store.updateSecret(req.params.id, req.body ?? {});
    if (!secret) return res.status(404).json({ error: "Secret not found" });
    res.json(secret);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/secrets/:id — delete
app.delete("/api/secrets/:id", (req, res) => {
  try {
    const ok = store.deleteSecret(req.params.id);
    if (!ok) return res.status(404).json({ error: "Secret not found" });
    res.json({ success: true });
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

// Update channel account (edit allowed_users, etc.)
app.patch("/api/channels/:id", (req, res) => {
  try {
    const acct = store.getChannelAccount(req.params.id);
    if (!acct) return res.status(404).json({ error: "Channel account not found" });
    const { allowed_users, enabled, bot_token } = req.body ?? {};
    // Update in DB
    const updated = store.setChannelAccount({
      ...acct,
      bot_token: bot_token ?? acct.bot_token,
      allowed_users: allowed_users ?? acct.allowed_users,
      enabled: enabled !== undefined ? enabled : acct.enabled,
    });
    // Restart bridge to pick up new allowlist
    restartBridge(acct.platform as "telegram" | "discord");
    res.json({ ...updated, bot_token: "***" });
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
// REST: Projects (Discussion)
// -------------------------------------------------------------------

// GET /api/projects — list all projects
app.get("/api/projects", (_req, res) => {
  try {
    res.json(store.listProjects());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects — create project
app.post("/api/projects", (req, res) => {
  try {
    const { name, topic, discussion_mode } = req.body ?? {};
    if (!name || !topic) {
      return res.status(400).json({ error: "name and topic required" });
    }
    const project = store.createProject({ name, topic, discussion_mode });
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/projects/:id — get project detail
app.get("/api/projects/:id", (req, res) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/projects/:id — update project
app.put("/api/projects/:id", (req, res) => {
  try {
    const { experts, status, discussion_mode } = req.body ?? {};
    const project = store.updateProject(req.params.id, { experts, status, discussion_mode });
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/projects/:id — delete project
app.delete("/api/projects/:id", (req, res) => {
  try {
    const ok = store.deleteProject(req.params.id);
    if (!ok) return res.status(404).json({ error: "Project not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/setup-experts — AI-generate experts for the project
app.post("/api/projects/:id/setup-experts", async (req, res) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const experts = await generateExperts(project.topic);
    const updated = store.updateProject(req.params.id, { experts, status: "ready" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/start — start discussion (async, streams via WS)
app.post("/api/projects/:id/start", (req, res) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (project.status === "discussing") {
      return res.status(409).json({ error: "Discussion already running" });
    }

    // Update status immediately (before background discussion starts)
    const pid = req.params.id;
    store.updateProject(pid, { status: "discussing" });

    // Run discussion in background; broadcast events via WebSocket
    runDiscussion(pid, (event) => {
      // Map discussion engine events to client-expected WS message types
      switch (event.type) {
        case 'expert_message':
          broadcastProject(pid, {
            type: "project_expert_message",
            message: {
              id: `dm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              project_id: pid,
              expert_name: event.expert || '',
              cli: event.cli || 'claude',
              content: event.content || '',
              round: event.round || 1,
              created_at: new Date().toISOString(),
            },
          });
          break;
        case 'round_start':
          broadcastProject(pid, { type: "project_round_start", round: event.round });
          break;
        case 'round_end':
          broadcastProject(pid, { type: "project_round_end", round: event.round });
          break;
        case 'conclusion':
          broadcastProject(pid, { type: "project_conclusion", content: event.content });
          break;
        case 'error':
          broadcastProject(pid, { type: "project_error", content: event.content });
          break;
      }
    }).catch((err) => {
      console.error(`[Discussion] Error for project ${pid}:`, err);
      broadcastProject(pid, { type: "project_error", content: String(err) });
    });

    res.json({ started: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/guide — inject user guidance message into ongoing discussion
app.post("/api/projects/:id/guide", (req, res) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { message } = req.body ?? {};
    if (!message) return res.status(400).json({ error: "message required" });

    // Store the guidance as a special system message (round 0)
    store.addDiscussionMessage({
      project_id: req.params.id,
      expert_name: "User",
      cli: "user",
      content: message,
      round: 0,
    });

    broadcastProject(req.params.id, {
      type: "project_expert_message",
      message: {
        id: `guide-${Date.now()}`,
        project_id: req.params.id,
        expert_name: "User",
        cli: "user",
        content: message,
        round: 0,
        created_at: new Date().toISOString(),
      },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/conclude — generate conclusion (async, streams via WS)
app.post("/api/projects/:id/conclude", (req, res) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const cid = req.params.id;
    generateConclusion(cid, (event) => {
      if (event.type === 'conclusion') {
        broadcastProject(cid, { type: "project_conclusion", content: event.content });
      }
    }).catch((err) => {
      console.error(`[Discussion] Conclude error for project ${cid}:`, err);
      broadcastProject(cid, { type: "project_error", content: String(err) });
    });

    res.json({ started: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/abort — stop a running discussion and set status to "discussed"
app.post("/api/projects/:id/abort", (req, res) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Force status to "discussed" (stops the discussion loop from continuing)
    store.updateProject(req.params.id, { status: "discussed" });
    broadcastProject(req.params.id, { type: "project_round_end", round: 99 });

    res.json({ success: true, status: "discussed" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/reset — reset project to setup state (clear messages)
app.post("/api/projects/:id/reset", (req, res) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Clear all discussion messages
    store.clearDiscussionMessages(req.params.id);
    // Reset status to ready (keep experts)
    store.updateProject(req.params.id, { status: "ready" });

    res.json({ success: true, status: "ready" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/projects/:id/messages — get all discussion messages
app.get("/api/projects/:id/messages", (req, res) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(store.getDiscussionMessages(req.params.id));
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

// Wire up the late-bound project broadcaster now that wss exists
broadcastProject = (projectId: string, payload: any) => {
  const str = JSON.stringify({ ...payload, projectId });
  wss.clients.forEach((ws) => {
    const client = ws as WSClient;
    if (
      client.projectId === projectId &&
      client.readyState === WebSocket.OPEN
    ) {
      try {
        client.send(str);
      } catch {
        // ignore disconnected clients
      }
    }
  });
};

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

          const chatCli: CliType = (msg.cli as CliType) || 'claude';
          const active = getOrCreateActive(msg.sessionId, chatCli);
          if (!active) {
            ws.send(
              JSON.stringify({ type: "error", error: "Session not found" })
            );
            break;
          }

          ws.sessionId = msg.sessionId;
          active.subscribers.add(ws);

          // Config bot: prepend system prompt on every message
          const chatContent = msg.configBot
            ? `${CONFIG_BOT_PROMPT}\n\nUser request: ${msg.content}`
            : msg.content;

          store.addMessage(msg.sessionId, {
            role: "user",
            content: msg.content,
          });
          broadcast(active, { type: "user_message", content: msg.content });

          console.log(`[Chat] session=${msg.sessionId.slice(0,8)} cli=${active.cli} configBot=${!!msg.configBot} type=${active.agent instanceof AgentSession ? 'AgentSession' : 'CliSession'}`);

          if (active.agent instanceof AgentSession) {
            (active.agent as AgentSession).sendMessage(chatContent);
            if (!active.isListening) {
              startListening(msg.sessionId, active);
            }
          } else {
            // CliSession: fire one-shot, pass content directly
            if (!active.isListening) {
              startListening(msg.sessionId, active, chatContent);
            }
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

        case "subscribe_project": {
          // Subscribe this WS client to discussion events for a project
          if (!msg.projectId) {
            ws.send(
              JSON.stringify({ type: "error", error: "projectId required" })
            );
            break;
          }
          ws.projectId = msg.projectId;
          // Send back any existing messages as initial state
          const existingMsgs = store.getDiscussionMessages(msg.projectId);
          ws.send(
            JSON.stringify({
              type: "project_history",
              projectId: msg.projectId,
              messages: existingMsgs,
            })
          );
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
