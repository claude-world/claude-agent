import type { Role } from "./db.ts";

export interface ReplyDecision {
  shouldReply: boolean;
  reason: string;
}

/**
 * Decide whether the bot should reply to a message.
 * Called by Telegram and Discord bridges before processing.
 */
export function shouldReply(opts: {
  text: string;
  role: Role | null;
  isMention: boolean;
  isReplyToBot: boolean;
  isDM: boolean;
  botName: string;
}): ReplyDecision {
  const { text, role, isMention, isReplyToBot, isDM, botName } = opts;

  // DMs always get a reply regardless of mode
  if (isDM) return { shouldReply: true, reason: "dm" };

  // Commands always get processed
  if (text.startsWith("/")) return { shouldReply: true, reason: "command" };

  // Determine reply mode (default: 'mention' for groups without a role)
  const mode = role?.reply_mode || "mention";

  switch (mode) {
    case "always":
      return { shouldReply: true, reason: "always mode" };

    case "never":
      return { shouldReply: false, reason: "silent mode" };

    case "mention":
      if (isMention) return { shouldReply: true, reason: "mentioned" };
      if (isReplyToBot) return { shouldReply: true, reason: "reply to bot" };
      if (botName && text.toLowerCase().includes(botName.toLowerCase())) {
        return { shouldReply: true, reason: "name mentioned" };
      }
      return { shouldReply: false, reason: "not mentioned" };

    case "keywords": {
      const keywords = role?.reply_keywords || [];
      if (isMention || isReplyToBot) return { shouldReply: true, reason: "mentioned" };
      const lower = text.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw.toLowerCase())) {
          return { shouldReply: true, reason: `keyword: ${kw}` };
        }
      }
      return { shouldReply: false, reason: "no keyword match" };
    }

    case "smart":
    default: {
      // Direct engagement: always reply
      if (isMention) return { shouldReply: true, reason: "mentioned" };
      if (isReplyToBot) return { shouldReply: true, reason: "reply to bot" };
      if (botName && text.toLowerCase().includes(botName.toLowerCase())) {
        return { shouldReply: true, reason: "name mentioned" };
      }

      // Questions directed at nobody specific — likely wanting bot input
      if (/[?？]\s*$/.test(text)) return { shouldReply: true, reason: "question" };
      if (/嗎[？\s]*$|呢[？\s]*$|吗[？\s]*$/.test(text)) {
        return { shouldReply: true, reason: "question (zh)" };
      }

      // Help/request patterns
      if (/^(help|幫|请|請|拜託|お願い)/i.test(text)) {
        return { shouldReply: true, reason: "help request" };
      }

      // Too short / emoji only — skip
      if (text.length < 4) return { shouldReply: false, reason: "too short" };
      if (/^[\p{Emoji}\s]+$/u.test(text)) return { shouldReply: false, reason: "emoji only" };

      // Default in group: don't reply (let humans talk)
      return { shouldReply: false, reason: "no trigger" };
    }
  }
}
