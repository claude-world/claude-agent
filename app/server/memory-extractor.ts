/**
 * Automatic memory extraction from conversation history.
 *
 * Ported from Claude Code's services/extractMemories/:
 * - Non-blocking spawn (not spawnSync) to avoid blocking the event loop
 * - 4-type memory taxonomy (user/feedback/project/reference)
 * - Strict "what NOT to save" guidelines to prevent memory bloat
 * - 15-second timeout with graceful cleanup
 *
 * Complements the inline [SAVE_MEMORY] tag system — both work together.
 */

import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";

const EXTRACTION_INTERVAL = 5; // Extract every 5 turns

// Ported from Claude Code's extractMemories/prompts.ts — 4-type taxonomy
const EXTRACTION_PROMPT = `You are a memory extraction subagent. Analyze the recent conversation and extract facts worth remembering for future conversations.

## Memory Types (only save what's genuinely useful)

- **user**: Who the user is — role, preferences, knowledge level, communication style
  Example: [SAVE_MEMORY:user] role: senior backend engineer, new to React
- **feedback**: Corrections or confirmed approaches — what to do/not do
  Example: [SAVE_MEMORY:feedback] testing: use real DB, not mocks (burned by mock/prod divergence)
- **project**: Ongoing work, decisions, deadlines — context behind the work
  Example: [SAVE_MEMORY:project] auth_rewrite: driven by compliance, deadline Friday
- **reference**: Where to find info in external systems
  Example: [SAVE_MEMORY:reference] bugs: tracked in Linear project "INGEST"

## What NOT to Save
- Code patterns or architecture (derivable from reading the code)
- Git history or recent changes (use git log)
- Debugging solutions (the fix is in the code)
- Ephemeral task details or temporary state
- Anything already in existing memories (don't duplicate)

## Output Format
One per line: [SAVE_MEMORY:type] key: value
Keys: lowercase with underscores. Values: concise, under 100 chars.
If nothing new to remember: (no new memories)
Maximum 5 memories per extraction.`;

export function shouldExtractMemories(turnCount: number): boolean {
  return turnCount > 0 && turnCount % EXTRACTION_INTERVAL === 0;
}

function resolveClaudePath(): string {
  try {
    return execSync("/bin/zsh -lc 'which claude'", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    const candidates = [
      path.join(process.env.HOME || "", ".npm-global/bin/claude"),
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return "claude";
  }
}

/**
 * Parse memory tags from extraction output.
 * Supports both [SAVE_MEMORY] and [SAVE_MEMORY:type] formats.
 */
function parseMemoryTags(output: string): Array<{ key: string; value: string; type?: string }> {
  const memories: Array<{ key: string; value: string; type?: string }> = [];
  const re = /\[SAVE_MEMORY(?::(\w+))?\]\s*([\w_-]+):\s*(.+)/g;
  let match;
  while ((match = re.exec(output)) !== null) {
    memories.push({
      type: match[1] || undefined,
      key: match[2],
      value: match[3].trim(),
    });
  }
  return memories;
}

/**
 * Extract memories from recent conversation history.
 * Non-blocking: uses spawn (not spawnSync) so the event loop stays free.
 * 15-second timeout with graceful cleanup.
 */
export async function extractMemoriesFromHistory(
  recentMessages: Array<{ role: string; content: string }>,
  existingMemories: Record<string, string>,
): Promise<Array<{ key: string; value: string }>> {
  const memoryContext = Object.entries(existingMemories)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n") || "(no existing memories)";

  const conversationContext = recentMessages
    .slice(-20)
    .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
    .join("\n");

  const fullPrompt = `${EXTRACTION_PROMPT}

## Existing Memories
${memoryContext}

## Recent Conversation
${conversationContext}`;

  try {
    const claudePath = resolveClaudePath();

    // Inject stored secrets so the subprocess can authenticate (e.g. ANTHROPIC_API_KEY)
    const secretEnv: Record<string, string> = {};
    try {
      const { default: store } = await import("./db.ts");
      const RESERVED_ENV = new Set(["HOME", "PATH", "NODE_OPTIONS", "ZDOTDIR", "SHELL", "USER", "LANG", "TERM"]);
      for (const s of store.listSecretsRaw()) {
        if (!RESERVED_ENV.has(s.name) && !s.name.includes("\0")) {
          secretEnv[s.name] = s.value;
        }
      }
    } catch {}

    return new Promise((resolve) => {
      const child = spawn(claudePath, [
        "-p", fullPrompt,
        "--model", "haiku",
        "--output-format", "text",
        "--max-turns", "1",
      ], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...secretEnv },
      });

      let stdout = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", () => {}); // drain stderr silently

      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        console.warn("[MemoryExtractor] Timed out after 15s");
        resolve([]);
      }, 15000);

      child.on("close", () => {
        clearTimeout(timeout);
        resolve(parseMemoryTags(stdout));
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        console.error("[MemoryExtractor] Spawn error:", err.message);
        resolve([]);
      });
    });
  } catch (err) {
    console.error("[MemoryExtractor] Extraction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
