/**
 * AnthropicSdkExecutor — direct @anthropic-ai/sdk integration.
 * Manages conversation history locally (no --resume needed).
 */

import type { IExecutor, ExecutorConfig, ExecutorStreamEvent } from "./types.ts";

export class AnthropicSdkExecutor implements IExecutor {
  readonly executorId: string;
  readonly executorType = "anthropic-sdk" as const;
  private messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  private pendingContent: string | null = null;
  private model: string;
  private apiKey: string;
  private systemPrompt: string;
  private _turnCount = 0;
  private static readonly MAX_TURNS = 50;
  private static readonly WARN_TURNS = 40;
  private pendingSummary: string | null = null;
  private abortController: AbortController | null = null;
  private pendingAbort = false;

  constructor(config: ExecutorConfig) {
    this.executorId = config.sessionId;
    this.model = config.model || "claude-sonnet-5-5";
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.systemPrompt = config.systemPrompt || "";
  }

  sendMessage(content: string): void {
    if (!content?.trim()) {
      console.warn(`[Executor] sendMessage called with empty content, ignoring`);
      return;
    }
    let msg = content;
    if (this.pendingSummary) {
      msg = `<previous-session-summary>\n${this.pendingSummary}\n</previous-session-summary>\n\n${content}`;
      this.pendingSummary = null;
    }
    this.pendingContent = msg;
  }

  async *getOutputStream(): AsyncGenerator<ExecutorStreamEvent> {
    if (!this.pendingContent) {
      yield { type: "error", error: "No message queued" };
      return;
    }

    const userMsg = this.pendingContent;
    this.pendingContent = null;

    // Dynamically import SDK to avoid startup errors if not installed
    let Anthropic: any;
    try {
      const sdk = await import("@anthropic-ai/sdk");
      Anthropic = sdk.default || sdk.Anthropic;
    } catch {
      yield { type: "error", error: "@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk" };
      return;
    }

    const client = new Anthropic({ apiKey: this.apiKey });
    this.abortController = new AbortController();
    if (this.pendingAbort) { this.abortController.abort(); this.pendingAbort = false; }
    const signal = this.abortController.signal;   // capture before try so catch can read it

    let assistantText = "";
    let userPushed = false;
    try {
      this.messages.push({ role: "user", content: userMsg });
      userPushed = true;

      const stream = await client.messages.stream({
        model: this.model,
        max_tokens: 8096,
        system: this.systemPrompt || undefined,
        messages: this.messages,
      }, { signal });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          assistantText += event.delta.text;
          yield { type: "text_delta", text: event.delta.text };
        }
      }

      this.messages.push({ role: "assistant", content: assistantText });
      yield { type: "result", cost: null, duration: null };
    } catch (err) {
      const isAbort = signal.aborted || (err instanceof Error && err.name === "AbortError");
      if (isAbort) {
        // Keep history consistent: push partial assistant response if any, else rollback user
        if (assistantText) {
          this.messages.push({ role: "assistant", content: assistantText });
        } else if (userPushed) {
          this.messages.pop();
        }
      } else {
        if (userPushed) this.messages.pop(); // rollback so caller can retry cleanly
        yield { type: "error", error: err instanceof Error ? err.message : String(err) };
      }
    } finally {
      this.abortController = null;
    }
  }

  interrupt(): void {
    this.pendingContent = null;
    this.pendingAbort = true;
    this.abortController?.abort();
    this.abortController = null;
  }

  get turnCount(): number { return this._turnCount; }

  get shouldRotate(): boolean {
    return this._turnCount >= AnthropicSdkExecutor.MAX_TURNS;
  }

  get shouldWarnRotation(): boolean {
    return this._turnCount >= AnthropicSdkExecutor.WARN_TURNS && !this.shouldRotate;
  }

  incrementTurn(): void { this._turnCount++; }

  async rotate(): Promise<void> {
    // Generate compact summary from conversation history
    const historyText = this.messages
      .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
      .join("\n");

    // Reset for new session
    this._turnCount = 0;
    this.pendingSummary = `[Conversation summary — previous ${this.messages.length} messages]\n${historyText.slice(0, 3000)}`;
    this.messages = [];
  }
}
