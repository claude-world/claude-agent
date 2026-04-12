/**
 * ClaudeCliExecutor — wraps AgentSession for IExecutor compatibility.
 * Zero behavior change: all subprocess management is in AgentSession.
 */

import { AgentSession } from "../agent.ts";
import type { IExecutor, ExecutorConfig, ExecutorStreamEvent } from "./types.ts";
import type { Role } from "../db.ts";

export class ClaudeCliExecutor implements IExecutor {
  readonly executorId: string;
  readonly executorType = "claude-cli" as const;
  private session: AgentSession;

  constructor(config: ExecutorConfig) {
    this.executorId = config.sessionId;
    this.session = new AgentSession(
      config.sessionId,
      config.cwd,
      config.role as Role | undefined,
      config.chatMemory
    );
  }

  sendMessage(content: string): void {
    this.session.sendMessage(content);
  }

  async *getOutputStream(): AsyncGenerator<ExecutorStreamEvent> {
    for await (const msg of this.session.getOutputStream()) {
      // Translate AgentSession raw CLI JSON to ExecutorStreamEvent
      if (msg.type === "assistant") {
        const content = msg.message?.content;
        if (typeof content === "string" && content) {
          yield { type: "text_delta", text: content };
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              yield { type: "text_delta", text: block.text };
            } else if (block.type === "tool_use") {
              yield { type: "tool_use", toolName: block.name, toolInput: block.input };
            } else if (block.type === "tool_result") {
              const rc = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
              yield { type: "tool_result", text: rc };
            }
          }
        }
      } else if (msg.type === "result") {
        yield {
          type: "result",
          cost: msg.total_cost_usd ?? null,
          duration: msg.duration_ms ?? null,
        };
      }
    }
  }

  interrupt(): void { this.session.interrupt(); }
  get turnCount(): number { return this.session.turnCount; }
  get shouldRotate(): boolean { return this.session.shouldRotate; }
  get shouldWarnRotation(): boolean { return this.session.shouldWarnRotation; }
  incrementTurn(): void { this.session.incrementTurn(); }
  async rotate(): Promise<void> { return this.session.rotate(); }
}
