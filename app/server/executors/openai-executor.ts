/**
 * OpenAIExecutor — OpenAI API (also supports Grok via baseURL override).
 */

import type { IExecutor, ExecutorConfig, ExecutorStreamEvent } from "./types.ts";

export class OpenAIExecutor implements IExecutor {
  readonly executorId: string;
  readonly executorType: "openai" | "grok";
  private messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  private pendingContent: string | null = null;
  private model: string;
  private apiKey: string;
  private baseURL: string | undefined;
  private systemPrompt: string;
  private _turnCount = 0;
  private static readonly MAX_TURNS = 50;
  private static readonly WARN_TURNS = 40;
  private pendingSummary: string | null = null;
  private abortController: AbortController | null = null;
  private pendingAbort = false;

  constructor(config: ExecutorConfig) {
    this.executorId = config.sessionId;
    this.executorType = config.type as "openai" | "grok";
    this.model = config.model || (config.type === "grok" ? "grok-3" : "gpt-4o");
    this.apiKey = config.apiKey || (config.type === "grok" ? process.env.GROK_API_KEY || "" : process.env.OPENAI_API_KEY || "");
    this.baseURL = config.baseURL || (config.type === "grok" ? "https://api.x.ai/v1" : undefined);
    this.systemPrompt = config.systemPrompt || "";

    if (this.systemPrompt) {
      this.messages.push({ role: "system", content: this.systemPrompt });
    }
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

    let OpenAI: any;
    try {
      const sdk = await import("openai");
      OpenAI = sdk.default || sdk.OpenAI;
    } catch {
      yield { type: "error", error: "openai package not installed. Run: npm install openai" };
      return;
    }

    const client = new OpenAI({
      apiKey: this.apiKey,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
    });

    this.abortController = new AbortController();
    if (this.pendingAbort) { this.abortController.abort(); this.pendingAbort = false; }
    const signal = this.abortController.signal;

    let assistantText = "";
    let userPushed = false;
    try {
      this.messages.push({ role: "user", content: userMsg });
      userPushed = true;

      const stream = await client.chat.completions.create({
        model: this.model,
        messages: this.messages,
        stream: true,
      }, { signal });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          assistantText += delta;
          yield { type: "text_delta", text: delta };
        }
      }
      this.messages.push({ role: "assistant", content: assistantText });
      yield { type: "result", cost: null, duration: null };
    } catch (err) {
      // openai v6 throws APIUserAbortError; check signal.aborted as the canonical source
      const isAbort = signal.aborted ||
        (err instanceof Error && (err.name === "AbortError" || err.constructor?.name === "APIUserAbortError"));
      if (isAbort) {
        if (assistantText) {
          this.messages.push({ role: "assistant", content: assistantText });
        } else if (userPushed) {
          this.messages.pop();
        }
      } else {
        if (userPushed) this.messages.pop();
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
  get shouldRotate(): boolean { return this._turnCount >= OpenAIExecutor.MAX_TURNS; }
  get shouldWarnRotation(): boolean { return this._turnCount >= OpenAIExecutor.WARN_TURNS && !this.shouldRotate; }
  incrementTurn(): void { this._turnCount++; }

  async rotate(): Promise<void> {
    const sysMsg = this.messages.find(m => m.role === "system");
    const historyText = this.messages.filter(m => m.role !== "system")
      .map(m => `${m.role}: ${m.content.slice(0, 300)}`).join("\n");
    this.pendingSummary = historyText.slice(0, 2000);
    this.messages = sysMsg ? [sysMsg] : [];
    this._turnCount = 0;
  }
}
