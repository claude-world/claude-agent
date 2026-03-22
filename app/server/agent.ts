import { query } from "@anthropic-ai/claude-code";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import store from "./db.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// claude-agent root: two levels up from app/server/
const AGENT_ROOT = path.resolve(__dirname, "../..");

type UserMessage = {
  type: "user";
  message: { role: "user"; content: string };
};

class QueueClosedError extends Error {
  constructor() {
    super("Queue closed");
    this.name = "QueueClosedError";
  }
}

/**
 * Async iterable message queue.
 * Lets the SDK iterate over user messages as they arrive via WebSocket/channels.
 */
class MessageQueue {
  private messages: UserMessage[] = [];
  private waiting: {
    resolve: (msg: UserMessage) => void;
    reject: (err: Error) => void;
  } | null = null;
  private closed = false;

  push(content: string) {
    if (this.closed) return;

    const msg: UserMessage = {
      type: "user",
      message: { role: "user", content },
    };

    if (this.waiting) {
      this.waiting.resolve(msg);
      this.waiting = null;
    } else {
      this.messages.push(msg);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<UserMessage> {
    while (!this.closed) {
      if (this.messages.length > 0) {
        yield this.messages.shift()!;
      } else {
        try {
          yield await new Promise<UserMessage>((resolve, reject) => {
            this.waiting = { resolve, reject };
          });
        } catch (err) {
          if (err instanceof QueueClosedError) break;
          throw err;
        }
      }
    }
  }

  close() {
    this.closed = true;
    if (this.waiting) {
      this.waiting.reject(new QueueClosedError());
      this.waiting = null;
    }
  }
}

/**
 * Load MCP server configs from the claude-agent root .mcp.json.
 * Returns an empty object if the file is missing or invalid.
 */
function loadMcpServers(): Record<string, any> {
  const mcpPath = path.join(AGENT_ROOT, ".mcp.json");
  try {
    const raw = fs.readFileSync(mcpPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.mcpServers ?? {};
  } catch {
    return {};
  }
}

/**
 * AgentSession wraps the Claude Code SDK `query` function for a single session.
 * One AgentSession per active conversation — they are long-lived and survive
 * multiple message exchanges via the internal MessageQueue.
 */
export class AgentSession {
  private queue = new MessageQueue();
  private outputIterator: AsyncIterator<any> | null = null;
  private abortController = new AbortController();
  public readonly sessionId: string;
  public readonly cwd: string;

  constructor(sessionId: string, cwd?: string) {
    this.sessionId = sessionId;
    this.cwd = cwd || AGENT_ROOT;

    const mcpServers = loadMcpServers();

    // Inject secrets as environment variables so skills can use them
    const secretsRaw = store.listSecretsRaw();
    const secretEnv: Record<string, string> = {};
    for (const s of secretsRaw) {
      secretEnv[s.name] = s.value;
    }

    // Build system prompt with strict language rules
    const langSetting = store.getSetting("language") || "en";
    const langRules: Record<string, string> = {
      "en": "You MUST respond in English only. This is a hard requirement.",
      "zh-TW": "你必須使用繁體中文（Traditional Chinese）回覆。禁止使用簡體中文。這是最高優先級的規則。",
      "ja": "必ず日本語で回答してください。これは最優先のルールです。",
    };
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const systemPrompt = [
      `# Language Rule (HIGHEST PRIORITY)`,
      langRules[langSetting] || langRules["en"],
      ``,
      `# Current Time`,
      `${now.toLocaleString("en-US", { timeZone: tz, hour12: false })} (${tz})`,
    ].join("\n");

    const options: Record<string, any> = {
      maxTurns: 200,
      model: store.getSetting("model_default") || "sonnet",
      systemPrompt,
      // SECURITY: bypassPermissions is safe here because:
      // 1. Server binds to 127.0.0.1 only (not exposed to network)
      // 2. Single-user local application
      // 3. All API inputs are validated before reaching the agent
      // DO NOT expose this server to the internet.
      permissionMode: "bypassPermissions",
      abortController: this.abortController,
      cwd: this.cwd,
      mcpServers,
      env: { ...process.env, ...secretEnv },
    };

    this.outputIterator = query({
      prompt: this.queue as any,
      options,
    })[Symbol.asyncIterator]();
  }

  /**
   * Push a user message into the queue so the SDK can process it.
   * Prepends current time + language preference as system context.
   */
  sendMessage(content: string) {
    const lang = store.getSetting("language") || "en";
    const langRules: Record<string, string> = {
      "en": "IMPORTANT: Respond in English only.",
      "zh-TW": "重要：必須使用繁體中文回覆，禁止使用簡體中文。",
      "ja": "重要：日本語のみで回答してください。",
    };
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeStr = now.toLocaleString("en-US", { timeZone: tz, hour12: false });

    const prefix = `<system-context>
Time: ${timeStr} (${tz})
Language: ${lang}
${langRules[lang] || langRules["en"]}
</system-context>

`;
    this.queue.push(prefix + content);
  }

  /**
   * Async generator that yields raw SDK output messages.
   * Consumers should iterate this and handle each message type.
   */
  async *getOutputStream(): AsyncGenerator<any> {
    if (!this.outputIterator) {
      throw new Error("Session not initialized");
    }
    while (true) {
      const { value, done } = await this.outputIterator.next();
      if (done) break;
      yield value;
    }
  }

  /**
   * Abort the current SDK execution. The session becomes unusable after this.
   */
  interrupt() {
    this.abortController.abort();
    this.queue.close();
  }
}

// -------------------------------------------------------------------
// Multi-CLI support
// -------------------------------------------------------------------

export type CliType = 'claude' | 'codex' | 'gemini' | 'opencode';

// -------------------------------------------------------------------
// Config Bot
// -------------------------------------------------------------------

export const CONFIG_BOT_PROMPT = `You are the Config Bot for Claude Agent system. Your job is to help users configure the system through natural language.

You have access to Bash tool and can call the local API at http://127.0.0.1:3456 to manage everything.

## Available APIs (use curl to call them):

### Settings
- GET http://127.0.0.1:3456/api/settings — view all settings
- PUT http://127.0.0.1:3456/api/settings — update (JSON body: {language, model_default, default_cli})

### Skills (49 skills)
- GET http://127.0.0.1:3456/api/skills — list all
- POST http://127.0.0.1:3456/api/skills/import — add skill (JSON: {name, content})
- DELETE http://127.0.0.1:3456/api/skills/:name — delete
- GET http://127.0.0.1:3456/api/skills/export — export all as JSON

### Agents (4 agents)
- GET http://127.0.0.1:3456/api/agents — list all
- POST http://127.0.0.1:3456/api/agents/import — add agent (JSON: {name, content})
- DELETE http://127.0.0.1:3456/api/agents/:name — delete
- GET http://127.0.0.1:3456/api/agents/export — export all

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

### Scheduled Tasks
- GET http://127.0.0.1:3456/api/scheduled-tasks — list
- POST http://127.0.0.1:3456/api/scheduled-tasks — create (JSON: {name, prompt, agent, schedule, timezone})
- PUT http://127.0.0.1:3456/api/scheduled-tasks/:id — update
- DELETE http://127.0.0.1:3456/api/scheduled-tasks/:id — delete
- POST http://127.0.0.1:3456/api/scheduled-tasks/:id/run — trigger manually

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

## Rules
- Always confirm before destructive operations (delete)
- Show results after each operation
- Use the user's language preference (check settings first)
- Be concise — show what changed, not verbose explanations
`;

import { spawn, ChildProcess } from "child_process";

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
      "en": "Respond in English.",
      "zh-TW": "必須使用繁體中文回覆，禁止使用簡體中文。",
      "ja": "日本語で回答してください。",
    };
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    parts.push(`Current time: ${now.toLocaleString("en-US", { timeZone: tz, hour12: false })} (${tz})`);
    parts.push(langRules[lang] || langRules["en"]);

    // Detect skill invocation (e.g. /weather, /spotify)
    const skillMatch = prompt.match(/^\/(\S+)/);
    if (skillMatch) {
      const skillName = skillMatch[1];
      const skillFile = path.join(this.cwd, ".claude", "skills", skillName, "SKILL.md");
      if (fs.existsSync(skillFile)) {
        const skillContent = fs.readFileSync(skillFile, "utf8").slice(0, 3000);
        parts.push(`\n[Skill: ${skillName}]\n${skillContent}\n`);
      }
    }

    // Inject secrets as env var hints
    const secrets = store.listSecretsRaw();
    if (secrets.length > 0) {
      parts.push(`\nAvailable environment variables: ${secrets.map(s => s.name).join(", ")}`);
    }

    // Inject MCP server info
    const mcpFile = path.join(this.cwd, ".mcp.json");
    if (fs.existsSync(mcpFile)) {
      try {
        const mcp = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
        const servers = Object.keys(mcp.mcpServers || {});
        if (servers.length > 0) {
          parts.push(`\nMCP servers configured: ${servers.join(", ")} (use via CLI tools if supported)`);
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
    const enrichedPrompt = context ? `${context}\n\n---\n\nUser request: ${prompt}` : prompt;

    return new Promise((resolve, reject) => {
      // Build command based on CLI type
      const cmdMap: Record<string, string[]> = {
        codex: ['codex', 'exec', '--full-auto', '--skip-git-repo-check', enrichedPrompt],
        gemini: ['gemini', enrichedPrompt],
        opencode: ['opencode', enrichedPrompt],
      };

      const args = cmdMap[this.cli];
      if (!args) return reject(new Error(`Unknown CLI: ${this.cli}`));

      // Use login shell to get full PATH
      const shellCmd = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');

      // Inject secrets as env vars for the subprocess
      const secretEnv: Record<string, string> = {};
      for (const s of store.listSecretsRaw()) {
        secretEnv[s.name] = s.value;
      }

      this.proc = spawn('/bin/zsh', ['-lc', shellCmd], {
        cwd: this.cwd,
        env: { ...process.env, ...secretEnv },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      this.proc.stdout?.on('data', (d) => { stdout += d.toString(); });
      this.proc.stderr?.on('data', (d) => { stderr += d.toString(); });

      const timeout = setTimeout(() => {
        this.proc?.kill('SIGTERM');
        reject(new Error(`${this.cli} timed out after 120s`));
      }, 120000);

      this.proc.on('close', (code) => {
        clearTimeout(timeout);
        this.proc = null;
        if (code !== 0 && !stdout) {
          reject(new Error(stderr || `${this.cli} exited with code ${code}`));
        } else {
          resolve(stdout || stderr);
        }
      });

      this.proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  abort() {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      setTimeout(() => { this.proc?.kill('SIGKILL'); }, 3000);
    }
  }
}

/**
 * Factory: create the right session type based on CLI selection.
 */
export function createSession(sessionId: string, cwd: string, cli: CliType = 'claude'): AgentSession | CliSession {
  if (cli === 'claude') {
    return new AgentSession(sessionId, cwd);
  }
  return new CliSession(cli, cwd);
}
