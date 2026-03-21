import TelegramBot from "node-telegram-bot-api";
import { AgentSession } from "./agent.ts";
import type { store as StoreType } from "./db.ts";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_ROOT = path.resolve(__dirname, "../..");

// Maximum Telegram message length (hard limit: 4096, keep a buffer)
const MAX_MSG_LEN = 4000;

function splitMessage(text: string): string[] {
  if (text.length <= MAX_MSG_LEN) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    parts.push(remaining.slice(0, MAX_MSG_LEN));
    remaining = remaining.slice(MAX_MSG_LEN);
  }
  return parts;
}

/**
 * TelegramBridge connects a Telegram bot to agent sessions.
 * Each Telegram user gets their own persistent AgentSession,
 * keyed by chat_id. Sessions survive across messages in the same run.
 */
export class TelegramBridge {
  private bot: TelegramBot | null = null;
  private store: typeof StoreType;
  // Map: chatId (string) → sessionId (string)
  private chatToSession = new Map<string, string>();
  // Map: sessionId → AgentSession
  private agentSessions = new Map<string, AgentSession>();

  constructor(store: typeof StoreType) {
    this.store = store;
  }

  /**
   * Start polling for messages.
   * @param token     Telegram bot token
   * @param allowedUsers  Optional list of allowed usernames/chat_ids (strings).
   *                      If empty, all users are allowed.
   */
  start(token: string, allowedUsers?: string[]) {
    if (this.bot) {
      console.warn("[Telegram] Bridge already started");
      return;
    }

    this.bot = new TelegramBot(token, { polling: true });

    this.bot.on("message", async (msg) => {
      const chatId = String(msg.chat.id);
      const text = msg.text?.trim();
      if (!text) return;

      // Access control
      if (allowedUsers && allowedUsers.length > 0) {
        const username = msg.from?.username ?? "";
        const userId = String(msg.from?.id ?? "");
        const allowed =
          allowedUsers.includes(username) ||
          allowedUsers.includes(userId) ||
          allowedUsers.includes(chatId);
        if (!allowed) {
          await this.safeSend(chatId, "Access denied.");
          return;
        }
      }

      // Get or create a DB session for this chat
      const sessionId = await this.getOrCreateSession(chatId);

      // Show typing indicator
      try {
        await this.bot!.sendChatAction(chatId, "typing");
      } catch {
        // non-fatal
      }

      // Get or create an in-memory AgentSession
      let agentSession = this.agentSessions.get(sessionId);
      if (!agentSession) {
        agentSession = new AgentSession(sessionId, AGENT_ROOT);
        this.agentSessions.set(sessionId, agentSession);
      }

      // Store user message in DB
      this.store.addMessage(sessionId, { role: "user", content: text });

      // Send to agent and collect full response
      agentSession.sendMessage(text);

      let fullResponse = "";
      let typingInterval: ReturnType<typeof setInterval> | null = null;

      try {
        // Keep typing indicator alive during processing
        typingInterval = setInterval(async () => {
          try {
            await this.bot!.sendChatAction(chatId, "typing");
          } catch {
            // non-fatal
          }
        }, 4000);

        for await (const sdkMsg of agentSession.getOutputStream()) {
          if (sdkMsg.type === "assistant") {
            const content = sdkMsg.message?.content;
            if (!content) continue;

            if (typeof content === "string") {
              fullResponse += content;
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && block.text) {
                  fullResponse += block.text;
                }
              }
            }
          } else if (sdkMsg.type === "result") {
            // Done processing this turn
            break;
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram] Agent error for chat ${chatId}:`, errorMsg);
        fullResponse = `An error occurred: ${errorMsg}`;

        // On error, recreate the session so next message starts fresh
        this.agentSessions.delete(sessionId);
      } finally {
        if (typingInterval) clearInterval(typingInterval);
      }

      // Store assistant response in DB
      if (fullResponse) {
        this.store.addMessage(sessionId, {
          role: "assistant",
          content: fullResponse,
        });
      }

      // Send response back to Telegram (split if needed)
      const replyText = fullResponse || "(no response)";
      const parts = splitMessage(replyText);
      for (const part of parts) {
        await this.safeSend(chatId, part);
      }
    });

    this.bot.on("polling_error", (err) => {
      console.error("[Telegram] Polling error:", err.message);
    });

    console.log("[Telegram] Bridge started, polling for messages");
  }

  stop() {
    if (this.bot) {
      this.bot.stopPolling();
      this.bot = null;
    }
    for (const session of this.agentSessions.values()) {
      session.interrupt();
    }
    this.agentSessions.clear();
    console.log("[Telegram] Bridge stopped");
  }

  private async getOrCreateSession(chatId: string): Promise<string> {
    const existing = this.chatToSession.get(chatId);
    if (existing) return existing;

    const session = this.store.createSession(`Telegram:${chatId}`);
    this.chatToSession.set(chatId, session.id);
    return session.id;
  }

  private async safeSend(chatId: string, text: string): Promise<void> {
    try {
      await this.bot!.sendMessage(chatId, text);
    } catch (err) {
      console.error(
        `[Telegram] Failed to send message to ${chatId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
