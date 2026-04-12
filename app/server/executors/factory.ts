/**
 * createExecutor — factory function for all IExecutor types.
 * Replaces createSession() for new code; existing code keeps using createSession().
 */

import type { IExecutor, ExecutorConfig, ExecutorType } from "./types.ts";
import { ClaudeCliExecutor } from "./claude-cli-executor.ts";
import { CliSessionExecutor } from "./cli-session-executor.ts";
import { AnthropicSdkExecutor } from "./anthropic-sdk-executor.ts";
import { OpenAIExecutor } from "./openai-executor.ts";
import { GeminiExecutor } from "./gemini-executor.ts";
import { OllamaExecutor } from "./ollama-executor.ts";

export function createExecutor(config: ExecutorConfig): IExecutor {
  switch (config.type) {
    case "claude-cli":
      return new ClaudeCliExecutor(config);
    case "anthropic-sdk":
      return new AnthropicSdkExecutor(config);
    case "openai":
    case "grok":
      return new OpenAIExecutor(config);
    case "gemini":
      return new GeminiExecutor(config);
    case "ollama":
      return new OllamaExecutor(config);
    case "codex-cli":
    case "gemini-cli":
    case "opencode-cli":
      return new CliSessionExecutor(config);
    default:
      console.warn(`[ExecutorFactory] Unknown executor type '${(config as any).type}', falling back to claude-cli`);
      return new ClaudeCliExecutor({ ...config, type: "claude-cli" });
  }
}

export function getExecutorTypeFromSetting(setting: string): ExecutorType {
  const valid: ExecutorType[] = ["claude-cli", "anthropic-sdk", "openai", "grok", "gemini", "ollama", "codex-cli", "gemini-cli", "opencode-cli"];
  return valid.includes(setting as ExecutorType) ? (setting as ExecutorType) : "claude-cli";
}
