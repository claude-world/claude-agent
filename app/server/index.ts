/**
 * Claude Agent — Express server assembly.
 *
 * Architecture inspired by Claude Code's service layer pattern:
 * - Routes are modular (routes/*.ts)
 * - Middleware is extracted (middleware/*.ts)
 * - WebSocket handling is separate (ws/handler.ts)
 * - This file is pure assembly: no business logic, just wiring.
 */

import express from "express";
import cors from "cors";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import store from "./db.ts";
import { TelegramBridge } from "./telegram.ts";
import { DiscordBridge } from "./discord.ts";
import scheduler from "./scheduler.ts";
import { createWSHandler } from "./ws/handler.ts";
import { startUpdateChecker } from "./update-checker.ts";

// Route modules
import { createSessionsRouter } from "./routes/sessions.ts";
import { createSettingsRouter } from "./routes/settings.ts";
import { createProjectRouter } from "./routes/project.ts";
import { createSkillsRouter } from "./routes/skills.ts";
import { createAgentsRouter } from "./routes/agents.ts";
import { createMcpRouter } from "./routes/mcp.ts";
import { createCliRouter } from "./routes/cli.ts";
import { createMemoryRouter } from "./routes/memory.ts";
import { createHistoryRouter } from "./routes/history.ts";
import { createScheduledTasksRouter } from "./routes/scheduled-tasks.ts";
import { createSecretsRouter } from "./routes/secrets.ts";
import { createChannelsRouter } from "./routes/channels.ts";
import { createDiscussionsRouter } from "./routes/discussions.ts";
import { createRolesRouter } from "./routes/roles.ts";
import { createSystemRouter } from "./routes/system.ts";
import { createVectorMemoryRouter } from "./routes/vector-memory.ts";
import { createAgenticRouter } from "./routes/agentic.ts";
import { createGoalsRouter } from "./routes/goals.ts";
import { hybridMemory } from "./memory/hybrid-store.ts";
import { AgenticExecutorRegistry } from "./agentic/executor.ts";
import { goalLoop } from "./goal-loop/engine.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Constants ───────────────────────────────────────────────────────
const PORT = 3456;
const HOST = "127.0.0.1";

const ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

// ── AGENT_ROOT resolution ───────────────────────────────────────────
function resolveAgentRoot(): string {
  if (process.env.AGENT_ROOT) return process.env.AGENT_ROOT;
  try {
    const saved = store.getSetting("agent_root");
    if (saved && fs.existsSync(path.join(saved, "CLAUDE.md"))) return saved;
  } catch {}
  const relative = path.resolve(__dirname, "../..");
  if (fs.existsSync(path.join(relative, "CLAUDE.md"))) return relative;
  const fallback = path.join(process.env.HOME || "", ".claude-agent", "project");
  return fs.existsSync(fallback) ? fallback : relative;
}

const AGENT_ROOT = resolveAgentRoot();
process.env.AGENT_ROOT = AGENT_ROOT;
console.log(`[Server] AGENT_ROOT: ${AGENT_ROOT}`);

// ── Channel bridges ─────────────────────────────────────────────────
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
    bridges.telegram.stop(); bridges.telegram = null;
  } else if (platform === "discord" && bridges.discord) {
    bridges.discord.stop(); bridges.discord = null;
  }
}

function restartBridge(platform: "telegram" | "discord") {
  stopBridge(platform);
  const acct = store.listChannelAccounts().find(a => a.platform === platform && a.enabled);
  if (acct && acct.bot_token) {
    if (platform === "telegram") {
      const bridge = new TelegramBridge(store);
      bridge.start(acct.bot_token, acct.allowed_users);
      bridges.telegram = bridge;
    } else {
      const bridge = new DiscordBridge(store);
      bridge.start(acct.bot_token, acct.allowed_users);
      bridges.discord = bridge;
    }
  }
}

// ── Express app ─────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

// Serve built client in production
const distDir = path.join(__dirname, "../dist/client");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("/", (_req, res) => { res.sendFile(path.join(distDir, "index.html")); });
}

// ── HTTP server + WebSocket ─────────────────────────────────────────
const server = createServer(app);
const { wss, activeSessions, getOrCreateActive, removeActive, broadcastProject, broadcastExecution } =
  createWSHandler(server, AGENT_ROOT, ALLOWED_ORIGINS);

// ── Mount route modules ─────────────────────────────────────────────
app.use("/api/sessions", createSessionsRouter({ removeActive }));
app.use("/api/settings", createSettingsRouter({ restartBridge }));
app.use("/api/project", createProjectRouter({ agentRoot: AGENT_ROOT }));
app.use("/api/skills", createSkillsRouter({ agentRoot: AGENT_ROOT }));
app.use("/api/agents", createAgentsRouter({ agentRoot: AGENT_ROOT }));
app.use("/api/mcp", createMcpRouter({ agentRoot: AGENT_ROOT }));
app.use("/api", createCliRouter({ agentRoot: AGENT_ROOT }));
app.use("/api/memory", createVectorMemoryRouter());  // vector routes first (avoid /:filename wildcard shadow)
app.use("/api/memory", createMemoryRouter({ agentRoot: AGENT_ROOT }));
app.use("/api/history", createHistoryRouter());
app.use("/api/scheduled-tasks", createScheduledTasksRouter());
app.use("/api/secrets", createSecretsRouter());
app.use("/api/channels", createChannelsRouter({ bridges, restartBridge, stopBridge }));
app.use("/api/projects", createDiscussionsRouter({ broadcastProject }));
app.use("/api/roles", createRolesRouter({ bridges }));
app.use("/api", createSystemRouter({ activeSessions, bridges, getOrCreateActive }));

// New Agentic OS routes (Phase 1-4)
app.use("/api/executions", createAgenticRouter({ broadcastExecution }));
app.use("/api/goals", createGoalsRouter());

// ── PID file ────────────────────────────────────────────────────────
const PID_FILE = path.join(process.env.HOME || "/tmp", ".claude-agent", "server.pid");
function writePidFile() {
  try {
    const dir = path.dirname(PID_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
  } catch {}
}
function removePidFile() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch {}
}

// ── Error handlers ──────────────────────────────────────────────────
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[Server] Port ${PORT} is already in use. Exiting.`);
    process.exit(1);
  }
  console.error("[Server] Uncaught exception (non-fatal):", err.stack || err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection (non-fatal):", reason);
});

// ── Start server ────────────────────────────────────────────────────
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[Server] Port ${PORT} is already in use. Exiting.`);
    process.exit(1);
  }
  console.error("[Server] Fatal server error:", err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  writePidFile();
  console.log(`Claude Agent server running at http://${HOST}:${PORT} (PID: ${process.pid})`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT}/ws`);

  try { startBridges(); } catch (err) { console.error("[Bridges] Auto-start error:", err); }
  try { startUpdateChecker(); } catch (err) { console.error("[UpdateChecker] Start error:", err); }

  try {
    scheduler.start();
    scheduler.setDeliveryCallback((chatId, platform, text) => {
      if (platform === 'telegram' && bridges.telegram) {
        (bridges.telegram as any).safeSend?.(chatId, text);
      } else if (platform === 'discord' && bridges.discord) {
        console.log(`[Scheduler] Discord delivery to ${chatId}: ${text.slice(0, 100)}...`);
      }
    });
  } catch (err) { console.error("[Scheduler] Auto-start error:", err); }

  // Initialize Hybrid Memory (Phase 2)
  hybridMemory.init().then(() => {
    hybridMemory.syncFromSqlite();
    console.log("[HybridMemory] Initialized");
  }).catch(err => console.error("[HybridMemory] Init error:", err));

  // Resume interrupted agentic executions (Phase 3)
  try { AgenticExecutorRegistry.resumeInterrupted(); } catch {}

  // Start Goal Loop (Phase 4)
  try {
    goalLoop.setDeliveryCallback((chatId, platform, text) => {
      if (platform === 'telegram' && bridges.telegram) {
        (bridges.telegram as any).safeSend?.(chatId, text);
      } else if (platform === 'discord' && bridges.discord) {
        console.log(`[GoalLoop] Discord delivery to ${chatId}: ${text.slice(0, 100)}`);
      }
    });
    goalLoop.start();
    console.log("[GoalLoop] Started");
  } catch (err) { console.error("[GoalLoop] Start error:", err); }
});

// ── Graceful shutdown ───────────────────────────────────────────────
let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("[Server] Shutting down gracefully...");

  for (const [id] of activeSessions) { try { removeActive(id); } catch {} }
  try { if (bridges.telegram) bridges.telegram.stop(); if (bridges.discord) bridges.discord.stop(); } catch {}
  scheduler.stop();
  try { for (const client of wss.clients) { try { client.terminate(); } catch {} } wss.close(); } catch {}

  server.close(() => { removePidFile(); console.log("[Server] Shutdown complete."); process.exit(0); });
  setTimeout(() => { console.error("[Server] Graceful shutdown timed out, forcing exit."); removePidFile(); process.exit(1); }, 8000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { removeActive };
