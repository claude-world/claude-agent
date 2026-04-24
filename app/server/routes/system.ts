import { Router } from "express";
import { timingSafeEqual } from "crypto";
import store from "../db.ts";
import { AgentSession, CliSession } from "../agent.ts";
import type { CliType } from "../agent.ts";
import { checkRateLimit } from "../middleware/rate-limiter.ts";
import type { ActiveSession } from "../ws/handler.ts";
import type { TelegramBridge } from "../telegram.ts";
import type { DiscordBridge } from "../discord.ts";
import { checkForUpdates, getCachedUpdateInfo } from "../update-checker.ts";
import { getAutostartStatus, enableAutostart, disableAutostart } from "../autostart.ts";
import { sanitiseSettings } from "./settings.ts";

export function createSystemRouter(deps: {
  activeSessions: Map<string, ActiveSession>;
  bridges: { telegram: TelegramBridge | null; discord: DiscordBridge | null };
  getOrCreateActive: (sessionId: string, cli?: CliType) => ActiveSession | null;
}): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const currentVersion = getCachedUpdateInfo().currentVersion;
    res.json({
      status: "ok",
      app: "claude-agent",
      version: currentVersion,
      uptime_seconds: Math.floor(uptime),
      memory_mb: Math.floor(mem.rss / 1024 / 1024),
      active_sessions: deps.activeSessions.size,
      bridges: {
        telegram: deps.bridges.telegram !== null,
        discord: deps.bridges.discord !== null,
      },
    });
  });

  router.get("/export", (_req, res) => {
    try {
      const currentVersion = getCachedUpdateInfo().currentVersion;
      const sessions = store.listAllSessions();
      const allMessages: Record<string, any[]> = {};
      for (const s of sessions) allMessages[s.id] = store.getAllMessages(s.id);
      const safeSettings = sanitiseSettings(store.getAllSettings());
      res.setHeader("Content-Disposition", `attachment; filename=claude-agent-backup-${new Date().toISOString().slice(0, 10)}.json`);
      res.json({
        exported_at: new Date().toISOString(), version: currentVersion,
        sessions, messages: allMessages, settings: safeSettings,
        scheduled_tasks: store.listScheduledTasks(),
        projects: store.listProjects(),
        channels: store.listChannelAccounts().map((a) => ({ ...a, bot_token: "***" })),
      });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.get("/stats", (_req, res) => {
    try {
      const sessionCount = store.countSessions();
      const executions = store.listTaskExecutions(undefined, 1000);
      const totalCost = executions.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
      res.json({
        sessions: { total: sessionCount, active: deps.activeSessions.size },
        scheduled_tasks: {
          total_executions: executions.length,
          successful: executions.filter((e) => e.status === "success").length,
          failed: executions.filter((e) => e.status === "error").length,
          total_cost_usd: Math.round(totalCost * 100) / 100,
        },
        uptime_seconds: Math.floor(process.uptime()),
      });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  // ── Update checker ─────────────────────────────────────────────────
  router.get("/update-info", (_req, res) => {
    res.json(getCachedUpdateInfo());
  });

  router.post("/check-update", async (_req, res) => {
    try {
      const result = await checkForUpdates();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Auto-start on boot ──────────────────────────────────────────────
  router.get("/autostart", (_req, res) => {
    res.json(getAutostartStatus());
  });

  router.post("/autostart", (req, res) => {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled (boolean) required" });
    }
    const result = enabled ? enableAutostart() : disableAutostart();
    if (result.error) {
      return res.status(500).json(result);
    }
    res.json(result);
  });

  router.post("/webhook", async (req, res) => {
    try {
      const { message, sender, channel, secret } = req.body ?? {};
      if (!message) return res.status(400).json({ error: "message required" });

      const senderKey = sender || channel || "webhook";
      if (!checkRateLimit(`webhook:${senderKey}`)) return res.status(429).json({ error: "Rate limit exceeded" });

      const webhookSecret = store.getSetting("webhook_secret");
      if (!webhookSecret) return res.status(403).json({ error: "Webhook secret is not configured" });
      const a = Buffer.from(String(secret || ""));
      const b = Buffer.from(webhookSecret);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: "Invalid webhook secret" });

      const sessionTitle = `Webhook:${senderKey}`;
      let session = store.findSessionByTitle(sessionTitle);
      if (!session) session = store.createSession(sessionTitle);

      const defaultCli = (store.getSetting("default_cli") as CliType) || "claude";
      const active = deps.getOrCreateActive(session.id, defaultCli);
      if (!active) return res.status(500).json({ error: "Failed to create session" });
      if (active.isListening) return res.status(429).json({ error: "Session is busy processing a previous message" });

      active.isListening = true;
      store.addMessage(session.id, { role: "user", content: message });

      try {
        if (active.agent instanceof AgentSession) {
          (active.agent as AgentSession).sendMessage(message);
          let response = "";
          try {
            for await (const msg of (active.agent as AgentSession).getOutputStream()) {
              if (msg.type === "assistant") {
                const content = msg.message?.content;
                if (typeof content === "string") response += content;
                else if (Array.isArray(content)) {
                  for (const block of content) { if (block.type === "text" && block.text) response += block.text; }
                }
              } else if (msg.type === "result") break;
            }
          } catch (err) { response = `Error: ${err instanceof Error ? err.message : String(err)}`; }
          store.addMessage(session.id, { role: "assistant", content: response });
          res.json({ session_id: session.id, response: response || "(no response)" });
        } else {
          try {
            const output = await (active.agent as CliSession).execute(message);
            store.addMessage(session.id, { role: "assistant", content: output });
            res.json({ session_id: session.id, response: output });
          } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
        }
      } finally { active.isListening = false; }
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  return router;
}
