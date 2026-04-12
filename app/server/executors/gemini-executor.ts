/**
 * GeminiExecutor — Google Gemini API via @google/generative-ai.
 */

import type { IExecutor, ExecutorConfig, ExecutorStreamEvent } from "./types.ts";

export class GeminiExecutor implements IExecutor {
  readonly executorId: string;
  readonly executorType = "gemini" as const;
  private history: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  private pendingContent: string | null = null;
  private model: string;
  private apiKey: string;
  private systemPrompt: string;
  private _turnCount = 0;
  private static readonly MAX_TURNS = 50;
  private static readonly WARN_TURNS = 40;
  private pendingSummary: string | null = null;
  private cancelled = false;

  constructor(config: ExecutorConfig) {
    this.executorId = config.sessionId;
    this.model = config.model || "gemini-2.0-flash";
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    this.systemPrompt = config.systemPrompt || "";
  }

  sendMessage(content: string): void {
    if (!content?.trim()) {
      console.warn(`[Executor] sendMessage called with empty content, ignoring`);
      return;
    }
    this.cancelled = false; // reset cancel flag at start of each new message
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

    let GoogleGenerativeAI: any;
    try {
      const sdk = await import("@google/generative-ai");
      GoogleGenerativeAI = sdk.GoogleGenerativeAI;
    } catch {
      yield { type: "error", error: "@google/generative-ai not installed. Run: npm install @google/generative-ai" };
      return;
    }

    const genAI = new GoogleGenerativeAI(this.apiKey);
    const modelInstance = genAI.getGenerativeModel({
      model: this.model,
      ...(this.systemPrompt ? { systemInstruction: this.systemPrompt } : {}),
    });

    const chat = modelInstance.startChat({ history: this.history });

    let assistantText = "";
    let userPushed = false;
    try {
      this.history.push({ role: "user", parts: [{ text: userMsg }] });
      userPushed = true;
      const result = await chat.sendMessageStream(userMsg);
      for await (const chunk of result.stream) {
        if (this.cancelled) break;
        const text = chunk.text?.();
        if (text) {
          assistantText += text;
          yield { type: "text_delta", text };
        }
      }

      if (this.cancelled) {
        if (assistantText) {
          this.history.push({ role: "model", parts: [{ text: assistantText }] });
        } else if (userPushed) {
          this.history.pop(); // remove user turn on clean abort
        }
        yield { type: "result", cost: 0 };
        return; // don't yield error on abort
      }

      this.history.push({ role: "model", parts: [{ text: assistantText }] });
      yield { type: "result", cost: null, duration: null };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        if (assistantText) {
          this.history.push({ role: "model", parts: [{ text: assistantText }] });
        } else if (userPushed) {
          this.history.pop(); // remove user turn on clean abort
        }
        return; // don't yield error on abort
      } else {
        if (userPushed) this.history.pop(); // rollback user turn on error
        yield { type: "error", error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  interrupt(): void {
    this.pendingContent = null;
    this.cancelled = true;
  }

  get turnCount(): number { return this._turnCount; }
  get shouldRotate(): boolean { return this._turnCount >= GeminiExecutor.MAX_TURNS; }
  get shouldWarnRotation(): boolean { return this._turnCount >= GeminiExecutor.WARN_TURNS && !this.shouldRotate; }
  incrementTurn(): void { this._turnCount++; }

  async rotate(): Promise<void> {
    const histText = this.history.map(h => `${h.role}: ${h.parts[0]?.text?.slice(0, 300)}`).join("\n");
    this.pendingSummary = histText.slice(0, 2000);
    this.history = [];
    this._turnCount = 0;
  }
}
