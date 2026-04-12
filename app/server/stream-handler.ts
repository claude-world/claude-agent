/**
 * Shared streaming response handler for all channel bridges.
 *
 * Inspired by Claude Code's streaming architecture (src/services/api/),
 * this module extracts the duplicated streaming/flush/memory logic from
 * telegram.ts and discord.ts into a single reusable handler.
 */

import { AgentSession } from "./agent.ts";
import { shouldExtractMemories, extractMemoriesFromHistory } from "./memory-extractor.ts";
import { hybridMemory } from "./memory/hybrid-store.ts";

// ── Message splitting ───────────────────────────────────────────────

export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    parts.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return parts;
}

// ── Memory extraction from response text ────────────────────────────

// Matches both [SAVE_MEMORY] and [SAVE_MEMORY:type] formats
const MEMORY_PATTERN = /\[SAVE_MEMORY(?::\w+)?\]\s*([\w_-]+):\s*(.+)/g;

export function extractMemoryTags(text: string): Array<{ key: string; value: string }> {
  const memories: Array<{ key: string; value: string }> = [];
  let match;
  // Reset lastIndex since we reuse the regex
  const re = new RegExp(MEMORY_PATTERN.source, MEMORY_PATTERN.flags);
  while ((match = re.exec(text)) !== null) {
    memories.push({ key: match[1], value: match[2].trim() });
  }
  return memories;
}

export function stripMemoryTags(text: string): string {
  return text.replace(/\[SAVE_MEMORY(?::\w+)?\]\s*[\w_-]+:\s*.+/g, "").trim();
}

// ── Extract text from SDK message content ───────────────────────────

export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    let text = "";
    for (const block of content) {
      if (block.type === "text" && block.text) text += block.text;
    }
    return text;
  }
  return "";
}

// ── Streaming response handler ──────────────────────────────────────

export interface StreamHandlerOptions {
  session: AgentSession;
  /** Send typing indicator (platform-specific) */
  sendTyping: () => Promise<void>;
  /** Send a text message chunk (already split to platform max length) */
  sendText: (text: string) => Promise<void>;
  /** Max message length for the platform (Telegram: 4000, Discord: 1900) */
  maxMsgLen: number;
  /** Minimum ms between flushes (default: 2000) */
  flushIntervalMs?: number;
  /** Typing indicator interval (default: 3000) */
  typingIntervalMs?: number;
  /** Callback to save extracted memories (for background auto-extraction) */
  onMemoryExtracted?: (memories: Array<{ key: string; value: string }>) => void;
  /** Recent messages for background memory extraction context */
  recentMessages?: Array<{ role: string; content: string }>;
  /** Existing chat memories for extraction deduplication */
  existingMemories?: Record<string, string>;
  /** Chat/session ID used to persist extracted memories to hybridMemory */
  chatId?: string;
}

/**
 * Handle streaming output from an AgentSession.
 * Accumulates text, flushes periodically, and returns the full response.
 *
 * Pattern inspired by Claude Code's streaming in src/services/api/claude.ts
 * and the flush/batching logic in src/ink/output.ts.
 */
export async function handleAgentStream(opts: StreamHandlerOptions): Promise<string> {
  const {
    session,
    sendTyping,
    sendText,
    maxMsgLen,
    flushIntervalMs = 2000,
    typingIntervalMs = 3000,
  } = opts;

  let fullResponse = "";
  let pendingText = "";
  let lastSendTime = 0;
  let typingInterval: ReturnType<typeof setInterval> | null = null;

  const flushPending = async () => {
    if (!pendingText.trim()) return;
    // Strip memory tags BEFORE sending to user (tags are still in fullResponse for extraction)
    let toSend = pendingText.trim();
    toSend = toSend.replace(/\[SAVE_MEMORY(?::\w+)?\]\s*[\w_-]+:\s*.+/g, "").trim();
    pendingText = "";
    if (!toSend) return; // nothing left after stripping
    for (const part of splitMessage(toSend, maxMsgLen)) {
      await sendText(part);
    }
    lastSendTime = Date.now();
  };

  try {
    typingInterval = setInterval(async () => {
      try { await sendTyping(); } catch {}
      if (pendingText.trim() && Date.now() - lastSendTime > flushIntervalMs) {
        await flushPending();
      }
    }, typingIntervalMs);

    for await (const sdkMsg of session.getOutputStream()) {
      if (sdkMsg.type === "assistant") {
        const newText = extractTextFromContent(sdkMsg.message?.content);
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
  } finally {
    if (typingInterval) clearInterval(typingInterval);
  }

  await flushPending();

  // Track turns for session lifecycle management
  session.incrementTurn();

  // Background memory extraction (inspired by Claude Code's extractMemories)
  // Runs every N turns, async — doesn't block the response
  if (opts.onMemoryExtracted && shouldExtractMemories(session.turnCount)) {
    const messages = opts.recentMessages || [];
    const existing = opts.existingMemories || {};
    const chatId = opts.chatId;
    extractMemoriesFromHistory(messages, existing)
      .then((mems) => {
        if (mems.length > 0) {
          opts.onMemoryExtracted?.(mems);
          // Persist to hybridMemory (SQLite + LanceDB vector store) so
          // extracted memories survive beyond the in-process callback.
          if (chatId) {
            for (const mem of mems) {
              hybridMemory.setMemory(chatId, mem.key, mem.value, 'general', 'extracted')
                .catch(err => console.error("[StreamHandler] hybridMemory write failed:", err));
            }
          }
        }
      })
      .catch((err) => {
        console.error("[StreamHandler] Background memory extraction failed:", err);
      });
  }

  // Auto-rotate if context is getting full (inspired by Claude Code's autoCompact)
  if (session.shouldRotate) {
    const turns = session.turnCount;
    await session.rotate(); // generates compact summary for carry-over
    await sendText(`[Session refreshed after ${turns} turns — context preserved via summary]`);
  }

  return fullResponse;
}
