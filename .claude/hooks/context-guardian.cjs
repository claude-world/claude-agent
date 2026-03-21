#!/usr/bin/env node
/**
 * Context Guardian — PreCompact hook for Claude-Agent
 *
 * Fires before context compaction to preserve critical state:
 * 1. Reads transcript to extract active threads, pending items, user preferences
 * 2. Updates memory/active-threads.md and memory/pending-tasks.md
 * 3. Injects "ACTIVE STATE" into compact summary so Claude survives compaction
 *
 * Input (stdin JSON):
 *   { hook_event_name, trigger, custom_instructions, session_id, transcript_path, cwd }
 * Output (stdout): hookSpecificOutput with newCustomInstructions
 */

const fs = require('fs');
const path = require('path');

// Hard timeout: must be less than settings.json timeout (10s)
setTimeout(() => process.exit(0), 8000);

// === Read stdin (synchronous) ===
let inputData = {};
try {
  const str = fs.readFileSync(process.stdin.fd, 'utf8');
  if (str) inputData = JSON.parse(str);
} catch (e) {
  if (e instanceof SyntaxError) {
    process.stderr.write(`[context-guardian] Invalid JSON on stdin: ${e.message}\n`);
  }
}

const transcriptPath = inputData.transcript_path || '';
const trigger = inputData.trigger || 'unknown';
const cwd = inputData.cwd || process.cwd();
const memoryDir = path.join(cwd, 'memory');

// === Extract from transcript ===
function extractFromTranscript(tPath) {
  const result = {
    userMessages: [],
    channelMessages: [],  // messages from channels with source/chat_id
    modifiedFiles: [],
    pendingQuestions: [],
    learnedFacts: [],
    toolCounts: {},
  };

  if (!tPath || !fs.existsSync(tPath)) return result;

  try {
    const stat = fs.statSync(tPath);
    const readSize = Math.min(stat.size, 256 * 1024);
    const fd = fs.openSync(tPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    const content = buf.toString('utf8');
    const firstNewline = stat.size > readSize ? content.indexOf('\n') + 1 : 0;
    const lines = content.slice(firstNewline).trim().split('\n');
    const recentLines = lines.slice(-400);

    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        const msg = entry.message || {};
        const msgContent = msg.content;

        // User messages (including channel messages)
        if (entry.type === 'user') {
          let text = '';
          if (typeof msgContent === 'string') {
            text = msgContent;
          } else if (Array.isArray(msgContent)) {
            text = msgContent.filter(b => b.type === 'text').map(b => b.text).join(' ');
          }

          if (text.length > 5) {
            result.userMessages.push(text.slice(0, 500));

            // Detect channel messages
            const channelMatch = text.match(/<channel\s+source="([^"]+)"(?:\s+chat_id="([^"]+)")?(?:\s+sender="([^"]+)")?[^>]*>([\s\S]*?)<\/channel>/);
            if (channelMatch) {
              result.channelMessages.push({
                source: channelMatch[1],
                chat_id: channelMatch[2] || '',
                sender: channelMatch[3] || '',
                content: channelMatch[4].slice(0, 300),
              });
            }

            // Detect questions (messages ending with ?)
            if (text.trim().endsWith('?')) {
              result.pendingQuestions.push(text.slice(0, 200));
            }
          }
        }

        // Assistant messages — tool use tracking
        if (entry.type === 'assistant' && Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === 'tool_use') {
              const toolName = block.name || '';
              result.toolCounts[toolName] = (result.toolCounts[toolName] || 0) + 1;
              const input = block.input || {};
              if (input.file_path && (toolName === 'Edit' || toolName === 'Write')) {
                if (!result.modifiedFiles.includes(input.file_path)) {
                  result.modifiedFiles.push(input.file_path);
                }
              }
            }

            // Detect memory writes (facts Claude decided to save)
            if (block.type === 'tool_use' && block.name === 'Write') {
              const fp = (block.input || {}).file_path || '';
              if (fp.includes('memory/') && fp.endsWith('.md')) {
                result.learnedFacts.push(`Updated: ${path.basename(fp)}`);
              }
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  return result;
}

// === Read current memory state ===
// For display/context injection: truncated to save context window space
function readMemoryFile(filename) {
  try {
    const p = path.join(memoryDir, filename);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8').slice(0, 2000);
    }
  } catch (e) {}
  return '';
}

// For file updates: read full content to avoid silent truncation
function readMemoryFileFull(filename) {
  try {
    const p = path.join(memoryDir, filename);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  } catch (e) {}
  return '';
}

// === Update active threads from channel messages ===
function updateActiveThreads(ctx) {
  if (ctx.channelMessages.length === 0) return;

  try {
    const threadsPath = path.join(memoryDir, 'active-threads.md');
    let content = readMemoryFileFull('active-threads.md') || '# Active Conversation Threads\n';
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

    for (const msg of ctx.channelMessages.slice(-5)) {
      const threadHeader = `## [${msg.source}] ${msg.sender || 'unknown'}`;
      if (!content.includes(threadHeader)) {
        content += `\n${threadHeader}\n- **Last activity**: ${now}\n- **Status**: active\n- **Latest**: ${msg.content.slice(0, 100)}\n`;
      } else {
        // Update last activity
        const idx = content.indexOf(threadHeader);
        const nextSection = content.indexOf('\n## ', idx + 1);
        const sectionEnd = nextSection >= 0 ? nextSection : content.length;
        const section = content.slice(idx, sectionEnd);
        const updated = section
          .replace(/\*\*Last activity\*\*:.*/, `**Last activity**: ${now}`)
          .replace(/\*\*Latest\*\*:.*/, `**Latest**: ${msg.content.slice(0, 100)}`);
        content = content.slice(0, idx) + updated + content.slice(sectionEnd);
      }
    }

    fs.writeFileSync(threadsPath, content, 'utf-8');
  } catch (e) {}
}

// === Generate compact instructions ===
function generateCompactInstructions(ctx) {
  const parts = [];

  parts.push(`## Claude-Agent Active State (PreCompact: ${trigger})`);
  parts.push('');
  parts.push('CRITICAL: You are a persistent assistant in Channels mode. Preserve the following state across compaction:');
  parts.push('');

  // Active channel threads
  if (ctx.channelMessages.length > 0) {
    parts.push('### Active Channel Threads (DO NOT FORGET):');
    const seen = new Set();
    for (const msg of ctx.channelMessages.slice(-10)) {
      const key = `${msg.source}:${msg.sender}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(`- [${msg.source}] ${msg.sender} (chat_id: ${msg.chat_id}): "${msg.content.slice(0, 80)}"`);
    }
    parts.push('');
  }

  // User objectives
  if (ctx.userMessages.length > 0) {
    parts.push('### Recent User Messages:');
    const first = ctx.userMessages[0];
    parts.push(`- First: "${first.slice(0, 200)}"`);
    if (ctx.userMessages.length > 1) {
      const last = ctx.userMessages[ctx.userMessages.length - 1];
      parts.push(`- Latest: "${last.slice(0, 200)}"`);
    }
    parts.push(`- Total messages this cycle: ${ctx.userMessages.length}`);
    parts.push('');
  }

  // Pending questions
  if (ctx.pendingQuestions.length > 0) {
    parts.push('### Pending Questions (may need follow-up):');
    for (const q of ctx.pendingQuestions.slice(-3)) {
      parts.push(`- ${q.slice(0, 150)}`);
    }
    parts.push('');
  }

  // Memory state
  const userProfile = readMemoryFile('user-profile.md');
  if (userProfile && !userProfile.includes('(not yet known)')) {
    parts.push('### User Profile Summary:');
    // Extract non-template lines
    const profileLines = userProfile.split('\n')
      .filter(l => l.startsWith('- ') && !l.includes('(not yet known)'))
      .slice(0, 5);
    for (const l of profileLines) {
      parts.push(l);
    }
    parts.push('');
  }

  // Modified files
  if (ctx.modifiedFiles.length > 0) {
    parts.push('### Files Modified This Cycle:');
    for (const f of ctx.modifiedFiles.slice(0, 10)) {
      parts.push(`- ${f}`);
    }
    parts.push('');
  }

  // Guidance
  parts.push('### Post-Compaction Instructions:');
  parts.push('- Check memory/active-threads.md for conversation state');
  parts.push('- Check memory/pending-tasks.md for open items');
  parts.push('- Continue responding to channel messages naturally');
  parts.push('- Do NOT re-introduce yourself after compaction');

  return parts.join('\n');
}

// === Main ===
try {
  const ctx = extractFromTranscript(transcriptPath);

  // Update memory files with latest state
  updateActiveThreads(ctx);

  // Generate compact instructions
  const instructions = generateCompactInstructions(ctx);

  // Output as hookSpecificOutput
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      newCustomInstructions: instructions,
    }
  });
  process.stdout.write(output);
} catch (e) {
  // Silent failure — output empty to not block compaction
}

process.exit(0);
