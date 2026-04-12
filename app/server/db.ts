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
db.pragma("foreign_keys = ON");

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

  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    personality TEXT NOT NULL DEFAULT '',
    allowed_skills TEXT NOT NULL DEFAULT '[]',
    language TEXT NOT NULL DEFAULT 'en',
    reply_style TEXT NOT NULL DEFAULT 'concise',
    knowledge_context TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS role_assignments (
    chat_id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    platform TEXT NOT NULL DEFAULT 'telegram',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS role_memories (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(chat_id, key)
  );

  CREATE TABLE IF NOT EXISTS agent_executions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL DEFAULT 'idle',
    state_data TEXT NOT NULL DEFAULT '{}',
    supervisor_plan TEXT,
    result TEXT,
    error TEXT,
    cost_usd REAL,
    duration_ms INTEGER,
    lineage_id TEXT,
    triggered_by TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agent_execution_steps (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL DEFAULT 0,
    specialist_type TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '',
    output TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    cost_usd REAL,
    duration_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_lineages (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES agent_lineages(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    memory_scope TEXT NOT NULL DEFAULT 'summary',
    inherited_memory TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS goal_entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'active',
    milestones TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS goal_loop_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'idle',
    current_plan TEXT NOT NULL DEFAULT '{}',
    last_run_at TEXT,
    next_run_at TEXT,
    reflection_notes TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS goal_progress_log (
    id TEXT PRIMARY KEY,
    goal_id TEXT REFERENCES goal_entries(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    execution_id TEXT REFERENCES agent_executions(id) ON DELETE SET NULL,
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
  CREATE INDEX IF NOT EXISTS idx_role_assignments_role ON role_assignments(role_id);
  CREATE INDEX IF NOT EXISTS idx_role_memories_chat ON role_memories(chat_id);
  CREATE INDEX IF NOT EXISTS idx_exec_steps_exec ON agent_execution_steps(execution_id);
  CREATE INDEX IF NOT EXISTS idx_lineages_parent ON agent_lineages(parent_id);
  CREATE INDEX IF NOT EXISTS idx_goals_status ON goal_entries(status);
  CREATE INDEX IF NOT EXISTS idx_goal_progress_goal ON goal_progress_log(goal_id);
`);

// Migrations: add new columns to existing tables if they don't exist yet
try { db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN delivery_chat_id TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN delivery_platform TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE roles ADD COLUMN reply_mode TEXT DEFAULT 'always'`); } catch {}
try { db.exec(`ALTER TABLE roles ADD COLUMN reply_keywords TEXT DEFAULT '[]'`); } catch {}

// Phase 2: Hybrid Memory
try { db.exec(`ALTER TABLE role_memories ADD COLUMN memory_type TEXT DEFAULT 'general'`); } catch {}
try { db.exec(`ALTER TABLE role_memories ADD COLUMN source TEXT DEFAULT 'explicit'`); } catch {}

// Phase 3: Agentic System
try { db.exec(`ALTER TABLE projects ADD COLUMN supervisor_model TEXT DEFAULT 'claude-cli'`); } catch {}
try { db.exec(`ALTER TABLE projects ADD COLUMN parallel_execution INTEGER DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE discussion_messages ADD COLUMN parallel_group INTEGER`); } catch {}
try { db.exec(`ALTER TABLE sessions ADD COLUMN lineage_id TEXT`); } catch {}

// Indices that depend on migrated columns (run after ALTER TABLE)
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_role_memories_type ON role_memories(memory_type)`); } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_lineage ON sessions(lineage_id)`); } catch {}

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
  delivery_chat_id: string | null;
  delivery_platform: string | null;
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

export interface Role {
  id: string;
  name: string;
  personality: string;
  allowed_skills: string[];
  language: string;
  reply_style: string;
  knowledge_context: string;
  reply_mode: string;  // 'always' | 'mention' | 'smart' | 'keywords' | 'never'
  reply_keywords: string[];
  created_at: string;
  updated_at: string;
}

export interface RoleAssignment {
  chat_id: string;
  role_id: string;
  platform: string;
  created_at: string;
}

export interface RoleMemory {
  id: string;
  chat_id: string;
  key: string;
  value: string;
  memory_type: string;
  source: string;
  updated_at: string;
}

export interface AgentExecution {
  id: string;
  title: string;
  goal: string;
  mode: "auto" | "parallel" | "sequential" | "swarm";
  status: "idle" | "planning" | "dispatching" | "running" | "aggregating" | "reflecting" | "done" | "error" | "cancelled";
  state_data: string; // JSON
  supervisor_plan: string | null;
  result: string | null;
  error: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  lineage_id: string | null;
  triggered_by: string;
  created_at: string;
  updated_at: string;
}

export interface AgentExecutionStep {
  id: string;
  execution_id: string;
  step_index: number;
  specialist_type: string;
  input: string;
  output: string | null;
  status: "pending" | "running" | "done" | "error";
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface AgentLineage {
  id: string;
  parent_id: string | null;
  name: string;
  version: number;
  memory_scope: "full" | "summary" | "none";
  inherited_memory: string; // JSON Record<string,string>
  created_at: string;
}

export interface GoalEntry {
  id: string;
  title: string;
  description: string;
  priority: 1 | 2 | 3;
  status: "active" | "paused" | "completed";
  milestones: Array<{ title: string; done: boolean }>;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface GoalProgressLog {
  id: string;
  goal_id: string | null;
  event_type: string;
  summary: string;
  execution_id: string | null;
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
    `SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ),
  listAllSessions: db.prepare(
    `SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC`
  ),
  findSessionByTitle: db.prepare(
    `SELECT * FROM sessions WHERE title = ? AND status != 'deleted' LIMIT 1`
  ),
  countSessions: db.prepare(
    `SELECT COUNT(*) as count FROM sessions WHERE status = 'active'`
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
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`
  ),
  getAllMessages: db.prepare(
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC`
  ),
  countMessages: db.prepare(
    `SELECT COUNT(*) as count FROM messages WHERE session_id = ?`
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
    `INSERT INTO scheduled_tasks (id, name, prompt, agent, schedule, timezone, enabled, delivery_chat_id, delivery_platform)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateScheduledTask: db.prepare(
    `UPDATE scheduled_tasks SET name = ?, prompt = ?, agent = ?, schedule = ?,
     timezone = ?, enabled = ?, delivery_chat_id = ?, delivery_platform = ?, updated_at = datetime('now') WHERE id = ?`
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
  clearDiscussionMessages: db.prepare("DELETE FROM discussion_messages WHERE project_id = ?"),

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

  // Roles
  listRoles: db.prepare(`SELECT * FROM roles ORDER BY name ASC`),
  getRole: db.prepare(`SELECT * FROM roles WHERE id = ?`),
  insertRole: db.prepare(
    `INSERT INTO roles (id, name, personality, allowed_skills, language, reply_style, knowledge_context, reply_mode, reply_keywords)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateRole: db.prepare(
    `UPDATE roles SET name = ?, personality = ?, allowed_skills = ?, language = ?,
     reply_style = ?, knowledge_context = ?, reply_mode = ?, reply_keywords = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteRole: db.prepare(`DELETE FROM roles WHERE id = ?`),

  // Role assignments
  assignRole: db.prepare(
    `INSERT OR REPLACE INTO role_assignments (chat_id, role_id, platform) VALUES (?, ?, ?)`
  ),
  unassignRole: db.prepare(`DELETE FROM role_assignments WHERE chat_id = ?`),
  getRoleAssignment: db.prepare(`SELECT * FROM role_assignments WHERE chat_id = ?`),
  getRoleByChatId: db.prepare(
    `SELECT r.* FROM roles r JOIN role_assignments ra ON r.id = ra.role_id WHERE ra.chat_id = ?`
  ),
  listRoleAssignments: db.prepare(
    `SELECT ra.*, r.name as role_name FROM role_assignments ra JOIN roles r ON ra.role_id = r.id ORDER BY ra.created_at DESC`
  ),

  // Role memories
  setRoleMemory: db.prepare(
    `INSERT INTO role_memories (id, chat_id, key, value, memory_type, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(chat_id, key) DO UPDATE SET
       value = excluded.value,
       memory_type = excluded.memory_type,
       source = excluded.source,
       updated_at = excluded.updated_at`
  ),
  getRoleMemory: db.prepare(`SELECT * FROM role_memories WHERE chat_id = ? AND key = ?`),
  listRoleMemories: db.prepare(`SELECT * FROM role_memories WHERE chat_id = ? ORDER BY key ASC`),
  listAllRoleMemories: db.prepare(`SELECT * FROM role_memories ORDER BY chat_id ASC, key ASC`),
  deleteRoleMemory: db.prepare(`DELETE FROM role_memories WHERE chat_id = ? AND key = ?`),
  clearRoleMemories: db.prepare(`DELETE FROM role_memories WHERE chat_id = ?`),

  // Agent executions
  insertAgentExecution: db.prepare(
    `INSERT INTO agent_executions (id, title, goal, mode, triggered_by)
     VALUES (?, ?, ?, ?, ?)`
  ),
  updateAgentExecution: db.prepare(
    `UPDATE agent_executions SET status = COALESCE(?, status), state_data = COALESCE(?, state_data),
     supervisor_plan = COALESCE(?, supervisor_plan), result = COALESCE(?, result),
     error = COALESCE(?, error), cost_usd = COALESCE(?, cost_usd),
     duration_ms = COALESCE(?, duration_ms), lineage_id = COALESCE(?, lineage_id),
     updated_at = datetime('now') WHERE id = ?`
  ),
  getAgentExecution: db.prepare(`SELECT * FROM agent_executions WHERE id = ?`),
  listAgentExecutions: db.prepare(
    `SELECT * FROM agent_executions ORDER BY created_at DESC LIMIT ?`
  ),
  listPendingAgentExecutions: db.prepare(
    `SELECT * FROM agent_executions WHERE status NOT IN ('done', 'error', 'cancelled', 'idle') ORDER BY created_at ASC`
  ),
  deleteAgentExecution: db.prepare(`DELETE FROM agent_executions WHERE id = ?`),

  // Execution steps
  insertExecutionStep: db.prepare(
    `INSERT INTO agent_execution_steps (id, execution_id, step_index, specialist_type, input, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  ),
  updateExecutionStep: db.prepare(
    `UPDATE agent_execution_steps SET status = ?, output = COALESCE(?, output),
     cost_usd = COALESCE(?, cost_usd), duration_ms = COALESCE(?, duration_ms),
     completed_at = CASE WHEN ? = 'done' OR ? = 'error' THEN datetime('now') ELSE completed_at END
     WHERE id = ?`
  ),
  getExecutionSteps: db.prepare(
    `SELECT * FROM agent_execution_steps WHERE execution_id = ? ORDER BY step_index ASC`
  ),
  deleteExecutionSteps: db.prepare(
    `DELETE FROM agent_execution_steps WHERE execution_id = ?`
  ),

  // Agent lineages
  insertLineage: db.prepare(
    `INSERT INTO agent_lineages (id, parent_id, name, version, memory_scope, inherited_memory)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  getLineage: db.prepare(`SELECT * FROM agent_lineages WHERE id = ?`),
  listLineageChildren: db.prepare(
    `SELECT * FROM agent_lineages WHERE parent_id = ? ORDER BY version ASC`
  ),
  listRootLineages: db.prepare(
    `SELECT * FROM agent_lineages WHERE parent_id IS NULL ORDER BY created_at DESC`
  ),
  // Goal entries
  insertGoal: db.prepare(
    `INSERT INTO goal_entries (id, title, description, priority, milestones, tags)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  updateGoal: db.prepare(
    `UPDATE goal_entries SET title = COALESCE(?, title), description = COALESCE(?, description),
     priority = COALESCE(?, priority), status = COALESCE(?, status),
     milestones = COALESCE(?, milestones), tags = COALESCE(?, tags),
     updated_at = datetime('now') WHERE id = ?`
  ),
  getGoal: db.prepare(`SELECT * FROM goal_entries WHERE id = ?`),
  listGoals: db.prepare(`SELECT * FROM goal_entries WHERE status != 'completed' ORDER BY priority DESC, created_at DESC`),
  listAllGoals: db.prepare(`SELECT * FROM goal_entries ORDER BY created_at DESC`),
  deleteGoal: db.prepare(`DELETE FROM goal_entries WHERE id = ?`),

  // Goal loop state (single-row table)
  getGoalLoopState: db.prepare(`SELECT * FROM goal_loop_state WHERE id = 1`),
  upsertGoalLoopState: db.prepare(
    `INSERT OR REPLACE INTO goal_loop_state (id, status, current_plan, last_run_at, next_run_at, reflection_notes, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, datetime('now'))`
  ),

  // Goal progress log
  insertGoalProgressLog: db.prepare(
    `INSERT INTO goal_progress_log (id, goal_id, event_type, summary, execution_id)
     VALUES (?, ?, ?, ?, ?)`
  ),
  listGoalProgressLogs: db.prepare(
    `SELECT * FROM goal_progress_log WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?`
  ),
  listAllProgressLogs: db.prepare(
    `SELECT * FROM goal_progress_log ORDER BY created_at DESC LIMIT ?`
  ),
};

function parseChannelAccount(row: any): ChannelAccount {
  let allowed_users: string[] = [];
  try { allowed_users = JSON.parse(row.allowed_users || "[]"); } catch { allowed_users = []; }
  return { ...row, allowed_users, enabled: Boolean(row.enabled) };
}

function parseProject(row: any): Project {
  let experts: Expert[] = [];
  try { experts = JSON.parse(row.experts || "[]"); } catch { experts = []; }
  return { ...row, experts };
}

function parseScheduledTask(row: any): ScheduledTask {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    delivery_chat_id: row.delivery_chat_id ?? null,
    delivery_platform: row.delivery_platform ?? null,
  };
}

function parseRole(row: any): Role {
  let allowed_skills: string[] = [];
  try { allowed_skills = JSON.parse(row.allowed_skills || "[]"); } catch { allowed_skills = []; }
  let reply_keywords: string[] = [];
  try { reply_keywords = JSON.parse(row.reply_keywords || "[]"); } catch { reply_keywords = []; }
  return { ...row, allowed_skills, reply_keywords };
}

function parseTaskExecution(row: any): TaskExecution {
  return { ...row };
}

function parseGoalEntry(row: any): GoalEntry {
  let milestones: Array<{ title: string; done: boolean }> = [];
  try { milestones = JSON.parse(row.milestones || '[]'); } catch {}
  let tags: string[] = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch {}
  return { ...row, milestones, tags };
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

  listSessions(limit = 50, offset = 0): Session[] {
    return stmts.listSessions.all(Math.max(0, Math.min(limit, 200)), offset) as Session[];
  },

  deleteSession(id: string): boolean {
    const result = stmts.deleteSession.run(id);
    return result.changes > 0;
  },

  listAllSessions(): Session[] {
    return stmts.listAllSessions.all() as Session[];
  },

  findSessionByTitle(title: string): Session | undefined {
    return stmts.findSessionByTitle.get(title) as Session | undefined;
  },

  countSessions(): number {
    const row = stmts.countSessions.get() as { count: number };
    return row.count;
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

  getMessages(sessionId: string, limit = 500, offset = 0): Message[] {
    return stmts.getMessages.all(sessionId, Math.max(0, Math.min(limit, 500)), offset) as Message[];
  },

  getAllMessages(sessionId: string): Message[] {
    return stmts.getAllMessages.all(sessionId) as Message[];
  },

  countMessages(sessionId: string): number {
    const row = stmts.countMessages.get(sessionId) as { count: number };
    return row.count;
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
    delivery_chat_id?: string | null;
    delivery_platform?: string | null;
  }): ScheduledTask {
    const id = randomUUID();
    stmts.insertScheduledTask.run(
      id,
      data.name,
      data.prompt,
      data.agent ?? "claude",
      data.schedule,
      data.timezone ?? "Asia/Taipei",
      data.enabled !== false ? 1 : 0,
      data.delivery_chat_id ?? null,
      data.delivery_platform ?? null
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
      delivery_chat_id: string | null;
      delivery_platform: string | null;
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
      data.delivery_chat_id !== undefined ? data.delivery_chat_id : existing.delivery_chat_id,
      data.delivery_platform !== undefined ? data.delivery_platform : existing.delivery_platform,
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
    const safeLimit = Math.max(0, Math.min(limit, 500));
    if (taskId) {
      return (stmts.listTaskExecutions.all(taskId, safeLimit) as any[]).map(parseTaskExecution);
    }
    return (stmts.listAllTaskExecutions.all(safeLimit) as any[]).map(parseTaskExecution);
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
    stmts.clearDiscussionMessages.run(project_id);
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
      // Escape LIKE wildcards in user input (backslash must come first)
      const escaped = search.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
      sql += ` AND (m.content LIKE ? ESCAPE '\\' OR m.tool_name LIKE ? ESCAPE '\\')`;
      params.push(`%${escaped}%`, `%${escaped}%`);
    }

    sql += ` ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`;
    params.push(Math.max(0, Math.min(limit, 500)), offset);

    return db.prepare(sql).all(...params) as any[];
  },

  // Roles
  listRoles(): Role[] {
    return (stmts.listRoles.all() as any[]).map(parseRole);
  },

  getRole(id: string): Role | undefined {
    const row = stmts.getRole.get(id);
    if (!row) return undefined;
    return parseRole(row);
  },

  createRole(data: {
    name: string;
    personality?: string;
    allowed_skills?: string[];
    language?: string;
    reply_style?: string;
    knowledge_context?: string;
    reply_mode?: string;
    reply_keywords?: string[];
  }): Role {
    const id = randomUUID();
    stmts.insertRole.run(
      id,
      data.name,
      data.personality ?? "",
      JSON.stringify(data.allowed_skills ?? []),
      data.language ?? "en",
      data.reply_style ?? "concise",
      data.knowledge_context ?? "",
      data.reply_mode ?? "always",
      JSON.stringify(data.reply_keywords ?? [])
    );
    return parseRole(stmts.getRole.get(id));
  },

  updateRole(
    id: string,
    data: Partial<{
      name: string;
      personality: string;
      allowed_skills: string[];
      language: string;
      reply_style: string;
      knowledge_context: string;
      reply_mode: string;
      reply_keywords: string[];
    }>
  ): Role | undefined {
    const existing = stmts.getRole.get(id) as any;
    if (!existing) return undefined;
    const existingParsed = parseRole(existing);
    stmts.updateRole.run(
      data.name ?? existing.name,
      data.personality ?? existing.personality,
      JSON.stringify(data.allowed_skills ?? existingParsed.allowed_skills),
      data.language ?? existing.language,
      data.reply_style ?? existing.reply_style,
      data.knowledge_context ?? existing.knowledge_context,
      data.reply_mode ?? existing.reply_mode ?? "always",
      JSON.stringify(data.reply_keywords ?? existingParsed.reply_keywords),
      id
    );
    return parseRole(stmts.getRole.get(id));
  },

  deleteRole(id: string): boolean {
    const result = stmts.deleteRole.run(id);
    return result.changes > 0;
  },

  // Role assignments
  assignRole(chat_id: string, role_id: string, platform = "telegram"): RoleAssignment {
    stmts.assignRole.run(chat_id, role_id, platform);
    return stmts.getRoleAssignment.get(chat_id) as RoleAssignment;
  },

  unassignRole(chat_id: string): boolean {
    const result = stmts.unassignRole.run(chat_id);
    return result.changes > 0;
  },

  getRoleAssignment(chat_id: string): RoleAssignment | undefined {
    return stmts.getRoleAssignment.get(chat_id) as RoleAssignment | undefined;
  },

  getRoleByChatId(chat_id: string): Role | undefined {
    const row = stmts.getRoleByChatId.get(chat_id);
    if (!row) return undefined;
    return parseRole(row);
  },

  listRoleAssignments(): any[] {
    return stmts.listRoleAssignments.all() as any[];
  },

  // Role memories
  setRoleMemory(chat_id: string, key: string, value: string, memory_type?: string, source?: string): RoleMemory {
    const id = randomUUID();
    stmts.setRoleMemory.run(id, chat_id, key, value, memory_type ?? 'general', source ?? '');
    return stmts.getRoleMemory.get(chat_id, key) as RoleMemory;
  },

  getRoleMemory(chat_id: string, key: string): RoleMemory | undefined {
    return stmts.getRoleMemory.get(chat_id, key) as RoleMemory | undefined;
  },

  listRoleMemories(chat_id: string): RoleMemory[] {
    return stmts.listRoleMemories.all(chat_id) as RoleMemory[];
  },

  listAllRoleMemories(): RoleMemory[] {
    return stmts.listAllRoleMemories.all() as RoleMemory[];
  },

  deleteRoleMemory(chat_id: string, key: string): boolean {
    const result = stmts.deleteRoleMemory.run(chat_id, key);
    return result.changes > 0;
  },

  clearRoleMemories(chat_id: string): void {
    stmts.clearRoleMemories.run(chat_id);
  },

  // Agent Executions
  createAgentExecution(data: {
    title: string;
    goal: string;
    mode: string;
    triggered_by?: string;
  }): AgentExecution {
    const id = randomUUID();
    stmts.insertAgentExecution.run(id, data.title, data.goal, data.mode, data.triggered_by ?? 'manual');
    return stmts.getAgentExecution.get(id) as AgentExecution;
  },

  updateAgentExecution(id: string, data: {
    status?: string;
    state_data?: string;
    supervisor_plan?: string | null;
    result?: string | null;
    error?: string | null;
    cost_usd?: number | null;
    duration_ms?: number | null;
    lineage_id?: string | null;
  }): void {
    stmts.updateAgentExecution.run(
      data.status ?? null,
      data.state_data ?? null,
      data.supervisor_plan ?? null,
      data.result ?? null,
      data.error ?? null,
      data.cost_usd ?? null,
      data.duration_ms ?? null,
      data.lineage_id ?? null,
      id
    );
  },

  getAgentExecution(id: string): AgentExecution | undefined {
    return stmts.getAgentExecution.get(id) as AgentExecution | undefined;
  },

  listAgentExecutions(limit = 50): AgentExecution[] {
    return stmts.listAgentExecutions.all(Math.min(limit, 200)) as AgentExecution[];
  },

  listPendingAgentExecutions(): AgentExecution[] {
    return stmts.listPendingAgentExecutions.all() as AgentExecution[];
  },

  deleteAgentExecution(id: string): boolean {
    const result = stmts.deleteAgentExecution.run(id);
    return result.changes > 0;
  },

  // Execution Steps
  createExecutionStep(data: {
    execution_id: string;
    step_index: number;
    specialist_type: string;
    input: string;
  }): AgentExecutionStep {
    const id = randomUUID();
    stmts.insertExecutionStep.run(id, data.execution_id, data.step_index, data.specialist_type, data.input);
    return { id, execution_id: data.execution_id, step_index: data.step_index, specialist_type: data.specialist_type, input: data.input, output: null, status: 'pending', cost_usd: null, duration_ms: null, created_at: new Date().toISOString(), completed_at: null };
  },

  updateExecutionStep(id: string, data: {
    status: string;
    output?: string | null;
    cost_usd?: number | null;
    duration_ms?: number | null;
  }): void {
    stmts.updateExecutionStep.run(data.status, data.output ?? null, data.cost_usd ?? null, data.duration_ms ?? null, data.status, data.status, id);
  },

  getExecutionSteps(execution_id: string): AgentExecutionStep[] {
    return stmts.getExecutionSteps.all(execution_id) as AgentExecutionStep[];
  },

  deleteExecutionSteps(execution_id: string): void {
    stmts.deleteExecutionSteps.run(execution_id);
  },

  // Agent Lineages
  createLineage(data: {
    name: string;
    parent_id?: string | null;
    version?: number;
    memory_scope?: string;
    inherited_memory?: Record<string, string>;
  }): AgentLineage {
    const id = randomUUID();
    stmts.insertLineage.run(
      id,
      data.parent_id ?? null,
      data.name,
      data.version ?? 1,
      data.memory_scope ?? 'summary',
      JSON.stringify(data.inherited_memory ?? {})
    );
    return stmts.getLineage.get(id) as AgentLineage;
  },

  getLineage(id: string): AgentLineage | undefined {
    return stmts.getLineage.get(id) as AgentLineage | undefined;
  },

  listLineageChildren(parent_id: string): AgentLineage[] {
    return stmts.listLineageChildren.all(parent_id) as AgentLineage[];
  },

  listRootLineages(): AgentLineage[] {
    return stmts.listRootLineages.all() as AgentLineage[];
  },

  // Goals
  createGoal(data: {
    title: string;
    description?: string;
    priority?: number;
    milestones?: Array<{ title: string; done: boolean }>;
    tags?: string[];
  }): GoalEntry {
    const id = randomUUID();
    stmts.insertGoal.run(
      id,
      data.title,
      data.description ?? '',
      data.priority ?? 2,
      JSON.stringify(data.milestones ?? []),
      JSON.stringify(data.tags ?? [])
    );
    return parseGoalEntry(stmts.getGoal.get(id));
  },

  updateGoal(id: string, data: Partial<{
    title: string;
    description: string;
    priority: number;
    status: string;
    milestones: Array<{ title: string; done: boolean }>;
    tags: string[];
  }>): GoalEntry | undefined {
    stmts.updateGoal.run(
      data.title ?? null,
      data.description ?? null,
      data.priority ?? null,
      data.status ?? null,
      data.milestones ? JSON.stringify(data.milestones) : null,
      data.tags ? JSON.stringify(data.tags) : null,
      id
    );
    const row = stmts.getGoal.get(id);
    return row ? parseGoalEntry(row) : undefined;
  },

  getGoal(id: string): GoalEntry | undefined {
    const row = stmts.getGoal.get(id);
    return row ? parseGoalEntry(row) : undefined;
  },

  listGoals(): GoalEntry[] {
    return (stmts.listGoals.all() as any[]).map(parseGoalEntry);
  },

  listAllGoals(): GoalEntry[] {
    return (stmts.listAllGoals.all() as any[]).map(parseGoalEntry);
  },

  deleteGoal(id: string): boolean {
    const result = stmts.deleteGoal.run(id);
    return result.changes > 0;
  },

  // Goal Loop State
  getGoalLoopState(): { id: number; status: string; current_plan: string; last_run_at: string | null; next_run_at: string | null; reflection_notes: string; updated_at: string } | undefined {
    return stmts.getGoalLoopState.get() as any;
  },

  setGoalLoopState(data: {
    status: string;
    current_plan?: string;
    last_run_at?: string | null;
    next_run_at?: string | null;
    reflection_notes?: string;
  }): void {
    const existing = stmts.getGoalLoopState.get() as any;
    stmts.upsertGoalLoopState.run(
      data.status,
      data.current_plan ?? existing?.current_plan ?? '{}',
      data.last_run_at ?? existing?.last_run_at ?? null,
      data.next_run_at ?? existing?.next_run_at ?? null,
      data.reflection_notes ?? existing?.reflection_notes ?? '[]'
    );
  },

  // Goal Progress Log
  addGoalProgressLog(data: {
    goal_id?: string | null;
    event_type: string;
    summary: string;
    execution_id?: string | null;
  }): void {
    stmts.insertGoalProgressLog.run(
      randomUUID(),
      data.goal_id ?? null,
      data.event_type,
      data.summary,
      data.execution_id ?? null
    );
  },

  listGoalProgressLogs(goal_id: string, limit = 20): GoalProgressLog[] {
    return stmts.listGoalProgressLogs.all(goal_id, limit) as GoalProgressLog[];
  },

  listAllProgressLogs(limit = 50): GoalProgressLog[] {
    return stmts.listAllProgressLogs.all(limit) as GoalProgressLog[];
  },
};

export default store;
