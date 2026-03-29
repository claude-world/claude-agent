import { AgentSession, CliSession } from "./agent.ts";
import type { CliType } from "./agent.ts";
import store from "./db.ts";
import type { Expert } from "./db.ts";
import path from "path";
import fs from "fs";
import { AGENT_ROOT } from "./paths.ts";

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface DiscussionEvent {
  type: "expert_message" | "round_start" | "round_end" | "conclusion" | "error";
  expert?: string;
  cli?: string;
  content?: string;
  round?: number;
}

export type EventCallback = (event: DiscussionEvent) => void;

// -------------------------------------------------------------------
// Timeout helper
// -------------------------------------------------------------------

const EXPERT_TIMEOUT_MS = 120_000; // 2 minutes per expert

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// -------------------------------------------------------------------
// Expert generation
// -------------------------------------------------------------------

export async function generateExperts(topic: string): Promise<Expert[]> {
  const session = new AgentSession(`expert-gen-${Date.now()}`, AGENT_ROOT);

  const lang = store.getSetting("language") || "en";
  const prompt = `Analyze this discussion topic and suggest 3 expert roles.
Topic: "${topic}"

Return ONLY a JSON array (no markdown, no explanation) with this format:
[
  {"name": "Expert Name", "role": "Brief role description", "cli": "claude", "systemPrompt": "You are a [role]. Your expertise includes..."}
]

Rules:
- 3 experts with diverse but complementary perspectives
- Each expert should have a unique viewpoint on the topic
- systemPrompt should be 2-3 sentences defining their expertise
- cli should be "claude" for all (user can change later)
- Use language: ${lang}`;

  session.sendMessage(prompt);

  let result = "";
  try {
    for await (const msg of session.getOutputStream()) {
      if (msg.type === "assistant") {
        const content = msg.message?.content;
        if (typeof content === "string") result += content;
        else if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === "text" && b.text) result += b.text;
          }
        }
      } else if (msg.type === "result") break;
    }
  } catch {
    // ignore stream errors — we'll fall through to fallback
  } finally {
    session.interrupt();
  }

  // Parse JSON array from result (tolerate surrounding text)
  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as Expert[];
    } catch {
      // fall through to fallback
    }
  }

  // Fallback experts
  return [
    {
      name: "Analyst",
      role: "Strategic analysis",
      cli: "claude",
      systemPrompt: `You are a strategic analyst. Analyze "${topic}" from a high-level perspective, focusing on goals, risks, and opportunities.`,
    },
    {
      name: "Specialist",
      role: "Domain expert",
      cli: "claude",
      systemPrompt: `You are a domain specialist for "${topic}". Provide detailed technical insights and concrete implementation approaches.`,
    },
    {
      name: "Critic",
      role: "Quality reviewer",
      cli: "claude",
      systemPrompt: `You are a critical reviewer. Challenge assumptions, identify blind spots, and highlight potential risks related to "${topic}".`,
    },
  ];
}

// -------------------------------------------------------------------
// Single-expert execution
// -------------------------------------------------------------------

async function executeExpert(
  expert: Expert,
  prompt: string,
  onStream?: (partialContent: string) => void
): Promise<string> {
  const cli = expert.cli as CliType;
  const fullPrompt = `${expert.systemPrompt}\n\n${prompt}`;
  console.log(`[Discussion] Executing expert: ${expert.name} (${cli})`);

  if (cli === "claude") {
    const session = new AgentSession(`disc-${Date.now()}`, AGENT_ROOT);
    session.sendMessage(fullPrompt);
    let result = "";
    try {
      for await (const msg of session.getOutputStream()) {
        if (msg.type === "assistant") {
          const content = msg.message?.content;
          let newText = "";
          if (typeof content === "string") newText = content;
          else if (Array.isArray(content)) {
            for (const b of content) {
              if (b.type === "text" && b.text) newText += b.text;
            }
          }
          if (newText) {
            result += newText;
            if (onStream) onStream(result);
          }
        } else if (msg.type === "result") break;
      }
    } finally {
      session.interrupt();
    }
    return result || "(no response)";
  }

  // Non-Claude CLI
  const cliSession = new CliSession(cli, AGENT_ROOT);
  try {
    return await cliSession.execute(fullPrompt);
  } catch (err) {
    return `(error from ${cli}: ${String(err)})`;
  }
}

// -------------------------------------------------------------------
// Mode selection
// -------------------------------------------------------------------

function chooseMode(topic: string): string {
  const lower = topic.toLowerCase();
  if (
    lower.includes("vs") ||
    lower.includes("compare") ||
    lower.includes("choose") ||
    lower.includes("比較") ||
    lower.includes("選擇")
  )
    return "debate";
  if (
    lower.includes("design") ||
    lower.includes("build") ||
    lower.includes("create") ||
    lower.includes("設計") ||
    lower.includes("建立")
  )
    return "relay";
  return "roundtable";
}

// -------------------------------------------------------------------
// Discussion modes
// -------------------------------------------------------------------

async function runRoundtable(
  projectId: string,
  project: { topic: string },
  experts: Expert[],
  onEvent: EventCallback
): Promise<void> {
  const lang = store.getSetting("language") || "en";
  // Chat history — like a real group conversation
  const chatHistory: { speaker: string; content: string }[] = [];

  const MAX_TURNS = experts.length * 3; // 3 turns per expert
  let turn = 0;

  // Round 1: Expert A opens the discussion
  onEvent({ type: "round_start", round: 1 });
  const opener = experts[0];
  const openContent = await withTimeout(
    executeExpert(opener,
      `Topic: "${project.topic}"\n\nYou are ${opener.name} (${opener.role}). Open the discussion — share your key insight in 3-5 sentences and ask the other experts a specific question. Keep it conversational, not formal. Use WebSearch if you need current data or facts to support your point. Language: ${lang}`,
      (partial) => onEvent({ type: "expert_message", expert: opener.name, cli: opener.cli, content: partial, round: 1 })
    ),
    EXPERT_TIMEOUT_MS,
    `Expert ${opener.name}`
  );
  chatHistory.push({ speaker: opener.name, content: openContent });
  store.addDiscussionMessage({ project_id: projectId, expert_name: opener.name, cli: opener.cli, content: openContent, round: 1 });
  onEvent({ type: "expert_message", expert: opener.name, cli: opener.cli, content: openContent, round: 1 });
  turn++;

  // Conversational turns: each expert responds to the LAST speaker
  let currentRound = 1;
  let speakerIndex = 1; // start from second expert

  while (turn < MAX_TURNS) {
    // Check if discussion was aborted
    const currentProject = store.getProject(projectId);
    if (!currentProject || currentProject.status !== "discussing") {
      console.log(`[Discussion] Aborted — project status is ${currentProject?.status}`);
      break;
    }

    const expert = experts[speakerIndex % experts.length];
    const recentChat = chatHistory.slice(-4).map(m => `[${m.speaker}]: ${m.content.slice(0, 600)}`).join("\n\n");
    const lastSpeaker = chatHistory[chatHistory.length - 1].speaker;

    // Every N turns = new round
    const newRound = Math.floor(turn / experts.length) + 1;
    if (newRound > currentRound) {
      onEvent({ type: "round_end", round: currentRound });
      currentRound = newRound;
      onEvent({ type: "round_start", round: currentRound });
    }

    const prompt = `Topic: "${project.topic}"

Recent conversation:
${recentChat}

You are ${expert.name} (${expert.role}). ${lastSpeaker} just spoke.

RULES:
- Directly respond to what ${lastSpeaker} said — reference specific points
- Agree, disagree, or add a new angle — explain briefly WHY
- Ask ONE follow-up question to keep the conversation going
- Talk like you're in a real meeting — short, direct, natural
- MAX 3-5 sentences. Do NOT write essays or bullet lists. Just talk.
- If you need facts or data to support your point, use WebSearch to look it up first.

Language: ${lang}`;

    let content: string;
    try {
      content = await withTimeout(
        executeExpert(expert, prompt,
          (partial) => onEvent({ type: "expert_message", expert: expert.name, cli: expert.cli, content: partial, round: currentRound })
        ),
        EXPERT_TIMEOUT_MS,
        `Expert ${expert.name}`
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      content = `[${expert.cli} error: ${errorMsg.slice(0, 200)}]`;
      console.error(`[Discussion] Expert ${expert.name} (${expert.cli}) failed:`, errorMsg.slice(0, 200));
    }
    chatHistory.push({ speaker: expert.name, content });
    store.addDiscussionMessage({ project_id: projectId, expert_name: expert.name, cli: expert.cli, content, round: currentRound });
    onEvent({ type: "expert_message", expert: expert.name, cli: expert.cli, content, round: currentRound });

    turn++;
    speakerIndex++;
  }

  onEvent({ type: "round_end", round: currentRound });
}

async function runDebate(
  projectId: string,
  project: { topic: string },
  experts: Expert[],
  onEvent: EventCallback
): Promise<void> {
  const lang = store.getSetting("language") || "en";
  const [proExpert, conExpert, judge] =
    experts.length >= 3
      ? [experts[0], experts[1], experts[2]]
      : [experts[0], experts[1] ?? experts[0], experts[0]];

  onEvent({ type: "round_start", round: 1 });

  // Pro argument
  const proContent = await withTimeout(
    executeExpert(
      proExpert,
      `Topic: "${project.topic}"\n\nAs ${proExpert.name}, argue IN FAVOR of this approach. Present your strongest case. Language: ${lang}`
    ),
    EXPERT_TIMEOUT_MS,
    `Expert ${proExpert.name}`
  );
  store.addDiscussionMessage({
    project_id: projectId,
    expert_name: proExpert.name,
    cli: proExpert.cli,
    content: proContent,
    round: 1,
  });
  onEvent({ type: "expert_message", expert: proExpert.name, cli: proExpert.cli, content: proContent, round: 1 });

  // Con argument
  const conContent = await withTimeout(
    executeExpert(
      conExpert,
      `Topic: "${project.topic}"\n\nPro argument by ${proExpert.name}:\n${proContent.slice(0, 500)}\n\nAs ${conExpert.name}, argue AGAINST or present an alternative perspective. Language: ${lang}`
    ),
    EXPERT_TIMEOUT_MS,
    `Expert ${conExpert.name}`
  );
  store.addDiscussionMessage({
    project_id: projectId,
    expert_name: conExpert.name,
    cli: conExpert.cli,
    content: conContent,
    round: 1,
  });
  onEvent({ type: "expert_message", expert: conExpert.name, cli: conExpert.cli, content: conContent, round: 1 });

  onEvent({ type: "round_end", round: 1 });

  // Judge verdict (only if a distinct third expert exists)
  if (judge !== proExpert) {
    onEvent({ type: "round_start", round: 2 });
    const judgeContent = await withTimeout(
      executeExpert(
        judge,
        `Topic: "${project.topic}"\n\nPro (${proExpert.name}): ${proContent.slice(0, 500)}\n\nCon (${conExpert.name}): ${conContent.slice(0, 500)}\n\nAs ${judge.name} (judge), evaluate both arguments and provide your verdict. Language: ${lang}`
      ),
      EXPERT_TIMEOUT_MS,
      `Expert ${judge.name}`
    );
    store.addDiscussionMessage({
      project_id: projectId,
      expert_name: judge.name,
      cli: judge.cli,
      content: judgeContent,
      round: 2,
    });
    onEvent({ type: "expert_message", expert: judge.name, cli: judge.cli, content: judgeContent, round: 2 });
    onEvent({ type: "round_end", round: 2 });
  }
}

async function runRelay(
  projectId: string,
  project: { topic: string },
  experts: Expert[],
  onEvent: EventCallback
): Promise<void> {
  const lang = store.getSetting("language") || "en";
  let previousOutput = "";

  for (let i = 0; i < experts.length; i++) {
    const expert = experts[i];
    const round = i + 1;
    onEvent({ type: "round_start", round });

    let prompt: string;
    if (i === 0) {
      prompt = `Topic: "${project.topic}"\n\nAs ${expert.name} (${expert.role}), provide an initial proposal or framework. Language: ${lang}`;
    } else if (i === experts.length - 1) {
      prompt = `Topic: "${project.topic}"\n\nPrevious work:\n${previousOutput.slice(0, 1000)}\n\nAs ${expert.name} (${expert.role}), validate, improve, and finalize the proposal. Language: ${lang}`;
    } else {
      prompt = `Topic: "${project.topic}"\n\nPrevious work:\n${previousOutput.slice(0, 1000)}\n\nAs ${expert.name} (${expert.role}), build upon and improve this work. Language: ${lang}`;
    }

    const content = await withTimeout(
      executeExpert(expert, prompt),
      EXPERT_TIMEOUT_MS,
      `Expert ${expert.name}`
    );
    previousOutput = content;
    store.addDiscussionMessage({
      project_id: projectId,
      expert_name: expert.name,
      cli: expert.cli,
      content,
      round,
    });
    onEvent({ type: "expert_message", expert: expert.name, cli: expert.cli, content, round });
    onEvent({ type: "round_end", round });
  }
}

// -------------------------------------------------------------------
// Public: run a full discussion
// -------------------------------------------------------------------

export async function runDiscussion(
  projectId: string,
  onEvent: EventCallback
): Promise<void> {
  const project = store.getProject(projectId);
  if (!project) throw new Error("Project not found");

  const experts: Expert[] = project.experts;
  if (experts.length === 0) {
    onEvent({ type: "error", content: "No experts configured" });
    store.updateProject(projectId, { status: "error" });
    return;
  }

  const mode =
    project.discussion_mode === "auto"
      ? chooseMode(project.topic)
      : project.discussion_mode;

  store.updateProject(projectId, { status: "discussing" });

  try {
    switch (mode) {
      case "roundtable":
        await runRoundtable(projectId, project, experts, onEvent);
        break;
      case "debate":
        await runDebate(projectId, project, experts, onEvent);
        break;
      case "relay":
        await runRelay(projectId, project, experts, onEvent);
        break;
      default:
        await runRoundtable(projectId, project, experts, onEvent);
    }
  } catch (err) {
    console.error(`[Discussion] Error in ${mode} mode:`, err);
    onEvent({ type: "error", content: String(err) });
    store.updateProject(projectId, { status: "error" });
    return;
  }

  console.log(`[Discussion] Completed for project ${projectId}`);
  store.updateProject(projectId, { status: "discussed" });
}

// -------------------------------------------------------------------
// Public: generate conclusion
// -------------------------------------------------------------------

export async function generateConclusion(
  projectId: string,
  onEvent: EventCallback
): Promise<string> {
  const project = store.getProject(projectId);
  if (!project) throw new Error("Project not found");

  const messages = store.getDiscussionMessages(projectId);
  const lang = store.getSetting("language") || "en";

  const summary = messages
    .map(
      (m) =>
        `[Round ${m.round}] ${m.expert_name} (${m.cli}): ${m.content.slice(0, 300)}`
    )
    .join("\n\n");

  const session = new AgentSession(`conclude-${Date.now()}`, AGENT_ROOT);
  const prompt = `Synthesize the following expert discussion into a clear, actionable conclusion.

Topic: "${project.topic}"

Discussion:
${summary}

Generate a comprehensive conclusion that:
1. Summarizes key insights from each expert
2. Identifies areas of agreement and disagreement
3. Provides a final recommendation
4. Lists action items if applicable

Language: ${lang}`;

  let result = "";
  try {
    session.sendMessage(prompt);
    try {
      for await (const msg of session.getOutputStream()) {
        if (msg.type === "assistant") {
          const content = msg.message?.content;
          let newText = "";
          if (typeof content === "string") newText = content;
          else if (Array.isArray(content)) {
            for (const b of content) {
              if (b.type === "text" && b.text) newText += b.text;
            }
          }
          if (newText) {
            result += newText;
            // Stream partial conclusion to client
            onEvent({ type: "conclusion", content: result });
          }
        } else if (msg.type === "result") break;
      }
    } finally {
      session.interrupt();
    }

    // Persist conclusion as a special round-99 message
    store.addDiscussionMessage({
      project_id: projectId,
      expert_name: "Conclusion",
      cli: "claude",
      content: result,
      round: 99,
    });

    // Write Markdown files to workspace/ before marking concluded
    try {
      saveProjectMarkdown(projectId);
    } catch (err) {
      console.error(`[Discussion] Failed to save markdown:`, err);
    }
    store.updateProject(projectId, { status: "concluded" });

    onEvent({ type: "conclusion", content: result });
    return result;
  } catch (err) {
    console.error(`[Discussion] generateConclusion failed:`, err);
    onEvent({ type: "error", content: String(err) });
    store.updateProject(projectId, { status: "error" });
    return result;
  }
}

// -------------------------------------------------------------------
// Internal: save project to Markdown files
// -------------------------------------------------------------------

function saveProjectMarkdown(projectId: string): void {
  const project = store.getProject(projectId);
  if (!project) return;

  const messages = store.getDiscussionMessages(projectId);
  const projectSlug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const projectDir = path.join(AGENT_ROOT, "workspace", "projects", projectSlug);

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, "experts"), { recursive: true });

  // README.md
  const conclusion = messages.find((m) => m.expert_name === "Conclusion");
  const readmeContent = [
    `# ${project.name}`,
    ``,
    `**Topic**: ${project.topic}`,
    `**Mode**: ${project.discussion_mode}`,
    `**Experts**: ${project.experts.map((e: Expert) => e.name).join(", ")}`,
    `**Date**: ${project.created_at}`,
    ``,
    `## Conclusion`,
    ``,
    conclusion?.content || "(pending)",
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(projectDir, "README.md"), readmeContent, "utf8");

  // Round files
  const rounds = [
    ...new Set(
      messages.filter((m) => m.round < 99).map((m) => m.round)
    ),
  ].sort((a, b) => a - b);
  for (const round of rounds) {
    const roundMsgs = messages.filter((m) => m.round === round);
    const roundContent =
      `# Round ${round}\n\n` +
      roundMsgs
        .map((m) => `## ${m.expert_name} (${m.cli})\n\n${m.content}\n`)
        .join("\n---\n\n");
    fs.writeFileSync(
      path.join(projectDir, `round-${round}.md`),
      roundContent,
      "utf8"
    );
  }

  // Per-expert files
  for (const expert of project.experts) {
    const expertMsgs = messages.filter(
      (m) => m.expert_name === expert.name
    );
    if (expertMsgs.length === 0) continue;
    const expertSlug = expert.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const expertContent =
      `# ${expert.name}\n\n**Role**: ${expert.role}\n**CLI**: ${expert.cli}\n\n` +
      expertMsgs
        .map((m) => `## Round ${m.round}\n\n${m.content}\n`)
        .join("\n---\n\n");
    fs.writeFileSync(
      path.join(projectDir, "experts", `${expertSlug}.md`),
      expertContent,
      "utf8"
    );
  }

  // conclusion.md
  if (conclusion) {
    fs.writeFileSync(
      path.join(projectDir, "conclusion.md"),
      `# Conclusion\n\n${conclusion.content}\n`,
      "utf8"
    );
  }
}
