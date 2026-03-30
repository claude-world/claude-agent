import fs from "fs";
import path from "path";
import store from "./db.ts";
import type { Role } from "./db.ts";

/**
 * Parse a Telegram HTML export file and extract messages.
 * Telegram Desktop exports chat history as HTML with a specific structure.
 */
export interface ParsedMessage {
  sender: string;
  date: string;
  time: string;
  text: string;
}

export interface ParseResult {
  chatName: string;
  messageCount: number;
  messages: ParsedMessage[];
  participants: string[];
  dateRange: { from: string; to: string };
}

/**
 * Parse Telegram HTML export into structured messages.
 */
export function parseTelegramExport(htmlPath: string): ParseResult {
  const html = fs.readFileSync(htmlPath, "utf-8");

  // Extract chat name
  const chatNameMatch = html.match(
    /<div class="text bold">\s*([\s\S]*?)\s*<\/div>/
  );
  const chatName = chatNameMatch
    ? chatNameMatch[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim()
    : "Unknown Chat";

  const messages: ParsedMessage[] = [];
  const participantSet = new Set<string>();

  // Match message blocks: <div class="message default clearfix" ...>
  // Each message has: from_name, date (in title attr), text
  const msgPattern =
    /<div class="message default[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;

  // More robust: parse line by line tracking state
  let currentSender = "";
  let currentDate = "";
  let currentTime = "";
  let currentText = "";
  let inMessage = false;
  let inText = false;
  let textDepth = 0;

  const lines = html.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect message start
    if (line.includes('class="message default')) {
      if (inMessage && currentText.trim()) {
        messages.push({
          sender: currentSender,
          date: currentDate,
          time: currentTime,
          text: currentText.trim(),
        });
        if (currentSender) participantSet.add(currentSender);
      }
      inMessage = true;
      currentText = "";
      inText = false;
    }

    // Extract sender
    if (inMessage && line.includes('class="from_name"')) {
      const nextLine = lines[i + 1]?.trim() || "";
      currentSender = nextLine
        .replace(/<[^>]+>/g, "")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&laquo;/g, "«")
        .replace(/&raquo;/g, "»")
        .trim();
    }

    // Extract date/time from title attribute
    if (inMessage && line.includes('class="pull_right date details"')) {
      const titleMatch = line.match(/title="([^"]+)"/);
      if (titleMatch) {
        const parts = titleMatch[1].split(" ");
        currentDate = parts[0] || "";
        currentTime = parts[1]?.split(" ")[0] || "";
      }
    }

    // Extract text content
    if (inMessage && line.includes('class="text"')) {
      inText = true;
      textDepth = 0;
      // Check if text is on the same line
      const inlineText = line
        .replace(/<[^>]+>/g, "")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .trim();
      if (inlineText) currentText = inlineText;
      continue;
    }

    if (inText) {
      if (line.includes("</div>")) {
        inText = false;
      } else {
        const cleaned = line
          .replace(/<[^>]+>/g, "")
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ")
          .trim();
        if (cleaned) {
          currentText += (currentText ? "\n" : "") + cleaned;
        }
      }
    }
  }

  // Flush last message
  if (inMessage && currentText.trim()) {
    messages.push({
      sender: currentSender,
      date: currentDate,
      time: currentTime,
      text: currentText.trim(),
    });
    if (currentSender) participantSet.add(currentSender);
  }

  const participants = Array.from(participantSet);
  const dates = messages.map((m) => m.date).filter(Boolean);
  const dateRange = {
    from: dates[0] || "",
    to: dates[dates.length - 1] || "",
  };

  return {
    chatName,
    messageCount: messages.length,
    messages,
    participants,
    dateRange,
  };
}

/**
 * Summarize parsed messages into a knowledge context suitable for role injection.
 * Groups by topic/date and creates a structured summary.
 */
export function summarizeHistory(result: ParseResult, maxLength = 8000): string {
  const parts: string[] = [];

  parts.push(`# Chat History: ${result.chatName}`);
  parts.push(
    `Period: ${result.dateRange.from} — ${result.dateRange.to} (${result.messageCount} messages)`
  );
  parts.push(`Participants: ${result.participants.join(", ")}`);
  parts.push("");

  // Group messages by date
  const byDate = new Map<string, ParsedMessage[]>();
  for (const msg of result.messages) {
    const date = msg.date || "unknown";
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(msg);
  }

  // Build daily summaries
  parts.push("## Conversation Log");
  parts.push("");

  let totalLen = parts.join("\n").length;

  for (const [date, msgs] of byDate) {
    const dayBlock: string[] = [`### ${date}`];
    for (const msg of msgs) {
      const line = `- **${msg.sender}** (${msg.time}): ${msg.text.slice(0, 200)}`;
      dayBlock.push(line);
    }
    dayBlock.push("");

    const blockText = dayBlock.join("\n");
    if (totalLen + blockText.length > maxLength) {
      parts.push(
        `\n... (truncated, ${result.messageCount - parts.length} more messages)`
      );
      break;
    }
    parts.push(blockText);
    totalLen += blockText.length;
  }

  return parts.join("\n");
}

/**
 * Import Telegram chat history into a role's knowledge context.
 * If roleId is provided, appends to that role's knowledge_context.
 * If chatId is provided, stores as per-chat memories.
 */
export function importHistoryToRole(
  htmlPath: string,
  roleId?: string,
  chatId?: string
): { summary: string; messageCount: number; chatName: string } {
  const result = parseTelegramExport(htmlPath);
  const summary = summarizeHistory(result);

  if (roleId) {
    const role = store.getRole(roleId);
    if (role) {
      const existing = role.knowledge_context || "";
      const updated = existing
        ? `${existing}\n\n---\n\n${summary}`
        : summary;
      store.updateRole(roleId, { knowledge_context: updated });
    }
  }

  if (chatId) {
    // Store key facts as per-chat memories
    store.setRoleMemory(chatId, "chat_history_imported", "true");
    store.setRoleMemory(chatId, "chat_name", result.chatName);
    store.setRoleMemory(
      chatId,
      "participants",
      result.participants.join(", ")
    );
    store.setRoleMemory(
      chatId,
      "history_period",
      `${result.dateRange.from} — ${result.dateRange.to}`
    );
    store.setRoleMemory(
      chatId,
      "message_count",
      String(result.messageCount)
    );

    // Store the full summary as a special memory key
    store.setRoleMemory(chatId, "chat_history_summary", summary.slice(0, 10000));
  }

  return {
    summary,
    messageCount: result.messageCount,
    chatName: result.chatName,
  };
}
