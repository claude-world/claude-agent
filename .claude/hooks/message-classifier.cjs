#!/usr/bin/env node
/**
 * Message Classifier — UserPromptSubmit hook for Claude-Agent
 *
 * Fires when a message arrives (including from channels).
 * Classifies the message and adds routing hints as additionalContext.
 * Does NOT block — only adds context to help Claude route better.
 *
 * Input (stdin JSON):
 *   { hook_event_name, prompt, session_id, transcript_path, cwd }
 * Output (stdout JSON): { hookSpecificOutput: { additionalContext: "..." } }
 */

const fs = require('fs');
const path = require('path');

// Hard timeout: must be less than settings.json timeout (5s)
setTimeout(() => process.exit(0), 3000);

// === Read stdin (synchronous) ===
let inputData = {};
try {
  const str = fs.readFileSync(process.stdin.fd, 'utf8');
  if (str) inputData = JSON.parse(str);
} catch (e) {
  if (e instanceof SyntaxError) {
    process.stderr.write(`[message-classifier] Invalid JSON on stdin: ${e.message}\n`);
  }
}

const prompt = inputData.prompt || '';
const cwd = inputData.cwd || process.cwd();

if (!prompt || prompt.length < 3) {
  process.exit(0);
}

// === Classify message ===
function classifyMessage(text) {
  const lower = text.toLowerCase();

  // Channel message detection
  const isChannel = text.includes('<channel ');
  let channelSource = '';
  if (isChannel) {
    const match = text.match(/<channel\s+source="([^"]+)"/);
    channelSource = match ? match[1] : 'unknown';
  }

  // Short simple questions — answer directly, don't over-classify
  if (lower.trim().endsWith('?') && lower.length < 80 && !isChannel) {
    // Only route short questions if they contain strong intent signals
    const strongSignals = ['research', 'find out', 'look up', 'remind me', 'remember', 'summarize', 'brainstorm', 'draft', 'good morning', 'memory', 'context', 'trending', 'hot topics', 'create a post', 'podcast', 'read this page'];
    const hasStrongSignal = strongSignals.some(s => lower.includes(s));
    if (!hasStrongSignal) {
      return { intent: 'simple-reply', isChannel, channelSource };
    }
  }

  // Intent classification (simple keyword-based, fast)
  // Order matters: more specific patterns first, broader patterns last
  const patterns = [
    { intent: 'setup', keywords: ['setup', 'get started', 'initialize', 'first time', 'how do i use', 'help me configure'] },
    { intent: 'migrate', keywords: ['migrate from openclaw', 'import openclaw', 'switch from openclaw', 'coming from openclaw', 'openclaw migration'] },
    { intent: 'content-pipeline', keywords: ['full pipeline', 'trend and post', 'find trending and', 'content pipeline', 'trending and create', 'trend to content'] },
    { intent: 'trending', keywords: ["what's trending", 'what is trending', 'trending topics', 'hot topics', "what's popular", "what is popular", 'viral topics', 'trending now'] },
    { intent: 'create-content', keywords: ['create a post', 'write a post', 'make content', 'write content about', 'make a post', 'turn this into a post', 'create content'] },
    { intent: 'podcast', keywords: ['make a podcast', 'create a podcast', 'podcast about', 'audio about', 'turn this into audio', 'make something to listen'] },
    { intent: 'deep-read', keywords: ['read this page', 'get content from', 'what does this page say', 'read this for me', 'extract from this'] },
    { intent: 'briefing', keywords: ['good morning', 'daily briefing', "what's my day", "what is my day", "what's pending", 'morning update'] },
    { intent: 'memory', keywords: ['what do you remember', 'memory status', 'clean up memory', 'forget about'] },
    { intent: 'context', keywords: ['context health', 'context status', "how's the context", "how is the context", 'are you okay'] },
    { intent: 'calendar', keywords: ['check calendar', 'my calendar', "what's on my calendar", 'schedule a meeting', 'next meeting', 'calendar event', 'schedule meeting'] },
    { intent: 'task', keywords: ['remind me', 'add task', 'todo', 'to-do', 'deadline', "don't forget"] },
    { intent: 'summarize', keywords: ['summarize', 'summary', 'tldr', 'tl;dr', 'key points', 'recap'] },
    { intent: 'draft', keywords: ['draft', 'write an email', 'write a message', 'compose', 'reply to'] },
    { intent: 'brainstorm', keywords: ['brainstorm', 'ideas for', 'help me think', 'suggestions for', 'what if'] },
    { intent: 'music', keywords: ['spotify', 'play music', 'play song', 'pause music', 'skip song', 'skip this song', 'next track', "what's playing", 'queue song', 'play some music'] },
    { intent: 'lights', keywords: ['lights on', 'lights off', 'turn on the light', 'turn off the light', 'turn off the', 'dim the light', 'dim the', 'brighten', 'hue light', 'light scene'] },
    { intent: 'email-op', keywords: ['check email', 'check my email', 'check mail', 'send email', 'read email', 'my inbox', 'new email', 'search email', 'gmail', 'send mail'] },
    { intent: 'messaging', keywords: ['send text', 'send a text', 'send message to', 'imessage', 'whatsapp', 'send slack', 'post to slack', 'tweet', 'post to x', 'text to'] },
    { intent: 'notes', keywords: ['add note', 'add a note', 'create note', 'search note', 'obsidian', 'bear note', 'apple note', 'notion page', 'add to notion'] },
    { intent: 'generate-image', keywords: ['generate image', 'generate an image', 'create image', 'create picture', 'make an image', 'draw me', 'generate a photo'] },
    { intent: 'transcribe', keywords: ['transcribe', 'speech to text', 'convert audio', 'text to speech', 'read aloud', 'tts'] },
    { intent: 'places-search', keywords: ['find restaurant', 'find a restaurant', 'nearby', 'coffee shop', 'find a place', 'open near me'] },
    { intent: 'code', keywords: ['write code', 'fix bug', 'debug', 'implement', 'function that', 'script to'] },
    { intent: 'analysis', keywords: ['analyze', 'compare', 'evaluate', 'assess', 'pros and cons', 'trade-off'] },
    { intent: 'research', keywords: ['research', 'find out', 'look up', 'tell me about', 'investigate'] },
  ];

  for (const p of patterns) {
    for (const kw of p.keywords) {
      if (lower.includes(kw)) {
        return { intent: p.intent, isChannel, channelSource };
      }
    }
  }

  // URL detection — only if the URL is the primary content (not embedded in another request)
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (urlMatch) {
    const urlLen = urlMatch[0].length;
    const nonUrlText = text.replace(/https?:\/\/\S+/g, '').trim();
    // If the message is mostly a URL (> 50% of content), route to summarize
    if (urlLen > text.length * 0.5 || nonUrlText.length < 20) {
      return { intent: 'summarize', isChannel, channelSource };
    }
  }

  // Question detection
  if (text.trim().endsWith('?') && text.length < 200) {
    return { intent: 'simple-reply', isChannel, channelSource };
  }

  return { intent: 'simple-reply', isChannel, channelSource };
}

// === Intent to routing hint ===
function getRoutingHint(classification) {
  const { intent, isChannel, channelSource } = classification;

  const routingMap = {
    'setup': 'Consider using /setup skill for guided onboarding (profile, tool inventory, scheduled routines).',
    'migrate': 'Consider using /migrate-openclaw skill for one-click migration from OpenClaw.',
    'trending': 'Consider using /trend-scout skill. Queries 20 sources with no credentials required.',
    'create-content': 'Consider using /content-creator skill for patent-optimized content generation.',
    'podcast': 'Consider using /podcast-maker skill. Requires NotebookLM setup (uvx notebooklm login).',
    'deep-read': 'Consider using /deep-read skill for JS-rendered pages. Falls back to WebFetch if cf-browser unavailable.',
    'content-pipeline': 'Delegate to the content-publisher agent for the full trend-to-content pipeline.',
    'research': 'Consider using /quick-research skill to handle this in a forked context.',
    'task': 'Consider using /task-tracker skill to manage this task/reminder.',
    'summarize': 'Consider using /summarize skill to handle this in a forked context.',
    'draft': 'Consider using /draft-message skill for this composition task.',
    'brainstorm': 'Consider using /brainstorm skill for structured ideation.',
    'briefing': 'Consider using /daily-briefing skill for the morning summary.',
    'memory': 'Consider using /memory-manager skill to handle memory operations.',
    'context': 'Consider using /context-health skill to check context window status.',
    'music': 'Consider using /spotify skill for music playback control.',
    'lights': 'Consider using /hue-lights skill for smart light control.',
    'email-op': 'Consider using /email skill (himalaya) or /google-workspace skill (gog) for email.',
    'messaging': 'Route to the appropriate messaging skill: /imessage, /whatsapp, /slack-ops, or /x-twitter.',
    'calendar': 'Consider using /google-workspace skill for calendar operations.',
    'notes': 'Consider the appropriate notes skill: /obsidian, /bear-notes, /apple-notes, or /notion.',
    'generate-image': 'Consider using /image-gen skill for AI image generation.',
    'transcribe': 'Consider using /speech-to-text or /text-to-speech skill.',
    'places-search': 'Consider using /places skill for location search.',
    'code': 'This may need coding work. For complex tasks, delegate to an agent.',
    'analysis': 'For complex analysis, consider delegating to the analyst agent.',
    'simple-reply': 'This looks like a simple question — handle directly in main context.',
  };

  let hint = routingMap[intent] || '';

  if (isChannel) {
    hint = `[Channel: ${channelSource}] ${hint} Remember to reply via the channel reply tool.`;
  }

  return hint;
}

// === Main ===
try {
  const classification = classifyMessage(prompt);

  // Only add context for non-trivial classifications
  if (classification.intent !== 'simple-reply' || classification.isChannel) {
    const hint = getRoutingHint(classification);
    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: hint,
      }
    });
    process.stdout.write(output);
  }
} catch (e) {}

process.exit(0);
