import TelegramBot from "node-telegram-bot-api";
import { AgentSession, CliSession, createSession, CONFIG_BOT_PROMPT, type CliType } from "./agent.ts";
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
  // Map: sessionId → AgentSession | CliSession
  private agentSessions = new Map<string, AgentSession | CliSession>();

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

      // Access control — always check, even if allowlist is empty
      const username = msg.from?.username ?? "";
      const userId = String(msg.from?.id ?? "");

      if (!allowedUsers || allowedUsers.length === 0) {
        // No allowlist configured — block everyone and show their ID so admin can add them
        const senderInfo = username ? `@${username}` : `user_id: ${userId}`;
        await this.safeSend(
          chatId,
          `Welcome! Before you can use this bot, the admin needs to add your ID.\n\nYour chat\\_id: \`${chatId}\`\nUsername: ${senderInfo}\n\nGo to Claude Agent → Channels → Edit → paste this chat\\_id and save.`
        );
        console.log(`[Telegram] No allowlist. New user: chat_id=${chatId} username=${username}`);
        return;
      }

      const allowed =
        allowedUsers.includes(username) ||
        allowedUsers.includes(userId) ||
        allowedUsers.includes(chatId);
      if (!allowed) {
        const senderInfo = username ? `@${username}` : `user_id: ${userId}`;
        await this.safeSend(
          chatId,
          `Access denied.\n\nYour chat\\_id: \`${chatId}\`\nUsername: ${senderInfo}\n\nAsk the admin to add your chat\\_id or username to the allowed users list.`
        );
        console.log(`[Telegram] Blocked: chat_id=${chatId} username=${username} user_id=${userId}`);
        return;
      }

      // /config command: route to config bot session
      if (text.startsWith('/config')) {
        const configPrompt = text.slice(7).trim();
        if (!configPrompt) {
          await this.safeSend(chatId, 'Usage: /config <what you want to configure>\n\nExample: /config show me current settings');
          return;
        }
        const configSessionId = await this.getOrCreateConfigSession(chatId);
        try {
          await this.bot!.sendChatAction(chatId, "typing");
        } catch {}

        let configSession = this.agentSessions.get(configSessionId);
        if (!configSession) {
          configSession = createSession(configSessionId, AGENT_ROOT, 'claude');
          this.agentSessions.set(configSessionId, configSession);
        }

        this.store.addMessage(configSessionId, { role: "user", content: configPrompt });

        if (configSession instanceof AgentSession) {
          const enrichedPrompt = `${CONFIG_BOT_PROMPT}\n\nUser request: ${configPrompt}`;
          (configSession as AgentSession).sendMessage(enrichedPrompt);

          let fullResponse = "";
          let pendingText = "";
          let typingInterval: ReturnType<typeof setInterval> | null = null;
          let lastSendTime = 0;
          const FLUSH_INTERVAL = 2000;

          const flushPending = async () => {
            if (pendingText.trim()) {
              const toSend = pendingText.trim();
              pendingText = "";
              const parts = splitMessage(toSend);
              for (const part of parts) {
                await this.safeSend(chatId, part);
              }
              lastSendTime = Date.now();
            }
          };

          try {
            typingInterval = setInterval(async () => {
              try { await this.bot!.sendChatAction(chatId, "typing"); } catch {}
              if (pendingText.trim() && Date.now() - lastSendTime > FLUSH_INTERVAL) {
                await flushPending();
              }
            }, 3000);

            for await (const sdkMsg of (configSession as AgentSession).getOutputStream()) {
              if (sdkMsg.type === "assistant") {
                const content = sdkMsg.message?.content;
                if (!content) continue;
                let newText = "";
                if (typeof content === "string") {
                  newText = content;
                } else if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === "text" && block.text) newText += block.text;
                  }
                }
                if (newText) {
                  fullResponse += newText;
                  pendingText += newText;
                  if (pendingText.includes("\n\n") || pendingText.length > 500) {
                    await flushPending();
                  }
                }
              } else if (sdkMsg.type === "result") {
                break;
              }
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            pendingText = `Error: ${errorMsg}`;
            this.agentSessions.delete(configSessionId);
          } finally {
            if (typingInterval) clearInterval(typingInterval);
          }

          await flushPending();
          if (!fullResponse.trim()) await this.safeSend(chatId, "(no response)");
          if (fullResponse) {
            this.store.addMessage(configSessionId, { role: "assistant", content: fullResponse });
          }
        }
        return;
      }

      // Get or create a DB session for this chat
      const sessionId = await this.getOrCreateSession(chatId);

      // Show typing indicator
      try {
        await this.bot!.sendChatAction(chatId, "typing");
      } catch {
        // non-fatal
      }

      // Get or create an in-memory session (respects default_cli setting)
      let agentSession = this.agentSessions.get(sessionId);
      if (!agentSession) {
        const defaultCli = (this.store.getSetting("default_cli") || "claude") as CliType;
        console.log(`[Telegram] Creating session for chat ${chatId} with CLI: ${defaultCli}`);
        agentSession = createSession(sessionId, AGENT_ROOT, defaultCli);
        this.agentSessions.set(sessionId, agentSession);
      }

      // Store user message in DB
      this.store.addMessage(sessionId, { role: "user", content: text });

      // CliSession (codex/gemini/opencode): one-shot execute
      if (agentSession instanceof CliSession) {
        try {
          await this.bot!.sendChatAction(chatId, "typing");
          const output = await agentSession.execute(text);
          const reply = output || "(no response)";
          this.store.addMessage(sessionId, { role: "assistant", content: reply });
          for (const part of splitMessage(reply)) {
            await this.safeSend(chatId, part);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await this.safeSend(chatId, `Error: ${errorMsg}`);
          this.agentSessions.delete(sessionId);
        }
        return;
      }

      // AgentSession (claude): streaming
      (agentSession as AgentSession).sendMessage(text);

      let fullResponse = "";
      let pendingText = "";
      let typingInterval: ReturnType<typeof setInterval> | null = null;
      let lastSendTime = 0;
      const FLUSH_INTERVAL = 2000; // Send every 2 seconds if there's pending text

      const flushPending = async () => {
        if (pendingText.trim()) {
          const toSend = pendingText.trim();
          pendingText = "";
          const parts = splitMessage(toSend);
          for (const part of parts) {
            await this.safeSend(chatId, part);
          }
          lastSendTime = Date.now();
        }
      };

      try {
        // Keep typing indicator alive + periodic flush
        typingInterval = setInterval(async () => {
          try {
            await this.bot!.sendChatAction(chatId, "typing");
          } catch {}
          // Flush pending text if enough time has passed
          if (pendingText.trim() && Date.now() - lastSendTime > FLUSH_INTERVAL) {
            await flushPending();
          }
        }, 3000);

        for await (const sdkMsg of agentSession.getOutputStream()) {
          if (sdkMsg.type === "assistant") {
            const content = sdkMsg.message?.content;
            if (!content) continue;

            let newText = "";
            if (typeof content === "string") {
              newText = content;
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && block.text) {
                  newText += block.text;
                }
              }
            }

            if (newText) {
              fullResponse += newText;
              pendingText += newText;

              // Send immediately if we have a complete paragraph or enough text
              if (pendingText.includes("\n\n") || pendingText.length > 500) {
                await flushPending();
              }
            }
          } else if (sdkMsg.type === "result") {
            break;
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram] Agent error for chat ${chatId}:`, errorMsg);
        pendingText = `Error: ${errorMsg}`;
        this.agentSessions.delete(sessionId);
      } finally {
        if (typingInterval) clearInterval(typingInterval);
      }

      // Flush any remaining text
      await flushPending();

      // If agent produced nothing, send a fallback
      if (!fullResponse.trim()) {
        await this.safeSend(chatId, "(no response)");
      }

      // Store full response in DB
      if (fullResponse) {
        this.store.addMessage(sessionId, {
          role: "assistant",
          content: fullResponse,
        });
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
      if (session instanceof AgentSession) session.interrupt();
      else if (session instanceof CliSession) session.abort();
    }
    this.agentSessions.clear();
    this.chatToSession.clear();
    console.log("[Telegram] Bridge stopped");
  }

  private async getOrCreateSession(chatId: string): Promise<string> {
    const existing = this.chatToSession.get(chatId);
    if (existing) return existing;

    const session = this.store.createSession(`Telegram:${chatId}`);
    this.chatToSession.set(chatId, session.id);
    return session.id;
  }

  private async getOrCreateConfigSession(chatId: string): Promise<string> {
    const configKey = `config-${chatId}`;
    const existing = this.chatToSession.get(configKey);
    if (existing) return existing;

    const session = this.store.createSession(`ConfigBot:${chatId}`);
    this.chatToSession.set(configKey, session.id);
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
