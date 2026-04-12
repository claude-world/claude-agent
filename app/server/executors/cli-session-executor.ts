/**
 * CliSessionExecutor — wraps CliSession (codex/gemini-cli/opencode) for IExecutor.
 */

import { CliSession } from "../agent.ts";
import type { IExecutor, ExecutorConfig, ExecutorStreamEvent, ExecutorType } from "./types.ts";

const CLI_TYPE_MAP: Record<string, "codex" | "gemini" | "opencode"> = {
  "codex-cli": "codex",
  "gemini-cli": "gemini",
  "opencode-cli": "opencode",
};

export class CliSessionExecutor implements IExecutor {
  readonly executorId: string;
  readonly executorType: ExecutorType;
  private session: CliSession;
  private pendingContent: string | null = null;
  private _turnCount = 0;

  constructor(config: ExecutorConfig) {
    this.executorId = config.sessionId;
    this.executorType = config.type;
    const cliType = CLI_TYPE_MAP[config.type] || "codex";
    this.session = new CliSession(cliType, config.cwd || process.cwd());
  }

  sendMessage(content: string): void {
    if (!content?.trim()) {
      console.warn("[CliSessionExecutor] sendMessage called with empty content, ignoring");
      return;
    }
    this.pendingContent = content;
  }

  async *getOutputStream(): AsyncGenerator<ExecutorStreamEvent> {
    if (!this.pendingContent) {
      yield { type: "error", error: "No message queued" };
      return;
    }
    const content = this.pendingContent;
    this.pendingContent = null;
    try {
      const output = await this.session.execute(content);
      yield { type: "text_delta", text: `[${this.executorType}] ${output}` };
      yield { type: "result", cost: null, duration: null };
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }

  interrupt(): void { this.session.abort(); }
  get turnCount(): number { return this._turnCount; }
  get shouldRotate(): boolean { return false; } // CliSession has no context limit
  get shouldWarnRotation(): boolean { return false; }
  incrementTurn(): void { this._turnCount++; }
  async rotate(): Promise<void> {} // no-op
}
