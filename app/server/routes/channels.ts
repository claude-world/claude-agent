import { Router } from "express";
import store from "../db.ts";
import type { TelegramBridge } from "../telegram.ts";
import type { DiscordBridge } from "../discord.ts";

export function createChannelsRouter(deps: {
  bridges: { telegram: TelegramBridge | null; discord: DiscordBridge | null };
  restartBridge: (platform: "telegram" | "discord") => void;
  stopBridge: (platform: "telegram" | "discord") => void;
}): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      const accounts = store.listChannelAccounts().map((a) => ({
        ...a,
        bot_token: a.bot_token ? "***" : "",
      }));
      res.json(accounts);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/", (req, res) => {
    try {
      const { platform, bot_token, allowed_users, enabled } = req.body ?? {};
      if (!platform || !bot_token) return res.status(400).json({ error: "platform and bot_token required" });
      const account = store.setChannelAccount({ platform, bot_token, allowed_users, enabled });
      res.status(201).json({ ...account, bot_token: "***" });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      const acct = store.getChannelAccount(req.params.id);
      const ok = store.deleteChannelAccount(req.params.id);
      if (!ok) return res.status(404).json({ error: "Channel account not found" });
      if (acct) deps.stopBridge(acct.platform as "telegram" | "discord");
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch("/:id", (req, res) => {
    try {
      const acct = store.getChannelAccount(req.params.id);
      if (!acct) return res.status(404).json({ error: "Channel account not found" });
      const { allowed_users, enabled, bot_token } = req.body ?? {};
      const updated = store.setChannelAccount({
        ...acct,
        bot_token: bot_token ?? acct.bot_token,
        allowed_users: allowed_users ?? acct.allowed_users,
        enabled: enabled !== undefined ? enabled : acct.enabled,
      });
      if (updated.enabled) {
        deps.restartBridge(acct.platform as "telegram" | "discord");
      } else {
        deps.stopBridge(acct.platform as "telegram" | "discord");
      }
      res.json({ ...updated, bot_token: "***" });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/status", (_req, res) => {
    res.json({
      telegram: { running: deps.bridges.telegram !== null },
      discord: { running: deps.bridges.discord !== null },
    });
  });

  router.post("/:id/start", (req, res) => {
    try {
      const acct = store.getChannelAccount(req.params.id);
      if (!acct) return res.status(404).json({ error: "Not found" });
      deps.restartBridge(acct.platform as "telegram" | "discord");
      res.json({ success: true, platform: acct.platform, running: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/:id/stop", (req, res) => {
    try {
      const acct = store.getChannelAccount(req.params.id);
      if (!acct) return res.status(404).json({ error: "Not found" });
      deps.stopBridge(acct.platform as "telegram" | "discord");
      res.json({ success: true, platform: acct.platform, running: false });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
