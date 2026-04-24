import { Router } from "express";
import store from "../db.ts";
import { validatePath } from "../middleware/security.ts";

// Keys the client is permitted to write via PUT /api/settings
const WRITABLE_SETTINGS = new Set([
  "language", "model_default", "default_cli", "webhook_secret",
  "agent_root", "autostart",
  "executor_default",
  "executor_anthropic_api_key",
  "executor_openai_api_key",
  "executor_openai_model",
  "executor_grok_api_key",
  "executor_gemini_api_key",
  "executor_ollama_base_url",
  "executor_ollama_model",
]);

const SENSITIVE_SETTINGS = new Set([
  "webhook_secret",
  "executor_anthropic_api_key",
  "executor_openai_api_key",
  "executor_grok_api_key",
  "executor_gemini_api_key",
]);

/** Strip sensitive values before sending settings to the client. */
export function sanitiseSettings(all: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (SENSITIVE_SETTINGS.has(key)) {
      safe[`${key}_set`] = value ? "true" : "false";
    } else {
      safe[key] = value;
    }
  }
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
          if (key === "agent_root") {
            try {
              store.setSetting(key, validatePath(value));
            } catch (err) {
              return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
            }
          } else if (SENSITIVE_SETTINGS.has(key) && value === "" && key !== "webhook_secret") {
            continue;
          } else {
            store.setSetting(key, value);
          }
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
