import { spawn, execSync, ChildProcess } from "child_process";
import { createInterface } from "readline";
import path from "path";
import fs from "fs";
import store from "./db.ts";
import { AGENT_ROOT } from "./paths.ts";

// Shared language rules (used by both sendMessage prefix and spawnClaude system prompt)
const LANG_RULES_FULL: Record<string, string> = {
  en: "You MUST respond in English only. This is a hard requirement.",
  "zh-TW": "你必須使用繁體中文（Traditional Chinese）回覆。禁止使用簡體中文。這是最高優先級的規則。",
  ja: "必ず日本語で回答してください。これは最優先のルールです。",
};
const LANG_RULES_SHORT: Record<string, string> = {
  en: "IMPORTANT: Respond in English only.",
  "zh-TW": "重要：必須使用繁體中文回覆，禁止使用簡體中文。",
  ja: "重要：日本語のみで回答してください。",
};

/**
 * Resolve the path to the `claude` executable.
 * Searches: login shell PATH, common global install locations.
 */
function resolveClaudePath(): string {
  try {
    return execSync("/bin/zsh -lc 'which claude'", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    // Fallback: common install locations
    const candidates = [
      path.join(process.env.HOME || "", ".npm-global/bin/claude"),
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return "claude"; // hope it's in PATH
  }
}

const CLAUDE_PATH = resolveClaudePath();

// Environment variable names that must never be overridden by user secrets
const RESERVED_ENV = new Set([
  "HOME", "PATH", "NODE_OPTIONS", "ZDOTDIR", "SHELL", "USER", "LANG", "TERM",
]);

/**
 * Kill a process and its entire process group.
 * Using a negative PID sends the signal to the whole group,
 * ensuring child processes spawned by the shell wrapper are also terminated.
 */
function killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  try {
    if (proc.pid) process.kill(-proc.pid, signal);
  } catch {
    try { proc.kill(signal); } catch {}
  }
}

/**
 * AgentSession wraps the Claude CLI for a single conversation.
 *
 * Architecture:
 * - Each user message spawns a `claude -p ... --output-format stream-json` subprocess
 * - Subsequent messages use `--resume <sessionId>` to maintain conversation context
 * - Output is parsed line-by-line as JSON and yielded to consumers
 * - The same interface as the previous SDK-based approach is maintained
 */
export class AgentSession {
  private proc: ChildProcess | null = null;
  private claudeSessionId: string | null = null;
  private pendingMessage: string | null = null;
  private generation = 0; // incremented each time a new process is spawned
  public readonly sessionId: string;
  public readonly cwd: string;

  constructor(sessionId: string, cwd?: string) {
    this.sessionId = sessionId;
    this.cwd = cwd || AGENT_ROOT;
  }

  /**
   * Queue a user message. The message will be processed when getOutputStream() is iterated.
   * Prepends current time + language preference as system context.
   */
  sendMessage(content: string) {
    const lang = store.getSetting("language") || "en";
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeStr = now.toLocaleString("en-US", {
      timeZone: tz,
      hour12: false,
    });

    const prefix = `<system-context>
Time: ${timeStr} (${tz})
Language: ${lang}
${LANG_RULES_SHORT[lang] || LANG_RULES_SHORT["en"]}
</system-context>

`;
    this.pendingMessage = prefix + content;

    // Start the CLI process for this message (increment generation to invalidate old streams)
    this.generation++;
    this.spawnClaude(this.pendingMessage);
  }

  /**
   * Spawn a claude CLI subprocess with streaming JSON output.
   */
  private spawnClaude(prompt: string) {
    // Kill any existing process
    if (this.proc) {
      killProcessGroup(this.proc);
      this.proc = null;
    }

    // Build full system prompt from CLAUDE.md + language/time rules
    // Using --system-prompt (replaces default) instead of --append-system-prompt
    // so the assistant identifies as a personal assistant, NOT a coding assistant
    const langSetting = store.getSetting("language") || "en";
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const parts: string[] = [];

    // Load CLAUDE.md as the primary identity
    const claudeMdPath = path.join(this.cwd, "CLAUDE.md");
    if (fs.existsSync(claudeMdPath)) {
      parts.push(fs.readFileSync(claudeMdPath, "utf8"));
    }

    // Append language + time rules
    parts.push(`\n# Language Rule (HIGHEST PRIORITY)`);
    parts.push(LANG_RULES_FULL[langSetting] || LANG_RULES_FULL["en"]);
    parts.push(`\n# Current Time`);
    parts.push(`${now.toLocaleString("en-US", { timeZone: tz, hour12: false })} (${tz})`);

    const systemPrompt = parts.join("\n");
    const model = store.getSetting("model_default") || "sonnet";

    // Build CLI args
    const args: string[] = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose", // required by CLI when using stream-json with --print
      "--model",
      model,
      "--system-prompt",
      systemPrompt,
      // SECURITY: bypassPermissions is safe here because:
      // 1. Server binds to 127.0.0.1 only (not exposed to network)
      // 2. Single-user local application
      // 3. All API inputs are validated before reaching the agent
      // DO NOT expose this server to the internet.
      "--dangerously-skip-permissions",
      "--allow-dangerously-skip-permissions",
    ];

    // Resume previous session for conversation continuity
    if (this.claudeSessionId) {
      args.push("--resume", this.claudeSessionId);
    }

    // Inject secrets as environment variables (skip reserved names to avoid breaking the subprocess)
    const secretsRaw = store.listSecretsRaw();
    const secretEnv: Record<string, string> = {};
    for (const s of secretsRaw) {
      if (!RESERVED_ENV.has(s.name) && !s.name.includes("\0")) {
        secretEnv[s.name] = s.value;
      }
    }

    // Use login shell to get full PATH (critical for Electron/Finder launches)
    const shellCmd = [CLAUDE_PATH, ...args]
      .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
      .join(" ");

    this.proc = spawn("/bin/zsh", ["-lc", shellCmd], {
      cwd: this.cwd,
      env: { ...process.env, ...secretEnv },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    // Log stderr for debugging (but don't expose to user)
    this.proc.stderr?.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error(`[AgentSession ${this.sessionId}] stderr: ${msg.slice(0, 200)}`);
      }
    });
  }

  /**
   * Async generator that yields SDK-compatible output messages.
   * Parses the streaming JSON output from the Claude CLI.
   * Each line of stdout is a JSON object matching the SDK message format.
   */
  async *getOutputStream(): AsyncGenerator<any> {
    if (!this.proc?.stdout) {
      throw new Error("Session not initialized — call sendMessage first");
    }

    // Capture current generation so we can detect if the process was replaced
    const myGeneration = this.generation;
    const rl = createInterface({ input: this.proc.stdout });

    try {
      for await (const line of rl) {
        // If a new process was spawned (sendMessage called again), stop reading old output
        if (this.generation !== myGeneration) break;
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          // Capture the session_id from init message for --resume
          if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
            this.claudeSessionId = msg.session_id;
          }

          yield msg;
        } catch {
          // Skip non-JSON lines (progress indicators, etc.)
        }
      }
    } finally {
      rl.close();
    }

    // Wait for process to exit (only if still the current generation)
    if (this.generation === myGeneration && this.proc) {
      const closingProc = this.proc;
      // If process already exited, skip waiting (prevents hung promise from missed event)
      if (closingProc.exitCode !== null) {
        if (this.proc === closingProc) this.proc = null;
      } else {
        await new Promise<void>((resolve) => {
          closingProc.on("close", () => {
            if (this.proc === closingProc) this.proc = null;
            resolve();
          });
        });
      }
    }
  }

  /**
   * Abort the current CLI execution.
   */
  interrupt() {
    if (this.proc) {
      const proc = this.proc;
      this.proc = null;
      killProcessGroup(proc, "SIGTERM");
      setTimeout(() => { killProcessGroup(proc, "SIGKILL"); }, 3000);
    }
  }
}

// -------------------------------------------------------------------
// Multi-CLI support
// -------------------------------------------------------------------

export type CliType = "claude" | "codex" | "gemini" | "opencode";

// -------------------------------------------------------------------
// Config Bot
// -------------------------------------------------------------------

export const CONFIG_BOT_PROMPT = `You are the Config Bot for Claude Agent system. Your ONLY job is to help users configure EXISTING settings through the local REST API.

IMPORTANT RULES:
- ONLY read and modify settings via the API endpoints listed below
- NEVER create new files, write code, or build anything
- NEVER suggest editing source code or config files directly
- Just call the API with curl and show the results
- Be concise — show what changed, nothing else

You have access to Bash tool. Use curl to call the local API at http://127.0.0.1:3456.

## Available APIs (use curl to call them):

### Settings
- GET http://127.0.0.1:3456/api/settings — view all settings
- PUT http://127.0.0.1:3456/api/settings — update (JSON body: {language, model_default, default_cli})

### Skills (49 skills)
- GET http://127.0.0.1:3456/api/skills — list all
- POST http://127.0.0.1:3456/api/skills/import — add skill (JSON: {name, content})
- DELETE http://127.0.0.1:3456/api/skills/:name — delete
- GET http://127.0.0.1:3456/api/skills/export — export all as JSON
- GET http://127.0.0.1:3456/api/skills/:name/raw — get skill source
- POST http://127.0.0.1:3456/api/skills/import-bundle — bulk import (JSON: {skills: [{name, content}]})

### Agents (4 agents)
- GET http://127.0.0.1:3456/api/agents — list all
- POST http://127.0.0.1:3456/api/agents/import — add agent (JSON: {name, content})
- DELETE http://127.0.0.1:3456/api/agents/:name — delete
- GET http://127.0.0.1:3456/api/agents/export — export all
- GET http://127.0.0.1:3456/api/agents/:name/raw — get agent source

### MCP Servers
- GET http://127.0.0.1:3456/api/mcp — list configured servers
- POST http://127.0.0.1:3456/api/mcp/:name — add server (JSON config)
- DELETE http://127.0.0.1:3456/api/mcp/:name — remove server

### Secrets (API tokens/credentials)
- GET http://127.0.0.1:3456/api/secrets — list (values masked)
- POST http://127.0.0.1:3456/api/secrets — add (JSON: {name, value, description, category})
- PUT http://127.0.0.1:3456/api/secrets/:id — update
- DELETE http://127.0.0.1:3456/api/secrets/:id — delete

### Channels (Telegram/Discord)
- GET http://127.0.0.1:3456/api/channels — list
- POST http://127.0.0.1:3456/api/channels — add (JSON: {platform, bot_token, allowed_users, enabled})
- PATCH http://127.0.0.1:3456/api/channels/:id — edit (JSON: {allowed_users, bot_token, enabled})
- DELETE http://127.0.0.1:3456/api/channels/:id — delete
- POST http://127.0.0.1:3456/api/channels/:id/start — start bridge
- POST http://127.0.0.1:3456/api/channels/:id/stop — stop bridge
- GET http://127.0.0.1:3456/api/channels/status — bridge connection status

### Scheduled Tasks
- GET http://127.0.0.1:3456/api/scheduled-tasks — list
- POST http://127.0.0.1:3456/api/scheduled-tasks — create (JSON: {name, prompt, agent, schedule, timezone})
- PUT http://127.0.0.1:3456/api/scheduled-tasks/:id — update
- DELETE http://127.0.0.1:3456/api/scheduled-tasks/:id — delete
- POST http://127.0.0.1:3456/api/scheduled-tasks/:id/run — trigger manually
- PATCH http://127.0.0.1:3456/api/scheduled-tasks/:id/toggle — enable/disable (JSON: {enabled})
- GET http://127.0.0.1:3456/api/scheduled-tasks/:id/executions — execution history

### Project
- GET http://127.0.0.1:3456/api/project — current project info
- POST http://127.0.0.1:3456/api/project/init — initialize project directory (JSON: {project_path})
- POST http://127.0.0.1:3456/api/project/reset — reset to defaults

### CLI Detection
- GET http://127.0.0.1:3456/api/cli-detect — detect installed CLIs
- GET http://127.0.0.1:3456/api/cli-available — list available AI CLIs

### Migration
- GET http://127.0.0.1:3456/api/migrate/check — check OpenClaw installation
- POST http://127.0.0.1:3456/api/migrate/run — run migration

### Memory
- GET http://127.0.0.1:3456/api/memory — list memory files
- GET http://127.0.0.1:3456/api/memory/:filename — read memory file
- PUT http://127.0.0.1:3456/api/memory/:filename — update memory file (JSON: {content})

### Projects (Expert Discussion)
- GET http://127.0.0.1:3456/api/projects — list all projects
- POST http://127.0.0.1:3456/api/projects — create (JSON: {name, topic, discussion_mode})
- GET http://127.0.0.1:3456/api/projects/:id — get project detail
- PUT http://127.0.0.1:3456/api/projects/:id — update project
- DELETE http://127.0.0.1:3456/api/projects/:id — delete project
- POST http://127.0.0.1:3456/api/projects/:id/setup-experts — auto-generate experts
- POST http://127.0.0.1:3456/api/projects/:id/start — start discussion
- POST http://127.0.0.1:3456/api/projects/:id/conclude — generate conclusion
- POST http://127.0.0.1:3456/api/projects/:id/abort — stop discussion
- POST http://127.0.0.1:3456/api/projects/:id/reset — clear and restart

### History & Search
- GET http://127.0.0.1:3456/api/history?search=keyword&limit=50 — search across sessions

### System
- GET http://127.0.0.1:3456/api/health — server health check
- GET http://127.0.0.1:3456/api/export — full data backup (JSON)
- GET http://127.0.0.1:3456/api/stats — usage statistics

## Rules
- ONLY use curl to call the APIs above — never edit files directly
- Always confirm before destructive operations (delete)
- Show results after each operation
- Use the user's language preference (check GET /api/settings first)
- Be concise — show what changed, not verbose explanations
- If the user asks for something outside of configuration, tell them to use the main chat instead
`;

/**
 * CliSession: execute prompts via non-Claude CLI tools.
 * Each CLI is invoked as a subprocess. Output is collected and returned.
 */
export class CliSession {
  private proc: ChildProcess | null = null;
  private cwd: string;
  private cli: CliType;

  constructor(cli: CliType, cwd: string) {
    this.cli = cli;
    this.cwd = cwd;
  }

  /**
   * Build context prefix from CLAUDE.md + relevant skill if detected.
   */
  private buildContext(prompt: string): string {
    const parts: string[] = [];

    // Inject CLAUDE.md summary
    const claudeMd = path.join(this.cwd, "CLAUDE.md");
    if (fs.existsSync(claudeMd)) {
      const content = fs.readFileSync(claudeMd, "utf8").slice(0, 2000);
      parts.push(`[Project instructions from CLAUDE.md]\n${content}\n`);
    }

    // Inject language + time
    const lang = store.getSetting("language") || "en";
    const langRules: Record<string, string> = {
      en: "Respond in English.",
      "zh-TW": "必須使用繁體中文回覆，禁止使用簡體中文。",
      ja: "日本語で回答してください。",
    };
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    parts.push(
      `Current time: ${now.toLocaleString("en-US", { timeZone: tz, hour12: false })} (${tz})`
    );
    parts.push(langRules[lang] || langRules["en"]);

    // Detect skill invocation (e.g. /weather, /spotify)
    const skillMatch = prompt.match(/^\/(\S+)/);
    if (skillMatch) {
      const skillName = skillMatch[1];
      const skillFile = path.join(
        this.cwd,
        ".claude",
        "skills",
        skillName,
        "SKILL.md"
      );
      if (fs.existsSync(skillFile)) {
        const skillContent = fs.readFileSync(skillFile, "utf8").slice(0, 3000);
        parts.push(`\n[Skill: ${skillName}]\n${skillContent}\n`);
      }
    }

    // Inject secrets as env var hints
    const secrets = store.listSecretsRaw();
    if (secrets.length > 0) {
      parts.push(
        `\nAvailable environment variables: ${secrets.map((s) => s.name).join(", ")}`
      );
    }

    // Inject MCP server info
    const mcpFile = path.join(this.cwd, ".mcp.json");
    if (fs.existsSync(mcpFile)) {
      try {
        const mcp = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
        const servers = Object.keys(mcp.mcpServers || {});
        if (servers.length > 0) {
          parts.push(
            `\nMCP servers configured: ${servers.join(", ")} (use via CLI tools if supported)`
          );
        }
      } catch {}
    }

    return parts.join("\n");
  }

  /**
   * Execute a prompt via the CLI and return the full output.
   * Injects project context (CLAUDE.md, skills, secrets, MCP) into the prompt.
   * Uses login shell to ensure PATH includes user-installed CLIs.
   */
  async execute(prompt: string): Promise<string> {
    // Build enriched prompt with project context
    const context = this.buildContext(prompt);
    const enrichedPrompt = context
      ? `${context}\n\n---\n\nUser request: ${prompt}`
      : prompt;

    return new Promise((resolve, reject) => {
      // Build command based on CLI type
      const cmdMap: Record<string, string[]> = {
        codex: [
          "codex",
          "exec",
          "--full-auto",
          "--skip-git-repo-check",
          enrichedPrompt,
        ],
        gemini: ["gemini", enrichedPrompt],
        opencode: ["opencode", enrichedPrompt],
      };

      const args = cmdMap[this.cli];
      if (!args) return reject(new Error(`Unknown CLI: ${this.cli}`));

      // Use login shell to get full PATH
      const shellCmd = args
        .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
        .join(" ");

      // Inject secrets as env vars for the subprocess (skip reserved names)
      const secretEnv: Record<string, string> = {};
      for (const s of store.listSecretsRaw()) {
        if (!RESERVED_ENV.has(s.name) && !s.name.includes("\0")) {
          secretEnv[s.name] = s.value;
        }
      }

      this.proc = spawn("/bin/zsh", ["-lc", shellCmd], {
        cwd: this.cwd,
        env: { ...process.env, ...secretEnv },
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      let stdout = "";
      let stderr = "";

      this.proc.stdout?.on("data", (d) => {
        stdout += d.toString();
      });
      this.proc.stderr?.on("data", (d) => {
        stderr += d.toString();
      });

      const timeout = setTimeout(() => {
        const timedOutProc = this.proc;
        this.proc = null;
        if (timedOutProc) {
          killProcessGroup(timedOutProc, "SIGTERM");
          setTimeout(() => { killProcessGroup(timedOutProc, "SIGKILL"); }, 3000);
        }
        reject(new Error(`${this.cli} timed out after 120s`));
      }, 120000);

      this.proc.on("close", (code) => {
        clearTimeout(timeout);
        this.proc = null;
        if (code !== 0 && !stdout) {
          reject(
            new Error(stderr || `${this.cli} exited with code ${code}`)
          );
        } else {
          resolve(stdout || stderr);
        }
      });

      this.proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  abort() {
    if (this.proc) {
      const proc = this.proc;
      this.proc = null;
      killProcessGroup(proc, "SIGTERM");
      setTimeout(() => { killProcessGroup(proc, "SIGKILL"); }, 3000);
    }
  }
}

/**
 * Factory: create the right session type based on CLI selection.
 */
export function createSession(
  sessionId: string,
  cwd: string,
  cli: CliType = "claude"
): AgentSession | CliSession {
  if (cli === "claude") {
    return new AgentSession(sessionId, cwd);
  }
  return new CliSession(cli, cwd);
}
