import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
} from "discord.js";
import { AgentSession, CliSession, createSession, type CliType } from "./agent.ts";
import type { store as StoreType, Role } from "./db.ts";
import { shouldReply } from "./reply-filter.ts";
import { AGENT_ROOT } from "./paths.ts";
import { handleAgentStream, splitMessage, extractMemoryTags, stripMemoryTags } from "./stream-handler.ts";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";

// Discord hard limit: 2000 chars. Keep a small buffer.
const MAX_MSG_LEN = 1900;

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
  // Per-user message queue to prevent race conditions
  private userLocks = new Map<string, Promise<void>>();

  constructor(store: typeof StoreType) {
    this.store = store;
  }

  /**
   * Login and start listening for messages.
   * @param token        Discord bot token
   * @param allowedUsers Optional list of allowed Discord user IDs or usernames.
   *                     If empty or not provided, all users are blocked until admin adds them.
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

      // Handle attachments (images, files, videos)
      if (message.attachments.size > 0) {
        const mediaDir = path.join(process.env.AGENT_ROOT || AGENT_ROOT, "workspace", "media");
        fs.mkdirSync(mediaDir, { recursive: true });
        for (const [, attachment] of message.attachments) {
          try {
            const ext = path.extname(attachment.name || "") || "";
            const safeName = (attachment.name || `discord-${Date.now()}${ext}`).replace(/[^a-z0-9._-]/gi, "-");
            const localPath = path.join(mediaDir, safeName);
            const url = attachment.url;
            await new Promise<void>((resolve, reject) => {
              const file = fs.createWriteStream(localPath);
              const getter = url.startsWith("https") ? https : http;
              getter.get(url, (res) => {
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(); });
              }).on("error", reject);
            });
            const type = attachment.contentType?.split("/")[0] || "file";
            text += `\n[User sent a ${type}: ${attachment.name}, saved to: ${localPath}]\nAnalyze this file.`;
            console.log(`[Discord] Downloaded attachment: ${localPath} (${attachment.size} bytes)`);
          } catch (err) {
            console.error(`[Discord] Failed to download attachment:`, err);
          }
        }
      }

      if (!text) return;

      // Use channel ID for server channels, user ID for DMs
      const chatKey = isDM ? userId : message.channel.id;

      // Enqueue to prevent race conditions on rapid messages
      const prevLock = this.userLocks.get(userId) || Promise.resolve();
      const processPromise = prevLock.then(() => this.processAgentMessage(userId, chatKey, text, message, isDM, !!isMention, username));
      this.userLocks.set(userId, processPromise.catch(() => {}));
    });

    this.client.on(Events.Error, (err) => {
      console.error("[Discord] Client error:", err.message);
    });

    this.client.login(token).then(() => {
      console.log(`[Discord] Bridge started, logged in as ${this.client?.user?.tag}`);
    }).catch((err) => {
      console.error("[Discord] Login failed:", err.message);
      if (this.client) {
        this.client.destroy();
        this.client = null;
      }
    });
  }

  /**
   * Process an agent message. Separated for per-user sequential queuing.
   */
  private async processAgentMessage(
    userId: string,
    chatKey: string,
    text: string,
    message: Message,
    isDM: boolean,
    isMention: boolean,
    username: string,
  ) {
      // Look up role for this chat
      const role = this.store.getRoleByChatId(chatKey) || undefined;

      // Smart reply filter: decide whether to respond in groups
      const isReplyToBot = false; // Discord threading is different, keep it simple for now
      const botName = role?.name || this.client?.user?.displayName || '';

      const decision = shouldReply({
        text, role: role || null, isMention, isReplyToBot, isDM, botName,
      });

      if (!decision.shouldReply) return;

      // Build per-chat memory map
      const memories = this.store.listRoleMemories(chatKey);
      const chatMemory: Record<string, string> = {};
      for (const m of memories) { chatMemory[m.key] = m.value; }

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
        agentSession = createSession(sessionId, process.env.AGENT_ROOT || AGENT_ROOT, defaultCli, role, chatMemory);
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
          for (const part of splitMessage(reply, MAX_MSG_LEN)) {
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

      // Gather context for background memory extraction
      const recentMsgs = this.store.getMessages(sessionId, 20)
        .map((m: any) => ({ role: m.role, content: m.content || "" }));

      let firstReply = true;
      let fullResponse = "";
      try {
        fullResponse = await handleAgentStream({
          session: agentSession as AgentSession,
          sendTyping: async () => {
            try {
              if (message.channel instanceof TextChannel || isDM) {
                await (message.channel as any).sendTyping();
              }
            } catch {}
          },
          sendText: async (text) => {
            if (firstReply) {
              await this.safeReply(message, text);
              firstReply = false;
            } else {
              try { await (message.channel as TextChannel).send(text); } catch {}
            }
          },
          maxMsgLen: MAX_MSG_LEN,
          recentMessages: recentMsgs,
          existingMemories: chatMemory,
          onMemoryExtracted: (mems) => {
            for (const m of mems) {
              this.store.setRoleMemory(chatKey, m.key, m.value);
              console.log(`[Discord] Auto-extracted memory for chat ${chatKey}: ${m.key}`);
            }
          },
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Discord] Agent error for user ${userId}:`, errorMsg);

        const isContextOverflow = /prompt_too_long|context_length|overloaded/i.test(errorMsg);
        if (isContextOverflow && agentSession instanceof AgentSession) {
          await (agentSession as AgentSession).rotate();
          await this.safeReply(message, "[Context full — session refreshed. Please resend your message.]");
        } else {
          fullResponse = `Error: ${errorMsg}`;
          await this.safeReply(message, fullResponse);
          this.agentSessions.delete(sessionId);
        }
      }

      // Auto-extract memories from assistant response
      for (const mem of extractMemoryTags(fullResponse)) {
        this.store.setRoleMemory(chatKey, mem.key, mem.value);
        console.log(`[Discord] Saved memory for chat ${chatKey}: ${mem.key}`);
      }
      fullResponse = stripMemoryTags(fullResponse);

      if (!fullResponse.trim()) {
        await this.safeReply(message, "(no response)");
      }

      if (fullResponse) {
        this.store.addMessage(sessionId, { role: "assistant", content: fullResponse });
      }
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

    // Reuse existing DB session to avoid duplicates across restarts
    const title = `Discord:${username}`;
    const found = this.store.findSessionByTitle(title);
    const session = found || this.store.createSession(title);
    this.userToSession.set(userId, session.id);
    return session.id;
  }

  public async safeReply(message: Message, text: string): Promise<void> {
    try {
      await message.reply(text);
    } catch (err) {
      console.error(
        "[Discord] Failed to reply:",
        err instanceof Error ? err.message : err
      );
    }
  }

  public invalidateSession(userId: string) {
    const sessionId = this.userToSession.get(userId);
    if (sessionId) {
      const session = this.agentSessions.get(sessionId);
      if (session instanceof AgentSession) session.interrupt();
      else if (session instanceof CliSession) session.abort();
      this.agentSessions.delete(sessionId);
      this.userToSession.delete(userId);
      console.log(`[Discord] Invalidated session for user ${userId}`);
    }
  }
}
