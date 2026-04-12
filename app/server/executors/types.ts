/**
 * IExecutor — pluggable LLM executor interface.
 * Allows swapping between Claude CLI, Anthropic SDK, OpenAI, Grok, Gemini, Ollama.
 */

export type ExecutorType =
  | "claude-cli"        // existing AgentSession (default)
  | "anthropic-sdk"     // direct @anthropic-ai/sdk
  | "openai"            // OpenAI API
  | "grok"              // xAI Grok (OpenAI-compatible)
  | "gemini"            // Google Gemini API
  | "ollama"            // local Ollama
  | "codex-cli"         // existing CliSession
  | "gemini-cli"        // existing CliSession (gemini CLI)
  | "opencode-cli";     // existing CliSession (opencode CLI)

export type SpecialistType = "researcher" | "writer" | "analyst" | "executor" | "critic";
export type ExecutionMode = "auto" | "parallel" | "sequential" | "swarm";

export interface ExecutorStreamEvent {
  type: "text_delta" | "tool_use" | "tool_result" | "result" | "error";
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  cost?: number | null;
  duration?: number | null;
  error?: string;
}

export interface ExecutorConfig {
  type: ExecutorType;
  sessionId: string;
  cwd?: string;
  model?: string;           // model override (e.g. "gpt-4o", "claude-sonnet-4-5")
  apiKey?: string;          // if not provided, falls back to env var or stored secrets
  baseURL?: string;         // for Ollama or custom OpenAI-compatible endpoints
  systemPrompt?: string;    // custom system prompt
  role?: import("../db.ts").Role;
  chatMemory?: Record<string, string>;
}

/**
 * IExecutor — unified interface for all LLM executors.
 * Both AgentSession-based and API-based executors implement this.
 */
export interface IExecutor {
  readonly executorId: string;
  readonly executorType: ExecutorType;

  /** Queue a user message for processing */
  sendMessage(content: string): void;

  /** Async generator yielding normalized stream events */
  getOutputStream(): AsyncGenerator<ExecutorStreamEvent>;

  /** Abort current generation */
  interrupt(): void;

  /** Current turn count */
  readonly turnCount: number;

  /** Whether session should rotate (context getting full) */
  readonly shouldRotate: boolean;

  /** Whether to warn about upcoming rotation */
  readonly shouldWarnRotation: boolean;

  /** Increment turn count after each complete response */
  incrementTurn(): void;

  /** Rotate session (generate compact summary, reset) */
  rotate(): Promise<void>;
}
