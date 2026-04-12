import { Router } from "express";
import store from "../db.ts";

// Keys the client is permitted to write via PUT /api/settings
const WRITABLE_SETTINGS = new Set([
  "language", "model_default", "default_cli", "webhook_secret",
  "agent_root", "autostart",
]);

/** Strip sensitive values before sending settings to the client. */
function sanitiseSettings(all: Record<string, string>): Record<string, string> {
  const { webhook_secret, ...safe } = all;
  safe.webhook_secret_set = webhook_secret ? "true" : "false";
  return safe;
}

export function createSettingsRouter(deps: {
  restartBridge: (platform: "telegram" | "discord") => void;
}): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      res.json(sanitiseSettings(store.getAllSettings()));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/", (req, res) => {
    try {
      const updates = req.body ?? {};
      const oldDefaultCli = store.getSetting("default_cli");
      for (const [key, value] of Object.entries(updates)) {
        if (typeof value === "string" && WRITABLE_SETTINGS.has(key)) {
          store.setSetting(key, value);
        }
      }
      const newDefaultCli = store.getSetting("default_cli");
      if (oldDefaultCli !== newDefaultCli && newDefaultCli) {
        console.log(`[Settings] default_cli changed: ${oldDefaultCli} → ${newDefaultCli}`);
        const accounts = store.listChannelAccounts();
        for (const acct of accounts) {
          if (acct.enabled) {
            deps.restartBridge(acct.platform as "telegram" | "discord");
          }
        }
      }
      res.json(sanitiseSettings(store.getAllSettings()));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
