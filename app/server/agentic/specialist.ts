/**
 * Specialist execution — runs a single AI specialist role.
 * Each specialist is a fresh AgentSession with a role-specific system prompt.
 */

import { AgentSession } from "../agent.ts";
import type { SpecialistType } from "../executors/types.ts";
import { randomUUID } from "crypto";
import { AGENT_ROOT } from "../paths.ts";

export interface SpecialistResult {
  stepId: string;
  stepIndex?: number;
  specialistType: SpecialistType;
  output: string;
  costUsd: number | null;
  durationMs: number;
  error?: string;
}

const SPECIALIST_PROMPTS: Record<SpecialistType, string> = {
  researcher: `You are a Research Specialist. Your role is to gather, analyze, and synthesize information.
- Search for relevant information comprehensively
- Cite sources when available
- Present findings in a structured, clear format
- Distinguish between facts and opinions
- Focus on accuracy and completeness`,

  writer: `You are a Writing Specialist. Your role is to create clear, engaging written content.
- Transform research and information into polished prose
- Adapt tone and style to the audience
- Structure content logically with clear flow
- Use concrete examples and evidence
- Produce publication-ready content`,

  analyst: `You are an Analysis Specialist. Your role is to evaluate, assess, and derive insights.
- Apply systematic analytical frameworks
- Identify patterns, trends, and anomalies
- Weigh trade-offs and considerations
- Provide evidence-based recommendations
- Quantify and qualify findings where possible`,

  executor: `You are an Execution Specialist. Your role is to implement solutions and complete tasks.
- Break down tasks into concrete action steps
- Write code, scripts, or configurations as needed
- Test and validate your work
- Document what you've done and why
- Focus on working, deliverable results`,

  critic: `You are a Critical Review Specialist. Your role is to identify issues and improve quality.
- Examine work objectively and rigorously
- Identify logical flaws, gaps, and weaknesses
- Suggest specific, actionable improvements
- Balance criticism with constructive guidance
- Check for completeness, accuracy, and clarity`,
};

/**
 * Execute a specialist on a given input.
 * Returns full output text and metadata.
 */
export async function executeSpecialist(
  type: SpecialistType,
  input: string,
  onStream?: (text: string) => void,
): Promise<SpecialistResult> {
  const stepId = randomUUID();
  const start = Date.now();
  const sessionId = `specialist-${stepId}`;
  const cwd = process.env.AGENT_ROOT || AGENT_ROOT;

  const systemPrompt = SPECIALIST_PROMPTS[type] || SPECIALIST_PROMPTS.researcher;

  // Create a temporary session that uses the specialist's system prompt
  // We pass null as role and inject system context via the prompt prefix
  const session = new AgentSession(sessionId, cwd);

  // Prepend specialist identity to the user message
  const enrichedInput = `<specialist-context>
Role: ${type.charAt(0).toUpperCase() + type.slice(1)} Specialist
Instructions: ${systemPrompt}
</specialist-context>

${input}`;

  session.sendMessage(enrichedInput);

  let fullOutput = "";
  let costUsd: number | null = null;
  let error: string | undefined;

  try {
    for await (const msg of session.getOutputStream()) {
      if (msg.type === "assistant") {
        const content = msg.message?.content;
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          text = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        }
        if (text) {
          fullOutput += text;
          onStream?.(text);
        }
      } else if (msg.type === "result") {
        costUsd = msg.total_cost_usd ?? null;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    session.interrupt();
  }

  return {
    stepId,
    specialistType: type,
    output: fullOutput || error || "",
    costUsd,
    durationMs: Date.now() - start,
    error,
  };
}
