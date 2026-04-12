/**
 * Compact (summary) prompt for session rotation.
 *
 * Ported from Claude Code src/services/compact/prompt.ts.
 * When a session is about to rotate (context full), this prompt is sent
 * to generate a structured summary that carries over to the new session.
 */

export const COMPACT_PROMPT = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
Tool calls will be REJECTED. Your entire response must be plain text.

Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary will be injected into a fresh session so the conversation can continue without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags:

1. Chronologically analyze each exchange. For each, identify:
   - The user's explicit requests and intents
   - Your approach to addressing them
   - Key decisions and outcomes
   - Errors encountered and how they were fixed
   - Specific user feedback (especially corrections)
2. Double-check for completeness.

Your summary should include these sections:

<summary>
1. Primary Request and Intent:
   [What the user wants — capture ALL explicit requests]

2. Key Topics and Concepts:
   [Important topics, technologies, people, or concepts discussed]

3. Decisions Made:
   [Key decisions, preferences expressed, approaches chosen]

4. Errors and Corrections:
   [Mistakes made, user corrections, lessons learned]

5. All User Messages:
   [List ALL user messages — critical for understanding changing intent]

6. Pending Tasks:
   [Tasks explicitly asked for but not yet completed]

7. Current Work:
   [What was being worked on immediately before this summary]

8. Conversation Memory:
   [Facts about the user worth remembering: preferences, name, role, habits]

9. Optional Next Step:
   [Only if directly in line with the user's most recent request]
</summary>

Provide your summary now. Be thorough — this is the ONLY context the next session will have.`;

/**
 * Format raw compact output: strip <analysis> block, extract <summary> content.
 * Ported from Claude Code's formatCompactSummary().
 */
export function formatCompactSummary(raw: string): string | null {
  let result = raw;

  // Strip analysis section (drafting scratchpad, no informational value)
  result = result.replace(/<analysis>[\s\S]*?<\/analysis>/i, "");

  // Extract summary content — require the <summary> tag for quality assurance.
  // If the model didn't follow the format, return null rather than injecting garbage.
  const summaryMatch = result.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch) {
    result = summaryMatch[1].trim();
  } else {
    // No <summary> tag — only use raw if it's short and looks summary-like
    result = result.trim();
    if (result.length > 500) return null; // too large to be a clean summary
  }

  result = result.replace(/\n{3,}/g, "\n\n").trim();
  return result || null;
}
