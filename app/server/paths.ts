import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the claude-agent project root directory.
 * Priority: AGENT_ROOT env var → DB setting → relative from source → fallback.
 *
 * NOTE: We avoid importing store here to prevent circular dependencies.
 * The DB setting is checked by reading the SQLite file directly via the
 * env var that index.ts sets after resolving.
 */
export function resolveAgentRoot(): string {
  // 1. Environment variable (set by Electron or user, or propagated by index.ts)
  if (process.env.AGENT_ROOT) return process.env.AGENT_ROOT;

  // 2. Read from config file if available
  try {
    const configFile = path.join(process.env.HOME || "", ".claude-agent", "project.path");
    if (fs.existsSync(configFile)) {
      const saved = fs.readFileSync(configFile, "utf8").trim();
      if (saved && fs.existsSync(path.join(saved, "CLAUDE.md"))) return saved;
    }
  } catch {}

  // 3. Relative from source (works in dev mode)
  const relative = path.resolve(__dirname, "../..");
  if (fs.existsSync(path.join(relative, "CLAUDE.md"))) return relative;

  // 4. Fallback
  const fallback = path.join(process.env.HOME || "", ".claude-agent", "project");
  return fs.existsSync(fallback) ? fallback : relative;
}

/** Cached result — resolved once at module load */
export const AGENT_ROOT = resolveAgentRoot();
