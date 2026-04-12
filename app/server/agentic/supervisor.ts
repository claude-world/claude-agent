/**
 * Supervisor — generates structured execution plans for agentic tasks.
 * Uses Claude to analyze a goal and produce a JSON plan with specialist assignments.
 */

import { AgentSession } from "../agent.ts";
import type { SpecialistType, ExecutionMode } from "../executors/types.ts";
import { AGENT_ROOT } from "../paths.ts";
import { randomUUID } from "crypto";

export interface PlanStep {
  index: number;
  specialistType: SpecialistType;
  input: string;
  dependsOn: number[];       // indices of steps this depends on
  parallelWith: number[];    // indices that can run concurrently
}

export interface SupervisorPlan {
  mode: ExecutionMode;
  steps: PlanStep[];
  rationale: string;
}

const SUPERVISOR_PROMPT = `You are a Task Supervisor AI. Analyze the user's goal and create an execution plan.

Available specialist types:
- researcher: Gathers information, searches, synthesizes findings
- writer: Creates written content, reports, documentation
- analyst: Analyzes data, evaluates options, derives insights
- executor: Implements solutions, writes code, completes technical tasks
- critic: Reviews work, identifies issues, suggests improvements

Create a JSON execution plan. Format:
{
  "mode": "parallel" | "sequential" | "swarm" | "auto",
  "rationale": "Brief explanation of the approach",
  "steps": [
    {
      "index": 0,
      "specialistType": "researcher",
      "input": "Specific instruction for this specialist",
      "dependsOn": [],
      "parallelWith": [1]
    }
  ]
}

Rules:
- Use "parallel" mode when steps are independent and can run simultaneously
- Use "sequential" when each step builds on the previous
- Use "swarm" when the same specialist type should tackle different parts of the same problem
- "dependsOn": list indices of steps that must complete before this one
- "parallelWith": list indices of steps that can run at the same time
- Keep plans focused (2-5 steps ideal)
- Make step inputs specific and actionable

ONLY output valid JSON, no markdown, no explanation outside the JSON.`;

/**
 * Generate an execution plan for a goal.
 */
export async function generatePlan(goal: string): Promise<SupervisorPlan> {
  const sessionId = `supervisor-${randomUUID()}`;
  const cwd = process.env.AGENT_ROOT || AGENT_ROOT;
  const session = new AgentSession(sessionId, cwd);

  const safeGoal = goal.replace(/<\//g, '< /').slice(0, 2000);
  const prompt = `${SUPERVISOR_PROMPT}\n\n<goal>${safeGoal}</goal>`;
  session.sendMessage(prompt);

  let rawOutput = "";
  try {
    for await (const msg of session.getOutputStream()) {
      if (msg.type === "assistant") {
        const content = msg.message?.content;
        if (typeof content === "string") rawOutput += content;
        else if (Array.isArray(content)) {
          rawOutput += content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        }
      }
    }
  } finally {
    session.interrupt();
  }

  return parsePlan(rawOutput, goal);
}

/**
 * Extract the first balanced JSON object from text.
 * String-aware: ignores { } inside string literals (handles escaped chars too).
 */
function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { if (--depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/**
 * Parse and validate the LLM-generated plan JSON.
 * Returns a safe default plan on any error.
 */
function parsePlan(raw: string, goal: string): SupervisorPlan {
  // Extract JSON from the output (may have surrounding text)
  const jsonMatch = extractJson(raw);
  if (!jsonMatch) return defaultPlan(goal);

  try {
    const parsed = JSON.parse(jsonMatch);

    const validModes: ExecutionMode[] = ["auto", "parallel", "sequential", "swarm"];
    const validSpecialists: SpecialistType[] = ["researcher", "writer", "analyst", "executor", "critic"];

    const mode: ExecutionMode = validModes.includes(parsed.mode) ? parsed.mode : "sequential";
    const steps: PlanStep[] = (parsed.steps || [])
      .filter((s: any) => validSpecialists.includes(s.specialistType))
      .map((s: any, idx: number) => ({
        index: typeof s.index === "number" ? s.index : idx,
        specialistType: s.specialistType as SpecialistType,
        input: String(s.input || goal),
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.filter((n: any) => typeof n === "number") : [],
        parallelWith: Array.isArray(s.parallelWith) ? s.parallelWith.filter((n: any) => typeof n === "number") : [],
      }));

    if (steps.length === 0) return defaultPlan(goal);

    return {
      mode,
      steps,
      rationale: String(parsed.rationale || "AI-generated plan"),
    };
  } catch {
    return defaultPlan(goal);
  }
}

function defaultPlan(goal: string): SupervisorPlan {
  return {
    mode: "sequential",
    rationale: "Default fallback plan: research then synthesize",
    steps: [
      {
        index: 0,
        specialistType: "researcher",
        input: `Research and gather information about: ${goal}`,
        dependsOn: [],
        parallelWith: [],
      },
      {
        index: 1,
        specialistType: "writer",
        input: `Based on the research above, create a comprehensive report about: ${goal}`,
        dependsOn: [0],
        parallelWith: [],
      },
    ],
  };
}
