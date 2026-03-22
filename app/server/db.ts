import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store DB in user home directory so it persists across app updates
const HOME_DATA_DIR = path.join(process.env.HOME || os.homedir(), ".claude-agent", "data");
if (!fs.existsSync(HOME_DATA_DIR)) {
  fs.mkdirSync(HOME_DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(HOME_DATA_DIR, "claude-agent.db");

const db = new Database(DB_PATH);

// WAL mode: better concurrent read performance
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Session',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT,
    tool_name TEXT,
    tool_input TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channel_accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    bot_token TEXT NOT NULL DEFAULT '',
    allowed_users TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    agent TEXT DEFAULT 'claude',
    schedule TEXT NOT NULL,
    timezone TEXT DEFAULT 'Asia/Taipei',
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_executions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'running',
    output TEXT,
    error TEXT,
    cost_usd REAL,
    duration_ms INTEGER,
    triggered_by TEXT DEFAULT 'schedule',
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    topic TEXT NOT NULL,
    discussion_mode TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL DEFAULT 'setup',
    experts TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS discussion_messages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    expert_name TEXT NOT NULL,
    cli TEXT NOT NULL DEFAULT 'claude',
    content TEXT NOT NULL,
    round INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Indices for performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_channel_accounts_platform ON channel_accounts(platform);
  CREATE INDEX IF NOT EXISTS idx_task_executions_task ON task_executions(task_id);
  CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);
  CREATE INDEX IF NOT EXISTS idx_secrets_name ON secrets(name);
  CREATE INDEX IF NOT EXISTS idx_disc_msg_project ON discussion_messages(project_id);
`);

// Types
export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: "active" | "archived";
}

export interface Message {
  id: number;
  session_id: string;
  role: "user" | "assistant" | "tool_use" | "tool_result";
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  created_at: string;
}

export interface ChannelAccount {
  id: string;
  platform: "telegram" | "discord";
  bot_token: string;
  allowed_users: string[];
  enabled: boolean;
  created_at: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  agent: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskExecution {
  id: string;
  task_id: string;
  status: "running" | "success" | "error";
  output: string | null;
  error: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  triggered_by: string;
  started_at: string;
  completed_at: string | null;
}

export interface Secret {
  id: string;
  name: string;
  value: string;
  description: string;
  category: "general" | "social" | "api" | "mcp";
  created_at: string;
  updated_at: string;
}

export interface Expert {
  name: string;
  role: string;
  cli: string;
  systemPrompt: string;
  skills?: string[];
}

export interface Project {
  id: string;
  name: string;
  topic: string;
  discussion_mode: string;
  status: string;
  experts: Expert[];
  created_at: string;
  updated_at: string;
}

export interface DiscussionMessage {
  id: string;
  project_id: string;
  expert_name: string;
  cli: string;
  content: string;
  round: number;
  created_at: string;
}

// Prepared statements
const stmts = {
  // Sessions
  createSession: db.prepare(
    `INSERT INTO sessions (id, title) VALUES (?, ?)`
  ),
  getSession: db.prepare(
    `SELECT * FROM sessions WHERE id = ? AND status != 'deleted'`
  ),
  listSessions: db.prepare(
    `SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC`
  ),
  updateSessionTitle: db.prepare(
    `UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  touchSession: db.prepare(
    `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`
  ),
  deleteSession: db.prepare(
    `UPDATE sessions SET status = 'deleted', updated_at = datetime('now') WHERE id = ?`
  ),

  // Messages
  addMessage: db.prepare(
    `INSERT INTO messages (session_id, role, content, tool_name, tool_input)
     VALUES (?, ?, ?, ?, ?)`
  ),
  getMessages: db.prepare(
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC`
  ),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`
  ),
  getAllSettings: db.prepare(`SELECT key, value FROM settings`),

  // Channel accounts
  upsertChannelAccount: db.prepare(
    `INSERT OR REPLACE INTO channel_accounts (id, platform, bot_token, allowed_users, enabled)
     VALUES (?, ?, ?, ?, ?)`
  ),
  getChannelAccount: db.prepare(`SELECT * FROM channel_accounts WHERE id = ?`),
  listChannelAccounts: db.prepare(
    `SELECT * FROM channel_accounts ORDER BY created_at ASC`
  ),
  listChannelAccountsByPlatform: db.prepare(
    `SELECT * FROM channel_accounts WHERE platform = ? ORDER BY created_at ASC`
  ),
  deleteChannelAccount: db.prepare(`DELETE FROM channel_accounts WHERE id = ?`),

  // Scheduled tasks
  listScheduledTasks: db.prepare(
    `SELECT * FROM scheduled_tasks ORDER BY created_at DESC`
  ),
  getScheduledTask: db.prepare(
    `SELECT * FROM scheduled_tasks WHERE id = ?`
  ),
  insertScheduledTask: db.prepare(
    `INSERT INTO scheduled_tasks (id, name, prompt, agent, schedule, timezone, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  updateScheduledTask: db.prepare(
    `UPDATE scheduled_tasks SET name = ?, prompt = ?, agent = ?, schedule = ?,
     timezone = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteScheduledTask: db.prepare(
    `DELETE FROM scheduled_tasks WHERE id = ?`
  ),
  toggleScheduledTask: db.prepare(
    `UPDATE scheduled_tasks SET enabled = ?, updated_at = datetime('now') WHERE id = ?`
  ),

  // Secrets
  listSecrets: db.prepare(`SELECT * FROM secrets ORDER BY name ASC`),
  getSecret: db.prepare(`SELECT * FROM secrets WHERE id = ?`),
  getSecretByName: db.prepare(`SELECT * FROM secrets WHERE name = ?`),
  insertSecret: db.prepare(
    `INSERT INTO secrets (id, name, value, description, category) VALUES (?, ?, ?, ?, ?)`
  ),
  updateSecret: db.prepare(
    `UPDATE secrets SET value = ?, description = ?, category = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteSecret: db.prepare(`DELETE FROM secrets WHERE id = ?`),

  // Projects
  listProjects: db.prepare(
    `SELECT * FROM projects ORDER BY updated_at DESC`
  ),
  getProject: db.prepare(
    `SELECT * FROM projects WHERE id = ?`
  ),
  insertProject: db.prepare(
    `INSERT INTO projects (id, name, topic, discussion_mode, status, experts)
     VALUES (?, ?, ?, ?, 'setup', '[]')`
  ),
  updateProject: db.prepare(
    `UPDATE projects SET experts = COALESCE(?, experts),
     status = COALESCE(?, status),
     discussion_mode = COALESCE(?, discussion_mode),
     updated_at = datetime('now')
     WHERE id = ?`
  ),
  deleteProject: db.prepare(
    `DELETE FROM projects WHERE id = ?`
  ),

  // Discussion messages
  insertDiscussionMessage: db.prepare(
    `INSERT INTO discussion_messages (id, project_id, expert_name, cli, content, round)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  getDiscussionMessages: db.prepare(
    `SELECT * FROM discussion_messages WHERE project_id = ? ORDER BY round ASC, created_at ASC`
  ),

  // Task executions
  insertTaskExecution: db.prepare(
    `INSERT INTO task_executions (id, task_id, status, triggered_by)
     VALUES (?, ?, 'running', ?)`
  ),
  updateTaskExecution: db.prepare(
    `UPDATE task_executions SET status = ?, output = ?, error = ?,
     cost_usd = ?, duration_ms = ?, completed_at = datetime('now') WHERE id = ?`
  ),
  listTaskExecutions: db.prepare(
    `SELECT * FROM task_executions WHERE task_id = ? ORDER BY started_at DESC LIMIT ?`
  ),
  listAllTaskExecutions: db.prepare(
    `SELECT * FROM task_executions ORDER BY started_at DESC LIMIT ?`
  ),
};

function parseChannelAccount(row: any): ChannelAccount {
  return {
    ...row,
    allowed_users: JSON.parse(row.allowed_users || "[]"),
    enabled: Boolean(row.enabled),
  };
}

function parseProject(row: any): Project {
  return {
    ...row,
    experts: JSON.parse(row.experts || "[]"),
  };
}

function parseScheduledTask(row: any): ScheduledTask {
  return {
    ...row,
    enabled: Boolean(row.enabled),
  };
}

function parseTaskExecution(row: any): TaskExecution {
  return { ...row };
}

export const store = {
  // Sessions
  createSession(title?: string): Session {
    const id = randomUUID();
    stmts.createSession.run(id, title || "New Session");
    return stmts.getSession.get(id) as Session;
  },

  getSession(id: string): Session | undefined {
    return stmts.getSession.get(id) as Session | undefined;
  },

  listSessions(): Session[] {
    return stmts.listSessions.all() as Session[];
  },

  deleteSession(id: string): boolean {
    const result = stmts.deleteSession.run(id);
    return result.changes > 0;
  },

  // Messages
  addMessage(
    sessionId: string,
    msg: {
      role: "user" | "assistant" | "tool_use" | "tool_result";
      content?: string | null;
      tool_name?: string | null;
      tool_input?: string | null;
    }
  ): Message {
    const result = stmts.addMessage.run(
      sessionId,
      msg.role,
      msg.content ?? null,
      msg.tool_name ?? null,
      msg.tool_input ?? null
    );
    stmts.touchSession.run(sessionId);

    // Auto-generate title from the first user message
    const session = stmts.getSession.get(sessionId) as Session | undefined;
    if (session && session.title === "New Session" && msg.role === "user" && msg.content) {
      const title =
        msg.content.slice(0, 50) + (msg.content.length > 50 ? "..." : "");
      stmts.updateSessionTitle.run(title, sessionId);
    }

    return {
      id: result.lastInsertRowid as number,
      session_id: sessionId,
      role: msg.role,
      content: msg.content ?? null,
      tool_name: msg.tool_name ?? null,
      tool_input: msg.tool_input ?? null,
      created_at: new Date().toISOString(),
    };
  },

  getMessages(sessionId: string): Message[] {
    return stmts.getMessages.all(sessionId) as Message[];
  },

  // Settings
  getSetting(key: string): string | undefined {
    const row = stmts.getSetting.get(key) as { value: string } | undefined;
    return row?.value;
  },

  setSetting(key: string, value: string): void {
    stmts.setSetting.run(key, value);
  },

  getAllSettings(): Record<string, string> {
    const rows = stmts.getAllSettings.all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  },

  // Channel accounts
  setChannelAccount(data: {
    id?: string;
    platform: "telegram" | "discord";
    bot_token: string;
    allowed_users?: string[];
    enabled?: boolean;
  }): ChannelAccount {
    const id = data.id || randomUUID();
    stmts.upsertChannelAccount.run(
      id,
      data.platform,
      data.bot_token,
      JSON.stringify(data.allowed_users ?? []),
      data.enabled !== false ? 1 : 0
    );
    return parseChannelAccount(stmts.getChannelAccount.get(id));
  },

  getChannelAccount(id: string): ChannelAccount | undefined {
    const row = stmts.getChannelAccount.get(id);
    if (!row) return undefined;
    return parseChannelAccount(row);
  },

  listChannelAccounts(): ChannelAccount[] {
    return (stmts.listChannelAccounts.all() as any[]).map(parseChannelAccount);
  },

  listChannelAccountsByPlatform(platform: string): ChannelAccount[] {
    return (stmts.listChannelAccountsByPlatform.all(platform) as any[]).map(
      parseChannelAccount
    );
  },

  deleteChannelAccount(id: string): boolean {
    const result = stmts.deleteChannelAccount.run(id);
    return result.changes > 0;
  },

  // Scheduled tasks
  listScheduledTasks(): ScheduledTask[] {
    return (stmts.listScheduledTasks.all() as any[]).map(parseScheduledTask);
  },

  getScheduledTask(id: string): ScheduledTask | undefined {
    const row = stmts.getScheduledTask.get(id);
    if (!row) return undefined;
    return parseScheduledTask(row);
  },

  createScheduledTask(data: {
    name: string;
    prompt: string;
    agent?: string;
    schedule: string;
    timezone?: string;
    enabled?: boolean;
  }): ScheduledTask {
    const id = randomUUID();
    stmts.insertScheduledTask.run(
      id,
      data.name,
      data.prompt,
      data.agent ?? "default",
      data.schedule,
      data.timezone ?? "Asia/Taipei",
      data.enabled !== false ? 1 : 0
    );
    return parseScheduledTask(stmts.getScheduledTask.get(id));
  },

  updateScheduledTask(
    id: string,
    data: Partial<{
      name: string;
      prompt: string;
      agent: string;
      schedule: string;
      timezone: string;
      enabled: boolean;
    }>
  ): ScheduledTask | undefined {
    const existing = stmts.getScheduledTask.get(id) as any;
    if (!existing) return undefined;
    stmts.updateScheduledTask.run(
      data.name ?? existing.name,
      data.prompt ?? existing.prompt,
      data.agent ?? existing.agent,
      data.schedule ?? existing.schedule,
      data.timezone ?? existing.timezone,
      data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
      id
    );
    return parseScheduledTask(stmts.getScheduledTask.get(id));
  },

  deleteScheduledTask(id: string): boolean {
    const result = stmts.deleteScheduledTask.run(id);
    return result.changes > 0;
  },

  toggleScheduledTask(id: string, enabled: boolean): ScheduledTask | undefined {
    stmts.toggleScheduledTask.run(enabled ? 1 : 0, id);
    const row = stmts.getScheduledTask.get(id);
    if (!row) return undefined;
    return parseScheduledTask(row);
  },

  // Task executions
  createTaskExecution(data: {
    task_id: string;
    triggered_by?: string;
  }): TaskExecution {
    const id = randomUUID();
    stmts.insertTaskExecution.run(id, data.task_id, data.triggered_by ?? "schedule");
    return {
      id,
      task_id: data.task_id,
      status: "running",
      output: null,
      error: null,
      cost_usd: null,
      duration_ms: null,
      triggered_by: data.triggered_by ?? "schedule",
      started_at: new Date().toISOString(),
      completed_at: null,
    };
  },

  updateTaskExecution(
    id: string,
    data: {
      status: "success" | "error";
      output?: string | null;
      error?: string | null;
      cost_usd?: number | null;
      duration_ms?: number | null;
    }
  ): void {
    stmts.updateTaskExecution.run(
      data.status,
      data.output ?? null,
      data.error ?? null,
      data.cost_usd ?? null,
      data.duration_ms ?? null,
      id
    );
  },

  listTaskExecutions(taskId?: string, limit = 50): TaskExecution[] {
    if (taskId) {
      return (stmts.listTaskExecutions.all(taskId, limit) as any[]).map(parseTaskExecution);
    }
    return (stmts.listAllTaskExecutions.all(limit) as any[]).map(parseTaskExecution);
  },

  // Secrets
  listSecrets(): Secret[] {
    const rows = stmts.listSecrets.all() as Secret[];
    return rows.map(r => ({ ...r, value: "***" }));
  },

  listSecretsRaw(): Secret[] {
    return stmts.listSecrets.all() as Secret[];
  },

  getSecret(id: string): Secret | undefined {
    const row = stmts.getSecret.get(id) as Secret | undefined;
    if (!row) return undefined;
    return { ...row, value: "***" };
  },

  getSecretByName(name: string): string | undefined {
    const row = stmts.getSecretByName.get(name) as Secret | undefined;
    return row?.value;
  },

  createSecret(data: {
    name: string;
    value: string;
    description?: string;
    category?: "general" | "social" | "api" | "mcp";
  }): Secret {
    const id = randomUUID();
    stmts.insertSecret.run(
      id,
      data.name,
      data.value,
      data.description ?? "",
      data.category ?? "general"
    );
    const row = stmts.getSecret.get(id) as Secret;
    return { ...row, value: "***" };
  },

  updateSecret(
    id: string,
    data: Partial<{
      value: string;
      description: string;
      category: "general" | "social" | "api" | "mcp";
    }>
  ): Secret | undefined {
    const existing = stmts.getSecret.get(id) as Secret | undefined;
    if (!existing) return undefined;
    stmts.updateSecret.run(
      data.value ?? existing.value,
      data.description ?? existing.description,
      data.category ?? existing.category,
      id
    );
    const row = stmts.getSecret.get(id) as Secret;
    return { ...row, value: "***" };
  },

  deleteSecret(id: string): boolean {
    const result = stmts.deleteSecret.run(id);
    return result.changes > 0;
  },

  // Projects
  listProjects(): Project[] {
    return (stmts.listProjects.all() as any[]).map(parseProject);
  },

  getProject(id: string): Project | undefined {
    const row = stmts.getProject.get(id) as any;
    if (!row) return undefined;
    return parseProject(row);
  },

  createProject(data: {
    name: string;
    topic: string;
    discussion_mode?: string;
  }): Project {
    const id = randomUUID();
    stmts.insertProject.run(
      id,
      data.name,
      data.topic,
      data.discussion_mode ?? "auto"
    );
    return parseProject(stmts.getProject.get(id));
  },

  updateProject(
    id: string,
    data: Partial<{
      experts: Expert[];
      status: string;
      discussion_mode: string;
    }>
  ): Project | undefined {
    stmts.updateProject.run(
      data.experts !== undefined ? JSON.stringify(data.experts) : null,
      data.status !== undefined ? data.status : null,
      data.discussion_mode !== undefined ? data.discussion_mode : null,
      id
    );
    const row = stmts.getProject.get(id) as any;
    if (!row) return undefined;
    return parseProject(row);
  },

  deleteProject(id: string): boolean {
    const result = stmts.deleteProject.run(id);
    return result.changes > 0;
  },

  // Discussion messages
  addDiscussionMessage(data: {
    project_id: string;
    expert_name: string;
    cli: string;
    content: string;
    round: number;
  }): DiscussionMessage {
    const id = randomUUID();
    stmts.insertDiscussionMessage.run(
      id,
      data.project_id,
      data.expert_name,
      data.cli,
      data.content,
      data.round
    );
    return {
      id,
      project_id: data.project_id,
      expert_name: data.expert_name,
      cli: data.cli,
      content: data.content,
      round: data.round,
      created_at: new Date().toISOString(),
    };
  },

  getDiscussionMessages(project_id: string): DiscussionMessage[] {
    return stmts.getDiscussionMessages.all(project_id) as DiscussionMessage[];
  },

  clearDiscussionMessages(project_id: string): void {
    db.prepare("DELETE FROM discussion_messages WHERE project_id = ?").run(project_id);
  },

  // Cross-session history search
  queryHistory(opts: {
    session_id?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): any[] {
    const { session_id, search, limit = 50, offset = 0 } = opts;

    let sql = `
      SELECT m.*, s.title AS session_title, s.status AS session_status
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE s.status != 'deleted'
    `;
    const params: any[] = [];

    if (session_id) {
      sql += ` AND m.session_id = ?`;
      params.push(session_id);
    }
    if (search) {
      sql += ` AND (m.content LIKE ? OR m.tool_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`;
    params.push(Math.min(limit, 500), offset);

    return db.prepare(sql).all(...params) as any[];
  },
};

export default store;
