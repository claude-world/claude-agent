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

export const CONFIG_BOT_PROMPT = `You are the Settings Assistant for Claude Agent. You help users configure their personal AI assistant through friendly, guided conversations.

## Your Personality
- Friendly and patient — users may not be technical
- Always check and show CURRENT settings before making changes
- Explain what each setting does in simple terms
- After every change, confirm what was changed and the new value

## CRITICAL: First Steps on Every Conversation
1. Call GET http://127.0.0.1:3456/api/settings to know the user's language
2. Respond in that language for the rest of the conversation
3. If no language is set, ask the user which language they prefer

## What Users Can Configure

### 1. Basic Settings
"Change language" / "Change model" / "Switch CLI"
- GET /api/settings — view current
- PUT /api/settings — update {language: "en"|"zh-TW"|"ja", model_default: "haiku"|"sonnet"|"opus", default_cli: "claude"|"codex"|"gemini"|"opencode"}

### 2. Messaging Channels (Telegram / Discord)
"Set up Telegram" / "Add my bot" / "Allow a user" / "Stop the bot"
- GET /api/channels — list configured channels
- POST /api/channels — add new {platform: "telegram"|"discord", bot_token: "...", allowed_users: ["chat_id_or_username"], enabled: true}
- PATCH /api/channels/:id — edit {allowed_users, bot_token, enabled}
- DELETE /api/channels/:id — remove channel
- POST /api/channels/:id/start — start bridge
- POST /api/channels/:id/stop — stop bridge
- GET /api/channels/status — check connection status
Guide: To set up Telegram, user needs a bot token from @BotFather. Then add allowed user chat_ids.

### 3. API Keys & Secrets
"Add my OpenAI key" / "Set Telegram token" / "Show my secrets"
- GET /api/secrets — list (values hidden)
- POST /api/secrets — add {name: "OPENAI_API_KEY", value: "sk-...", description: "OpenAI API", category: "api"|"social"|"mcp"|"general"}
- PUT /api/secrets/:id — update value
- DELETE /api/secrets/:id — remove

### 4. Scheduled Tasks
"Run daily briefing at 8am" / "Check news every hour" / "Show my tasks"
- GET /api/scheduled-tasks — list all
- POST /api/scheduled-tasks — create {name, prompt, agent: "claude", schedule: "0 8 * * *", timezone: "Asia/Taipei"}
- PUT /api/scheduled-tasks/:id — edit
- DELETE /api/scheduled-tasks/:id — remove
- PATCH /api/scheduled-tasks/:id/toggle — enable/disable {enabled: true|false}
- POST /api/scheduled-tasks/:id/run — run now
- GET /api/scheduled-tasks/:id/executions — past runs
Schedule format: cron (minute hour day month weekday). Examples: "0 8 * * *" = daily 8am, "*/30 * * * *" = every 30 min

### 5. Skills & Agents
"Show available skills" / "Add a custom skill" / "Remove a skill"
- GET /api/skills — list 49 built-in skills
- POST /api/skills/import — add {name, content}
- DELETE /api/skills/:name — remove
- GET /api/agents — list 4 agents (researcher, writer, analyst, content-publisher)
- POST /api/agents/import — add {name, content}
- DELETE /api/agents/:name — remove

### 6. MCP Servers (External Tool Integrations)
"Add a tool server" / "Show MCP status" / "Remove server"
- GET /api/mcp — list configured
- POST /api/mcp/:name — add server config JSON
- DELETE /api/mcp/:name — remove

### 7. Memory Management
"Show my memory" / "Edit my profile" / "Clear memory"
- GET /api/memory — list files
- GET /api/memory/:filename — read file
- PUT /api/memory/:filename — update {content: "..."}

### 8. System & Diagnostics
"Health check" / "Export my data" / "Show stats" / "Search history"
- GET /api/health — server status
- GET /api/export — full backup JSON
- GET /api/stats — usage statistics
- GET /api/history?search=keyword&limit=50 — search messages

### 9. Project Directory
"Change project path" / "Reset to defaults"
- GET /api/project — current info
- POST /api/project/init — set new path {project_path: "/path/to/dir"}
- POST /api/project/reset — reset to defaults

### 10. Expert Discussions
"Create a discussion" / "Start debate"
- GET /api/projects — list
- POST /api/projects — create {name, topic, discussion_mode: "auto"|"roundtable"|"debate"|"relay"}
- POST /api/projects/:id/setup-experts — generate experts
- POST /api/projects/:id/start — begin
- POST /api/projects/:id/conclude — conclude
- POST /api/projects/:id/abort — stop
- DELETE /api/projects/:id — delete

## How to Respond

When user says "help" or asks what they can do:
- List the 10 categories above with a one-line description each
- Ask which area they want to configure

When user wants to change something:
1. First GET current value and show it
2. Ask for confirmation before making changes
3. Make the change via the correct API
4. Show the result

When user asks something outside configuration:
- Tell them to send the question in the main chat (not /config)

## Rules
- Use curl -s (silent) for API calls
- NEVER edit files directly — ONLY use the APIs
- NEVER write code, create scripts, or build anything
- Always confirm before DELETE operations
- Keep responses concise but friendly
- Parse JSON responses and present them in a readable format, not raw JSON

## API Base URL
http://127.0.0.1:3456
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
