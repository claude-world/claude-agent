import { spawn, execSync, ChildProcess } from "child_process";
import { createInterface } from "readline";
import path from "path";
import fs from "fs";
import store from "./db.ts";
import type { Role } from "./db.ts";
import { AGENT_ROOT } from "./paths.ts";
import { LANG_RULES_FULL, LANG_RULES_SHORT } from "./constants/languages.ts";
import { COMPACT_PROMPT, formatCompactSummary } from "./prompts/compact.ts";
export { CONFIG_BOT_PROMPT } from "./prompts/config-bot.ts";

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
  private role: Role | null = null;
  private chatMemory: Record<string, string> = {};
  public readonly sessionId: string;
  public readonly cwd: string;

  // Turn tracking — inspired by Claude Code's autoCompact.ts context management.
  private _turnCount = 0;
  private static readonly MAX_TURNS_BEFORE_ROTATE = 50;
  private static readonly WARN_TURNS_THRESHOLD = 40;

  // Compact carry-over: when session rotates, a summary is generated and
  // injected into the first message of the new session.
  // Ported from Claude Code's compact/prompt.ts pattern.
  private pendingSummary: string | null = null;

  constructor(sessionId: string, cwd?: string, role?: Role, chatMemory?: Record<string, string>) {
    this.sessionId = sessionId;
    this.cwd = cwd || AGENT_ROOT;
    this.role = role || null;
    this.chatMemory = chatMemory || {};
  }

  /**
   * Queue a user message. The message will be processed when getOutputStream() is iterated.
   * Prepends current time + language preference as system context.
   */
  sendMessage(content: string) {
    const lang = this.role?.language || store.getSetting("language") || "en";
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
    let message = prefix + content;

    // Inject compact summary from previous session rotation (Claude Code pattern)
    if (this.pendingSummary) {
      message = `<previous-session-summary>\n${this.pendingSummary}\n</previous-session-summary>\n\n${message}`;
      this.pendingSummary = null;
    }

    this.pendingMessage = message;

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

    // Build full system prompt from role config (or CLAUDE.md) + language/time rules
    // Using --system-prompt (replaces default) instead of --append-system-prompt
    // so the assistant identifies as a personal assistant, NOT a coding assistant
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const parts: string[] = [];

    if (this.role) {
      // Role-based system prompt
      parts.push(`# Identity\nYou are ${this.role.name}.\n`);
      if (this.role.personality) {
        parts.push(`# Personality\n${this.role.personality}\n`);
      }
      // Inject per-chat memory
      const memEntries = Object.entries(this.chatMemory);
      if (memEntries.length > 0) {
        parts.push(`# Conversation Memory (this chat only)`);
        for (const [k, v] of memEntries) {
          parts.push(`- ${k}: ${v}`);
        }
        parts.push('');
      }
      if (this.role.knowledge_context) {
        parts.push(`# Knowledge\n${this.role.knowledge_context}\n`);
      }
      parts.push(`# Reply Style\nReply in a ${this.role.reply_style} manner.\n`);
      if (this.role.allowed_skills.length > 0) {
        parts.push(`# Available Skills\nYou may use these skills: ${this.role.allowed_skills.map(s => '/' + s).join(', ')}\n`);
      }
      parts.push(`# Memory Instructions\nWhen you learn something important in this conversation, output it as:\n[SAVE_MEMORY] key: value\nThis will be saved and remembered for future conversations in this chat.\n`);
      // Language from role
      const langSetting = this.role.language;
      parts.push(`# Language Rule (HIGHEST PRIORITY)`);
      parts.push(LANG_RULES_FULL[langSetting] || LANG_RULES_FULL["en"]);
    } else {
      // Default: load CLAUDE.md
      const claudeMdPath = path.join(this.cwd, "CLAUDE.md");
      if (fs.existsSync(claudeMdPath)) {
        parts.push(fs.readFileSync(claudeMdPath, "utf8"));
      }
      const langSetting = store.getSetting("language") || "en";
      parts.push(`\n# Language Rule (HIGHEST PRIORITY)`);
      parts.push(LANG_RULES_FULL[langSetting] || LANG_RULES_FULL["en"]);
    }

    // Context health warning (inspired by Claude Code's contextSuggestions.ts)
    if (this._turnCount >= AgentSession.WARN_TURNS_THRESHOLD) {
      parts.push(`\n# Context Health`);
      parts.push(`This session has ${this._turnCount} turns (limit: ${AgentSession.MAX_TURNS_BEFORE_ROTATE}).`);
      parts.push(`Be concise. Avoid repeating information already discussed.`);
    }

    // Time always appended
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

  /** Current turn count for this session */
  get turnCount(): number { return this._turnCount; }

  /** Increment turn counter. Called after each complete assistant response. */
  incrementTurn(): void { this._turnCount++; }

  /** Whether the session should rotate (context getting full) */
  get shouldRotate(): boolean {
    return this._turnCount >= AgentSession.MAX_TURNS_BEFORE_ROTATE;
  }

  /** Whether to warn the user about upcoming rotation */
  get shouldWarnRotation(): boolean {
    return this._turnCount >= AgentSession.WARN_TURNS_THRESHOLD
      && this._turnCount < AgentSession.MAX_TURNS_BEFORE_ROTATE;
  }

  /**
   * Rotate the session: generate a compact summary of the conversation,
   * then clear the CLI session ID so the next message starts fresh with
   * the summary injected. Ported from Claude Code's autoCompact pattern.
   */
  private rotating = false;

  async rotate(): Promise<void> {
    if (this.rotating) return; // prevent double-rotation
    this.rotating = true;

    console.log(`[AgentSession ${this.sessionId}] Rotating session after ${this._turnCount} turns`);

    // Generate compact summary before clearing (if we have a session to summarize)
    if (this.claudeSessionId) {
      try {
        this.pendingSummary = await this.generateCompactSummary();
        if (this.pendingSummary) {
          console.log(`[AgentSession ${this.sessionId}] Generated compact summary (${this.pendingSummary.length} chars)`);
        }
      } catch (err) {
        console.error(`[AgentSession ${this.sessionId}] Failed to generate compact summary:`, err);
      }
    }

    if (this.proc) {
      killProcessGroup(this.proc);
      this.proc = null;
    }
    this.claudeSessionId = null;
    this._turnCount = 0;
    this.rotating = false;
  }

  /**
   * Generate a compact summary of the current session using Claude Code's
   * 9-section format. Uses haiku for speed and cost efficiency.
   * Ported from Claude Code src/services/compact/prompt.ts.
   */
  private async generateCompactSummary(): Promise<string | null> {
    if (!this.claudeSessionId) return null;

    return new Promise((resolve) => {
      // Inject secrets (same as spawnClaude) so API key is available
      const secretEnv: Record<string, string> = {};
      for (const s of store.listSecretsRaw()) {
        if (!RESERVED_ENV.has(s.name) && !s.name.includes("\0")) {
          secretEnv[s.name] = s.value;
        }
      }

      const child = spawn(CLAUDE_PATH, [
        "-p", COMPACT_PROMPT,
        "--resume", this.claudeSessionId!,
        "--model", "haiku",
        "--output-format", "text",
        "--max-turns", "1",
      ], {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...secretEnv },
      });

      let stdout = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", () => {}); // drain silently

      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        console.warn(`[AgentSession ${this.sessionId}] Compact summary timed out`);
        resolve(null);
      }, 20000); // 20s timeout for summary generation

      child.on("close", () => {
        clearTimeout(timeout);
        const summary = stdout ? formatCompactSummary(stdout) : null;
        resolve(summary);
      });

      child.on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
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

// CONFIG_BOT_PROMPT is now in prompts/config-bot.ts (re-exported above)

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
  cli: CliType = "claude",
  role?: Role,
  chatMemory?: Record<string, string>
): AgentSession | CliSession {
  if (cli === "claude") {
    return new AgentSession(sessionId, cwd, role, chatMemory);
  }
  return new CliSession(cli, cwd);
}

// Re-export executor types for gradual migration
export type { IExecutor, ExecutorType, ExecutorConfig, ExecutorStreamEvent } from "./executors/types.ts";
export { createExecutor } from "./executors/factory.ts";
