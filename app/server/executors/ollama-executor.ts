/**
 * OllamaExecutor — local Ollama via `ollama` npm package.
 * Default endpoint: http://localhost:11434
 */

import type { IExecutor, ExecutorConfig, ExecutorStreamEvent } from "./types.ts";

export class OllamaExecutor implements IExecutor {
  readonly executorId: string;
  readonly executorType = "ollama" as const;
  private messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  private pendingContent: string | null = null;
  private model: string;
  private host: string;
  private systemPrompt: string;
  private _turnCount = 0;
  private static readonly MAX_TURNS = 50;
  private static readonly WARN_TURNS = 40;
  private pendingSummary: string | null = null;
  private cancelled = false;

  constructor(config: ExecutorConfig) {
    this.executorId = config.sessionId;
    this.model = config.model || "llama3.2";
    this.host = config.baseURL || process.env.OLLAMA_HOST || "http://localhost:11434";
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
    this.cancelled = false; // reset before new request; interrupt() sets this to true
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

    let ollama: any;
    try {
      const pkg = await import("ollama");
      const { Ollama } = pkg;
      ollama = new Ollama({ host: this.host });
    } catch {
      yield { type: "error", error: "ollama package not installed. Run: npm install ollama" };
      return;
    }

    let assistantText = "";
    let userPushed = false;
    try {
      this.messages.push({ role: "user", content: userMsg });
      userPushed = true;

      // Wrap chat() in a timeout race — ollama npm does not support AbortSignal directly,
      // so a firewall-dropped connection would otherwise hang indefinitely.
      const chatPromise = ollama.chat({
        model: this.model,
        messages: this.messages,
        stream: true,
      });
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("Ollama request timed out after 30s")), 30_000);
      });
      let stream: any;
      try {
        stream = await Promise.race([chatPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutHandle);
      }

      for await (const part of stream) {
        if (this.cancelled) break;
        const text = part.message?.content;
        if (text) {
          assistantText += text;
          yield { type: "text_delta", text };
        }
      }

      if (this.cancelled) {
        if (assistantText) {
          this.messages.push({ role: "assistant", content: assistantText });
        } else if (userPushed) {
          this.messages.pop();
        }
      } else {
        this.messages.push({ role: "assistant", content: assistantText });
        yield { type: "result", cost: null, duration: null };
      }
    } catch (err) {
      if (userPushed) this.messages.pop();
      yield { type: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }

  interrupt(): void {
    this.pendingContent = null;
    this.cancelled = true;
  }

  get turnCount(): number { return this._turnCount; }
  get shouldRotate(): boolean { return this._turnCount >= OllamaExecutor.MAX_TURNS; }
  get shouldWarnRotation(): boolean { return this._turnCount >= OllamaExecutor.WARN_TURNS && !this.shouldRotate; }
  incrementTurn(): void { this._turnCount++; }

  async rotate(): Promise<void> {
    const sys = this.messages.find(m => m.role === "system");
    const hist = this.messages.filter(m => m.role !== "system").map(m => `${m.role}: ${m.content.slice(0, 300)}`).join("\n");
    this.pendingSummary = hist.slice(0, 2000);
    this.messages = sys ? [sys] : [];
    this._turnCount = 0;
  }
}
