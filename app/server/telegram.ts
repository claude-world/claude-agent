import { Bot } from "node-telegram-bot-api";
import type { Message } from "node-telegram-bot-api";
import { AgentSession, CliSession, createSession, CONFIG_BOT_PROMPT, type CliType } from "./agent.ts";
import type { store as StoreType, Role } from "./db.ts";
import { shouldReply } from "./reply-filter.ts";
import { AGENT_ROOT } from "./paths.ts";
import { handleAgentStream, splitMessage, extractMemoryTags, stripMemoryTags } from "./stream-handler.ts";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";

// Maximum Telegram message length (hard limit: 4096, keep a buffer)
const MAX_MSG_LEN = 4000;

/**
 * TelegramBridge connects a Telegram bot to agent sessions.
 * Each Telegram user gets their own persistent AgentSession,
 * keyed by chat_id. Sessions survive across messages in the same run.
 */
export class TelegramBridge {
  private bot: Bot | null = null;
  private token = "";
  private store: typeof StoreType;
  // Map: chatId (string) → sessionId (string)
  private chatToSession = new Map<string, string>();
  // Map: sessionId → AgentSession | CliSession
  private agentSessions = new Map<string, AgentSession | CliSession>();
  // Per-chat message queue to prevent race conditions when rapid messages arrive.
  // Inspired by Claude Code's generation tracking in AgentSession.
  private chatLocks = new Map<string, Promise<void>>();

  constructor(store: typeof StoreType) {
    this.store = store;
  }

  /**
   * Start polling for messages.
   * @param token     Telegram bot token
   * @param allowedUsers  Optional list of allowed usernames/chat_ids (strings).
   *                      If empty or not provided, all users are blocked until admin adds them.
   */
  start(token: string, allowedUsers?: string[]) {
    if (this.bot) {
      console.warn("[Telegram] Bridge already started");
      return;
    }

    this.bot = new Bot(token);
    this.token = token;

    // Cache bot info for mention detection
    let botUsername = "";
    let botId = 0;
    this.bot.api.getMe().then((me) => {
      botUsername = me.username || "";
      botId = me.id;
      console.log(`[Telegram] Bot info: @${botUsername} (id: ${botId})`);
    }).catch(() => {});

    this.bot.on("message", async (ctx) => {
      const msg = ctx.message;
      if (!msg) return;
      const chatId = String(msg.chat.id);

      // Handle media messages (photo, document, video, audio, voice)
      let text = msg.text?.trim() || "";
      let mediaContext = "";
      try {
        mediaContext = await this.handleMedia(msg);
      } catch (err) {
        console.error(`[Telegram] Media handling error:`, err);
      }

      // Combine text + media context
      if (mediaContext) {
        text = text ? `${text}\n\n${mediaContext}` : mediaContext;
      }

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

      // /role command: show current chat's role info
      if (text.startsWith('/role')) {
        const currentRole = this.store.getRoleByChatId(chatId);
        if (!currentRole) {
          await this.safeSend(chatId, 'No role assigned to this chat.\nUse /config to create and assign roles.');
        } else {
          const memCount = this.store.listRoleMemories(chatId).length;
          await this.safeSend(chatId,
            `*${currentRole.name}*\n` +
            `Language: ${currentRole.language}\n` +
            `Style: ${currentRole.reply_style}\n` +
            `Skills: ${currentRole.allowed_skills.length > 0 ? currentRole.allowed_skills.join(', ') : 'all'}\n` +
            `Memories: ${memCount} entries`
          );
        }
        return;
      }

      // /config command: route to config bot session
      if (text.startsWith('/config')) {
        const configPrompt = text.slice(7).trim() || 'help';
        if (configPrompt === 'help' || configPrompt === '/config') {
          const lang = this.store.getSetting("language") || "en";
          const helpMsg = lang === "zh-TW"
            ? `*Settings Assistant*\n\n使用 /config + 你想做的事：\n\n*基本設定*\n/config 顯示目前設定\n/config 改語言為英文\n/config 改模型為 opus\n\n*通訊頻道*\n/config 顯示頻道狀態\n/config 加入用戶 chat\\_id\n\n*API 金鑰*\n/config 顯示所有金鑰\n/config 新增 OpenAI key\n\n*排程任務*\n/config 顯示所有任務\n/config 建立每日簡報\n\n*系統*\n/config 健康檢查\n/config 匯出備份\n/config 使用統計`
            : lang === "ja"
            ? `*Settings Assistant*\n\n/config + やりたいこと：\n\n/config 現在の設定を表示\n/config 言語を変更\n/config チャンネル状態\n/config ヘルスチェック`
            : `*Settings Assistant*\n\nUse /config + what you want:\n\n*Basic*\n/config show current settings\n/config change language to Chinese\n/config switch model to opus\n\n*Channels*\n/config show channel status\n/config add user 12345\n\n*Keys*\n/config show secrets\n/config add OpenAI key\n\n*Tasks*\n/config show scheduled tasks\n/config create daily briefing at 8am\n\n*System*\n/config health check\n/config export backup\n/config show stats`;
          await this.safeSend(chatId, helpMsg);
          return;
        }
        const configSessionId = await this.getOrCreateConfigSession(chatId);
        try {
          await this.bot!.api.sendChatAction({ chat_id: chatId, action: "typing" });
        } catch {}

        let configSession = this.agentSessions.get(configSessionId);
        if (!configSession) {
          configSession = createSession(configSessionId, process.env.AGENT_ROOT || AGENT_ROOT, 'claude');
          this.agentSessions.set(configSessionId, configSession);
        }

        this.store.addMessage(configSessionId, { role: "user", content: configPrompt });

        if (configSession instanceof AgentSession) {
          const enrichedPrompt = `${CONFIG_BOT_PROMPT}\n\n[Current chat_id: ${chatId}]\n[Current platform: telegram]\n\nUser request: ${configPrompt}`;
          (configSession as AgentSession).sendMessage(enrichedPrompt);

          let fullResponse = "";
          try {
            fullResponse = await handleAgentStream({
              session: configSession as AgentSession,
              sendTyping: async () => { try { await this.bot!.api.sendChatAction({ chat_id: chatId, action: "typing" }); } catch {} },
              sendText: async (text) => { await this.safeSend(chatId, text); },
              maxMsgLen: MAX_MSG_LEN,
            });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            fullResponse = `Error: ${errorMsg}`;
            await this.safeSend(chatId, fullResponse);
            this.agentSessions.delete(configSessionId);
          }

          // Auto-extract memories from config response
          for (const mem of extractMemoryTags(fullResponse)) {
            this.store.setRoleMemory(chatId, mem.key, mem.value);
            console.log(`[Telegram] Saved memory for chat ${chatId}: ${mem.key}`);
          }
          fullResponse = stripMemoryTags(fullResponse);

          if (!fullResponse.trim()) await this.safeSend(chatId, "(no response)");
          if (fullResponse) {
            this.store.addMessage(configSessionId, { role: "assistant", content: fullResponse });
          }
        }
        return;
      }

      // Enqueue message processing to prevent race conditions.
      // Inspired by Claude Code's generation tracking (src/agent.ts).
      const prevLock = this.chatLocks.get(chatId) || Promise.resolve();
      const processPromise = prevLock.then(() => this.processAgentMessage(chatId, text, msg, botUsername, botId));
      this.chatLocks.set(chatId, processPromise.catch(() => {}));
    });

    // Error boundary: a handler error is logged and the update is consumed,
    // so polling never stops on a single failure.
    this.bot.catch((err) => {
      console.error("[Telegram] Bot error:", err instanceof Error ? err.message : String(err));
    });

    // Start the long-poll loop (2.x requires an explicit start; v0.x auto-started).
    this.bot.startPolling().catch((err) => {
      console.error("[Telegram] Polling stopped:", err instanceof Error ? err.message : String(err));
    });

    console.log("[Telegram] Bridge started, polling for messages");
  }

  /**
   * Process an agent message for a chat. Separated from the message handler
   * to enable per-chat sequential queuing (prevents race conditions).
   */
  private async processAgentMessage(
    chatId: string,
    text: string,
    msg: Message,
    botUsername: string,
    botId: number,
  ) {
      // Look up role for this chat
      const role = this.store.getRoleByChatId(chatId) || undefined;

      // Smart reply filter: decide whether to respond in groups
      const isDM = msg.chat.type === 'private';
      const isMention = botUsername ? text.toLowerCase().includes(`@${botUsername.toLowerCase()}`) : false;
      const isReplyToBot = botId ? msg.reply_to_message?.from?.id === botId : false;
      const roleName = role?.name || '';

      const decision = shouldReply({
        text, role: role || null, isMention, isReplyToBot, isDM, botName: roleName,
      });

      if (!decision.shouldReply) {
        return; // Silent: don't respond
      }

      // Strip @mention from text before sending to agent
      if (botUsername && isMention) {
        text = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
      }

      // Build per-chat memory map
      const memories = this.store.listRoleMemories(chatId);
      const chatMemory: Record<string, string> = {};
      for (const m of memories) { chatMemory[m.key] = m.value; }

      // Get or create a DB session for this chat
      const sessionId = await this.getOrCreateSession(chatId);

      // Show typing indicator
      try {
        await this.bot!.api.sendChatAction({ chat_id: chatId, action: "typing" });
      } catch {
        // non-fatal
      }

      // Get or create an in-memory session (respects default_cli setting)
      let agentSession = this.agentSessions.get(sessionId);
      if (!agentSession) {
        const defaultCli = (this.store.getSetting("default_cli") || "claude") as CliType;
        console.log(`[Telegram] Creating session for chat ${chatId} with CLI: ${defaultCli}`);
        agentSession = createSession(sessionId, process.env.AGENT_ROOT || AGENT_ROOT, defaultCli, role, chatMemory);
        this.agentSessions.set(sessionId, agentSession);
      }

      // Store user message in DB
      this.store.addMessage(sessionId, { role: "user", content: text });

      // CliSession (codex/gemini/opencode): one-shot execute
      if (agentSession instanceof CliSession) {
        try {
          await this.bot!.api.sendChatAction({ chat_id: chatId, action: "typing" });
          const output = await agentSession.execute(text);
          const reply = output || "(no response)";
          this.store.addMessage(sessionId, { role: "assistant", content: reply });
          for (const part of splitMessage(reply, MAX_MSG_LEN)) {
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

      // Gather context for background memory extraction
      const recentMsgs = this.store.getMessages(sessionId, 20)
        .map((m: any) => ({ role: m.role, content: m.content || "" }));

      let fullResponse = "";
      try {
        fullResponse = await handleAgentStream({
          session: agentSession as AgentSession,
          sendTyping: async () => { try { await this.bot!.api.sendChatAction({ chat_id: chatId, action: "typing" }); } catch {} },
          sendText: async (text) => { await this.safeSend(chatId, text); },
          maxMsgLen: MAX_MSG_LEN,
          recentMessages: recentMsgs,
          existingMemories: chatMemory,
          onMemoryExtracted: (mems) => {
            for (const m of mems) {
              this.store.setRoleMemory(chatId, m.key, m.value);
              console.log(`[Telegram] Auto-extracted memory for chat ${chatId}: ${m.key}`);
            }
          },
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram] Agent error for chat ${chatId}:`, errorMsg);

        // Auto-recover from context overflow (inspired by Claude Code autoCompact)
        const isContextOverflow = /prompt_too_long|context_length|overloaded/i.test(errorMsg);
        if (isContextOverflow && agentSession instanceof AgentSession) {
          await (agentSession as AgentSession).rotate();
          await this.safeSend(chatId, "[Context full — session refreshed. Please resend your message.]");
        } else {
          fullResponse = `Error: ${errorMsg}`;
          await this.safeSend(chatId, fullResponse);
          this.agentSessions.delete(sessionId);
        }
      }

      // Auto-extract memories from assistant response
      for (const mem of extractMemoryTags(fullResponse)) {
        this.store.setRoleMemory(chatId, mem.key, mem.value);
        console.log(`[Telegram] Saved memory for chat ${chatId}: ${mem.key}`);
      }
      fullResponse = stripMemoryTags(fullResponse);

      if (!fullResponse.trim()) {
        await this.safeSend(chatId, "(no response)");
      }

      if (fullResponse) {
        this.store.addMessage(sessionId, { role: "assistant", content: fullResponse });
      }
  }

  stop() {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }
    this.token = "";
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

    // Reuse existing DB session to avoid duplicates across restarts
    const title = `Telegram:${chatId}`;
    const found = this.store.findSessionByTitle(title);
    const session = found || this.store.createSession(title);
    this.chatToSession.set(chatId, session.id);
    return session.id;
  }

  private async getOrCreateConfigSession(chatId: string): Promise<string> {
    const configKey = `config-${chatId}`;
    const existing = this.chatToSession.get(configKey);
    if (existing) return existing;

    const title = `ConfigBot:${chatId}`;
    const found = this.store.findSessionByTitle(title);
    const session = found || this.store.createSession(title);
    this.chatToSession.set(configKey, session.id);
    return session.id;
  }

  /**
   * Handle media in a Telegram message (photo, document, video, audio, voice).
   * Downloads the file to workspace/media/ and returns context text for the agent.
   */
  private async handleMedia(msg: Message): Promise<string> {
    if (!this.bot) return "";

    const mediaDir = path.join(process.env.AGENT_ROOT || AGENT_ROOT, "workspace", "media");
    fs.mkdirSync(mediaDir, { recursive: true });

    const parts: string[] = [];

    // Photo — get highest resolution
    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1]; // highest res
      const filePath = await this.downloadTelegramFile(photo.file_id, mediaDir, "photo");
      if (filePath) {
        parts.push(`[User sent a photo, saved to: ${filePath}]\nPlease analyze this image using the Read tool.`);
      }
    }

    // Document (PDF, spreadsheet, text file, etc.)
    if (msg.document) {
      const ext = path.extname(msg.document.file_name || "").toLowerCase();
      const filePath = await this.downloadTelegramFile(
        msg.document.file_id, mediaDir, "doc",
        msg.document.file_name
      );
      if (filePath) {
        parts.push(`[User sent a document: ${msg.document.file_name || "file"} (${msg.document.mime_type || "unknown"}), saved to: ${filePath}]\nPlease read and analyze this file.`);
      }
    }

    // Video
    if (msg.video) {
      const filePath = await this.downloadTelegramFile(msg.video.file_id, mediaDir, "video");
      if (filePath) {
        parts.push(`[User sent a video (${msg.video.duration}s), saved to: ${filePath}]\nUse the video-extract skill or ffmpeg to analyze this video.`);
      }
    }

    // Audio
    if (msg.audio) {
      const audioFileName = (msg.audio as any).file_name as string | undefined;
      const filePath = await this.downloadTelegramFile(msg.audio.file_id, mediaDir, "audio", audioFileName);
      if (filePath) {
        parts.push(`[User sent an audio file: ${msg.audio.title || audioFileName || "audio"} (${msg.audio.duration}s), saved to: ${filePath}]\nUse speech-to-text to transcribe if needed.`);
      }
    }

    // Voice message
    if (msg.voice) {
      const filePath = await this.downloadTelegramFile(msg.voice.file_id, mediaDir, "voice");
      if (filePath) {
        parts.push(`[User sent a voice message (${msg.voice.duration}s), saved to: ${filePath}]\nPlease transcribe this using speech-to-text.`);
      }
    }

    // Sticker
    if (msg.sticker && !msg.sticker.is_animated) {
      const filePath = await this.downloadTelegramFile(msg.sticker.file_id, mediaDir, "sticker");
      if (filePath) {
        parts.push(`[User sent a sticker: ${msg.sticker.emoji || ""}, saved to: ${filePath}]`);
      }
    }

    // Caption (text accompanying media)
    if (msg.caption) {
      parts.unshift(msg.caption);
    }

    return parts.join("\n");
  }

  /**
   * Download a file from Telegram and save to the media directory.
   * Returns the local file path, or empty string on failure.
   */
  private async downloadTelegramFile(
    fileId: string,
    mediaDir: string,
    prefix: string,
    originalName?: string
  ): Promise<string> {
    try {
      const fileInfo = await this.bot!.api.getFile({ file_id: fileId });
      if (!fileInfo.file_path) return "";

      const ext = path.extname(fileInfo.file_path) || path.extname(originalName || "") || "";
      const safeName = originalName
        ? originalName.replace(/[^a-z0-9._-]/gi, "-")
        : `${prefix}-${Date.now()}${ext}`;
      const localPath = path.join(mediaDir, safeName);

      const fileUrl = `https://api.telegram.org/file/bot${this.token}/${fileInfo.file_path}`;

      await new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(localPath);
        https.get(fileUrl, (response) => {
          response.pipe(file);
          file.on("finish", () => { file.close(); resolve(); });
        }).on("error", (err) => {
          fs.unlinkSync(localPath);
          reject(err);
        });
      });

      console.log(`[Telegram] Downloaded ${prefix}: ${localPath} (${fs.statSync(localPath).size} bytes)`);
      return localPath;
    } catch (err) {
      console.error(`[Telegram] Failed to download ${prefix}:`, err);
      return "";
    }
  }

  public async safeSend(chatId: string, text: string): Promise<void> {
    try {
      await this.bot!.api.sendMessage({ chat_id: chatId, text });
    } catch (err) {
      console.error(
        `[Telegram] Failed to send message to ${chatId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  public invalidateSession(chatId: string) {
    const sessionId = this.chatToSession.get(chatId);
    if (sessionId) {
      const session = this.agentSessions.get(sessionId);
      if (session instanceof AgentSession) session.interrupt();
      else if (session instanceof CliSession) session.abort();
      this.agentSessions.delete(sessionId);
      this.chatToSession.delete(chatId);
      console.log(`[Telegram] Invalidated session for chat ${chatId}`);
    }
  }
}
