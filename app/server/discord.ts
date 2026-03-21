import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
} from "discord.js";
import { AgentSession } from "./agent.ts";
import type { store as StoreType } from "./db.ts";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_ROOT = path.resolve(__dirname, "../..");

// Discord hard limit: 2000 chars. Keep a small buffer.
const MAX_MSG_LEN = 1900;

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
 * DiscordBridge listens to DMs and @mentions and routes each user to
 * a dedicated persistent AgentSession, keyed by Discord user ID.
 */
export class DiscordBridge {
  private client: Client | null = null;
  private store: typeof StoreType;
  // Map: discordUserId → sessionId
  private userToSession = new Map<string, string>();
  // Map: sessionId → AgentSession
  private agentSessions = new Map<string, AgentSession>();

  constructor(store: typeof StoreType) {
    this.store = store;
  }

  /**
   * Login and start listening for messages.
   * @param token        Discord bot token
   * @param allowedUsers Optional list of allowed Discord user IDs or usernames.
   *                     If empty, all users are allowed.
   */
  start(token: string, allowedUsers?: string[]) {
    if (this.client) {
      console.warn("[Discord] Bridge already started");
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      // Ignore bots (including self)
      if (message.author.bot) return;

      const isDM = message.channel.isDMBased();
      const isMention =
        this.client?.user &&
        message.mentions.has(this.client.user);

      // Only respond to DMs or @mentions in servers
      if (!isDM && !isMention) return;

      const userId = message.author.id;
      const username = message.author.username;

      // Access control
      if (allowedUsers && allowedUsers.length > 0) {
        const allowed =
          allowedUsers.includes(userId) || allowedUsers.includes(username);
        if (!allowed) {
          await this.safeReply(message, "Access denied.");
          return;
        }
      }

      // Strip the bot mention prefix from the text
      const botMention = this.client?.user
        ? `<@${this.client.user.id}>`
        : null;
      let text = message.content;
      if (botMention) {
        text = text.replace(botMention, "").trim();
      }
      if (!text) return;

      // Get or create session for this user
      const sessionId = await this.getOrCreateSession(userId, username);

      // Show typing indicator
      try {
        if (message.channel instanceof TextChannel || isDM) {
          await (message.channel as any).sendTyping();
        }
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

      agentSession.sendMessage(text);

      let fullResponse = "";
      let typingInterval: ReturnType<typeof setInterval> | null = null;

      try {
        // Keep typing indicator alive during long processing
        typingInterval = setInterval(async () => {
          try {
            if (message.channel instanceof TextChannel || isDM) {
              await (message.channel as any).sendTyping();
            }
          } catch {
            // non-fatal
          }
        }, 8000);

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
            break;
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[Discord] Agent error for user ${userId}:`,
          errorMsg
        );
        fullResponse = `An error occurred: ${errorMsg}`;

        // On error, recreate the agent session next time
        this.agentSessions.delete(sessionId);
      } finally {
        if (typingInterval) clearInterval(typingInterval);
      }

      // Store assistant response
      if (fullResponse) {
        this.store.addMessage(sessionId, {
          role: "assistant",
          content: fullResponse,
        });
      }

      // Reply (split if needed)
      const replyText = fullResponse || "(no response)";
      const parts = splitMessage(replyText);
      for (const part of parts) {
        await this.safeReply(message, part);
      }
    });

    this.client.on(Events.Error, (err) => {
      console.error("[Discord] Client error:", err.message);
    });

    this.client.login(token).then(() => {
      console.log(
        `[Discord] Bridge started, logged in as ${this.client?.user?.tag}`
      );
    }).catch((err) => {
      console.error("[Discord] Login failed:", err.message);
    });
  }

  stop() {
    for (const session of this.agentSessions.values()) {
      session.interrupt();
    }
    this.agentSessions.clear();

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    console.log("[Discord] Bridge stopped");
  }

  private async getOrCreateSession(
    userId: string,
    username: string
  ): Promise<string> {
    const existing = this.userToSession.get(userId);
    if (existing) return existing;

    const session = this.store.createSession(`Discord:${username}`);
    this.userToSession.set(userId, session.id);
    return session.id;
  }

  private async safeReply(message: Message, text: string): Promise<void> {
    try {
      await message.reply(text);
    } catch (err) {
      console.error(
        "[Discord] Failed to reply:",
        err instanceof Error ? err.message : err
      );
    }
  }
}
