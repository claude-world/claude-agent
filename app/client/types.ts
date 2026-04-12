// ---- Server DB types (matching server/db.ts) ----

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: 'active' | 'archived';
}

export interface DbMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  created_at: string;
}

export interface ChannelAccount {
  id: string;
  platform: 'telegram' | 'discord';
  bot_token: string;
  allowed_users: string[];
  enabled: boolean;
  created_at: string;
}

// ---- WebSocket message types (matching server/index.ts broadcasts) ----

export type WsInbound =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'chat'; sessionId: string; content: string; cli?: string; configBot?: boolean }
  | { type: 'interrupt'; sessionId: string };

export type WsOutbound =
  | { type: 'connected' }
  | { type: 'history'; messages: DbMessage[]; running: boolean }
  | { type: 'user_message'; content: string }
  | { type: 'assistant_message'; content: string }
  | { type: 'tool_use'; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'tool_result'; content: string }
  | { type: 'result'; success: boolean; cost?: number; duration?: number }
  | { type: 'interrupted'; sessionId: string }
  | { type: 'error'; error: string };

// ---- Skill types ----

export type SkillModel = 'haiku' | 'sonnet' | 'opus';

export type SkillCategory =
  | 'Core'
  | 'Content'
  | 'Productivity'
  | 'Messaging'
  | 'Smart Home'
  | 'Media'
  | 'System'
  | 'Migration';

export interface Skill {
  id: string;
  name: string;
  command: string;
  model: SkillModel;
  category: SkillCategory;
  description: string;
  prerequisites?: string[];
  full_description?: string;
}

// ---- Memory types ----

export interface MemoryFile {
  filename: string;
  size?: number;
  modified_at?: number;
}

// ---- Settings types ----

export type Language = 'en' | 'zh-TW' | 'ja';
export type ModelDefault = 'haiku' | 'sonnet' | 'opus';

export interface McpServer {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  tools?: number;
}

export interface Settings {
  language: Language;
  model_default: ModelDefault;
  mcp_servers: McpServer[];
}

// ---- Agent types ----

export interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  tools: string[];
}

// ---- Scheduled task types ----

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
  status: 'running' | 'success' | 'error';
  output: string | null;
  error: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  triggered_by: string;
  started_at: string;
  completed_at: string | null;
}

// ---- History types ----

export interface HistoryMessage {
  id: number;
  session_id: string;
  session_title: string;
  role: string;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  created_at: string;
}

// ---- Secrets types ----

export interface Secret {
  id: string;
  name: string;
  value: string; // "***" from API, real value only server-side
  description: string;
  category: 'general' | 'social' | 'api' | 'mcp';
  created_at: string;
  updated_at: string;
}

// ---- Project Discussion types ----

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
  status: string; // setup | discussing | discussed | concluded
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

// ---- Tool use types ----

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ---- Role types ----

export interface Role {
  id: string;
  name: string;
  personality: string;
  allowed_skills: string[];
  language: string;
  reply_style: string;
  knowledge_context: string;
  created_at: string;
  updated_at: string;
}

export interface RoleAssignment {
  chat_id: string;
  role_id: string;
  role_name?: string;
  platform: string;
  created_at: string;
}

export interface RoleMemory {
  id: string;
  chat_id: string;
  key: string;
  value: string;
  updated_at: string;
}

// ---- Page navigation ----

export type Page = 'chat' | 'history' | 'skills' | 'agents' | 'memory' | 'mcp' | 'tasks' | 'secrets' | 'settings' | 'channels' | 'config' | 'projects' | 'roles' | 'executions' | 'goals' | 'lineages';

export interface McpServerConfig {
  type?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// ---- Agentic OS types (Phase 1-4) ----

export type ExecutionMode = 'auto' | 'parallel' | 'sequential' | 'swarm';
export type ExecutionStatus = 'idle' | 'planning' | 'dispatching' | 'running' | 'aggregating' | 'reflecting' | 'done' | 'error' | 'cancelled';
export type SpecialistType = 'researcher' | 'writer' | 'analyst' | 'executor' | 'critic';

export interface AgentExecution {
  id: string;
  title: string;
  goal: string;
  mode: ExecutionMode;
  status: ExecutionStatus;
  supervisor_plan: string | null;
  result: string | null;
  error: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  triggered_by: string;
  created_at: string;
  updated_at: string;
  state_data?: string;  // JSON string
  lineage_id?: string | null;
}

export interface AgentExecutionStep {
  id: string;
  execution_id: string;
  step_index: number;
  specialist_type: SpecialistType;
  input: string;
  output: string | null;
  status: 'pending' | 'running' | 'done' | 'error';
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
  memory_scope: 'full' | 'summary' | 'none';
  inherited_memory: string; // raw JSON string, parse before use
  created_at: string;
  children?: AgentLineage[];
}

export interface GoalMilestone {
  title: string;
  done: boolean;
}

export interface GoalEntry {
  id: string;
  title: string;
  description: string;
  priority: 1 | 2 | 3;
  status: 'active' | 'paused' | 'completed';
  milestones: GoalMilestone[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface GoalLoopState {
  status: string;
  last_run_at: string | null;
  next_run_at: string | null;
  reflection_notes: string[];
  current_plan: Record<string, unknown>;
}

export interface GoalProgressLog {
  id: string;
  goal_id: string;
  event_type: string;
  summary: string;
  execution_id: string | null;
  created_at: string;
}
