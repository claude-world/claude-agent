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
  | { type: 'chat'; sessionId: string; content: string }
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
  status: 'running' | 'completed' | 'failed';
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

// ---- Page navigation ----

export type Page = 'chat' | 'history' | 'skills' | 'agents' | 'memory' | 'mcp' | 'tasks' | 'settings' | 'channels';

export interface McpServerConfig {
  type?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
