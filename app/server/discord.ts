import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
} from "discord.js";
import { AgentSession, CliSession, createSession, type CliType } from "./agent.ts";
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
  // Map: sessionId → AgentSession | CliSession
  private agentSessions = new Map<string, AgentSession | CliSession>();

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

      // Access control — always check
      if (!allowedUsers || allowedUsers.length === 0) {
        await this.safeReply(message, `Welcome! Before you can use this bot, the admin needs to add your ID.\n\nYour user\\_id: \`${userId}\`\nUsername: ${username}\n\nGo to Claude Agent → Channels → Edit → paste this user\\_id and save.`);
        console.log(`[Discord] No allowlist. New user: user_id=${userId} username=${username}`);
        return;
      }

      const allowed =
        allowedUsers.includes(userId) || allowedUsers.includes(username);
      if (!allowed) {
        await this.safeReply(message, `Access denied.\n\nYour user\\_id: \`${userId}\`\nUsername: ${username}\n\nAsk the admin to add your user\\_id or username to the allowed users list.`);
        console.log(`[Discord] Blocked: user_id=${userId} username=${username}`);
        return;
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

      // Get or create an in-memory session (respects default_cli setting)
      let agentSession = this.agentSessions.get(sessionId);
      if (!agentSession) {
        const defaultCli = (this.store.getSetting("default_cli") || "claude") as CliType;
        console.log(`[Discord] Creating session for ${userId} with CLI: ${defaultCli}`);
        agentSession = createSession(sessionId, AGENT_ROOT, defaultCli);
        this.agentSessions.set(sessionId, agentSession);
      }

      // Store user message in DB
      this.store.addMessage(sessionId, { role: "user", content: text });

      // CliSession (codex/gemini/opencode): one-shot execute
      if (agentSession instanceof CliSession) {
        try {
          if (message.channel instanceof TextChannel || isDM) {
            await (message.channel as any).sendTyping();
          }
          const output = await agentSession.execute(text);
          const reply = output || "(no response)";
          this.store.addMessage(sessionId, { role: "assistant", content: reply });
          for (const part of splitMessage(reply)) {
            await this.safeReply(message, part);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await this.safeReply(message, `Error: ${errorMsg}`);
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
      let firstReply = true;
      const FLUSH_INTERVAL = 2000;

      const flushPending = async () => {
        if (pendingText.trim()) {
          const toSend = pendingText.trim();
          pendingText = "";
          const parts = splitMessage(toSend);
          for (const part of parts) {
            if (firstReply) {
              await this.safeReply(message, part);
              firstReply = false;
            } else {
              try { await message.channel.send(part); } catch {}
            }
          }
          lastSendTime = Date.now();
        }
      };

      try {
        typingInterval = setInterval(async () => {
          try {
            if (message.channel instanceof TextChannel || isDM) {
              await (message.channel as any).sendTyping();
            }
          } catch {}
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
        console.error(`[Discord] Agent error for user ${userId}:`, errorMsg);
        pendingText = `Error: ${errorMsg}`;
        this.agentSessions.delete(sessionId);
      } finally {
        if (typingInterval) clearInterval(typingInterval);
      }

      await flushPending();

      if (!fullResponse.trim()) {
        await this.safeReply(message, "(no response)");
      }

      if (fullResponse) {
        this.store.addMessage(sessionId, { role: "assistant", content: fullResponse });
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
      if (session instanceof AgentSession) session.interrupt();
      else if (session instanceof CliSession) session.abort();
    }
    this.agentSessions.clear();
    this.userToSession.clear();

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
