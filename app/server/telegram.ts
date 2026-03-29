import TelegramBot from "node-telegram-bot-api";
import { AgentSession, CliSession, createSession, CONFIG_BOT_PROMPT, type CliType } from "./agent.ts";
import type { store as StoreType, Role } from "./db.ts";
import { AGENT_ROOT } from "./paths.ts";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";

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
   *                      If empty or not provided, all users are blocked until admin adds them.
   */
  start(token: string, allowedUsers?: string[]) {
    if (this.bot) {
      console.warn("[Telegram] Bridge already started");
      return;
    }

    this.bot = new TelegramBot(token, { polling: true });

    this.bot.on("message", async (msg) => {
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
          await this.bot!.sendChatAction(chatId, "typing");
        } catch {}

        let configSession = this.agentSessions.get(configSessionId);
        if (!configSession) {
          configSession = createSession(configSessionId, AGENT_ROOT, 'claude');
          this.agentSessions.set(configSessionId, configSession);
        }

        this.store.addMessage(configSessionId, { role: "user", content: configPrompt });

        if (configSession instanceof AgentSession) {
          const enrichedPrompt = `${CONFIG_BOT_PROMPT}\n\n[Current chat_id: ${chatId}]\n[Current platform: telegram]\n\nUser request: ${configPrompt}`;
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
            fullResponse = pendingText; // Mark that we have content to prevent "(no response)"
            this.agentSessions.delete(configSessionId);
          } finally {
            if (typingInterval) clearInterval(typingInterval);
          }

          await flushPending();

          // Auto-extract memories from config response
          const configMemPattern = /\[SAVE_MEMORY\]\s*([\w_-]+):\s*(.+)/g;
          let configMemMatch;
          while ((configMemMatch = configMemPattern.exec(fullResponse)) !== null) {
            this.store.setRoleMemory(chatId, configMemMatch[1], configMemMatch[2].trim());
            console.log(`[Telegram] Saved memory for chat ${chatId}: ${configMemMatch[1]}`);
          }
          fullResponse = fullResponse.replace(/\[SAVE_MEMORY\]\s*[\w_-]+:\s*.+/g, '').trim();

          if (!fullResponse.trim()) await this.safeSend(chatId, "(no response)");
          if (fullResponse) {
            this.store.addMessage(configSessionId, { role: "assistant", content: fullResponse });
          }
        }
        return;
      }

      // Look up role for this chat
      const role = this.store.getRoleByChatId(chatId) || undefined;

      // Build per-chat memory map
      const memories = this.store.listRoleMemories(chatId);
      const chatMemory: Record<string, string> = {};
      for (const m of memories) { chatMemory[m.key] = m.value; }

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
        agentSession = createSession(sessionId, AGENT_ROOT, defaultCli, role, chatMemory);
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
        fullResponse = pendingText; // Mark that we have content to prevent "(no response)"
        this.agentSessions.delete(sessionId);
      } finally {
        if (typingInterval) clearInterval(typingInterval);
      }

      // Flush any remaining text
      await flushPending();

      // Auto-extract memories from assistant response
      const memoryPattern = /\[SAVE_MEMORY\]\s*([\w_-]+):\s*(.+)/g;
      let memMatch;
      while ((memMatch = memoryPattern.exec(fullResponse)) !== null) {
        this.store.setRoleMemory(chatId, memMatch[1], memMatch[2].trim());
        console.log(`[Telegram] Saved memory for chat ${chatId}: ${memMatch[1]}`);
      }
      // Strip memory tags from the displayed response
      fullResponse = fullResponse.replace(/\[SAVE_MEMORY\]\s*[\w_-]+:\s*.+/g, '').trim();

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

  /**
   * Handle media in a Telegram message (photo, document, video, audio, voice).
   * Downloads the file to workspace/media/ and returns context text for the agent.
   */
  private async handleMedia(msg: TelegramBot.Message): Promise<string> {
    if (!this.bot) return "";

    const mediaDir = path.join(AGENT_ROOT, "workspace", "media");
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
      const filePath = await this.downloadTelegramFile(msg.audio.file_id, mediaDir, "audio",
        msg.audio.file_name);
      if (filePath) {
        parts.push(`[User sent an audio file: ${msg.audio.title || msg.audio.file_name || "audio"} (${msg.audio.duration}s), saved to: ${filePath}]\nUse speech-to-text to transcribe if needed.`);
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
      const fileInfo = await this.bot!.getFile(fileId);
      if (!fileInfo.file_path) return "";

      const ext = path.extname(fileInfo.file_path) || path.extname(originalName || "") || "";
      const safeName = originalName
        ? originalName.replace(/[^a-z0-9._-]/gi, "-")
        : `${prefix}-${Date.now()}${ext}`;
      const localPath = path.join(mediaDir, safeName);

      const fileUrl = `https://api.telegram.org/file/bot${this.bot!.token}/${fileInfo.file_path}`;

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
      await this.bot!.sendMessage(chatId, text);
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
