#!/usr/bin/env node
/**
 * Session Farewell — SessionEnd hook for Claude-Agent
 *
 * Fires when session terminates. Saves final state:
 * 1. Extracts session achievements from transcript
 * 2. Archives daily learnings
 * 3. Updates memory files with final state
 * 4. Creates session archive entry
 *
 * Input (stdin JSON):
 *   { hook_event_name, reason, session_id, transcript_path, cwd }
 * Output: none (writes to memory files directly)
 */

const fs = require('fs');
const path = require('path');

// Hard timeout: must be less than settings.json timeout (15s)
setTimeout(() => process.exit(0), 12000);

// === Read stdin (synchronous) ===
let inputData = {};
try {
  const str = fs.readFileSync(process.stdin.fd, 'utf8');
  if (str) inputData = JSON.parse(str);
} catch (e) {
  if (e instanceof SyntaxError) {
    process.stderr.write(`[session-farewell] Invalid JSON on stdin: ${e.message}\n`);
  }
}

const transcriptPath = inputData.transcript_path || '';
const cwd = inputData.cwd || process.cwd();
const reason = inputData.reason || 'unknown';
const memoryDir = path.join(cwd, 'memory');
const archiveDir = path.join(memoryDir, 'archive');

// === Extract from transcript ===
function extractFromTranscript() {
  const result = {
    userMessages: [],
    channelSources: new Set(),
    modifiedFiles: [],
    toolCounts: {},
    lastAssistantText: '',
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) return result;

  try {
    const stat = fs.statSync(transcriptPath);
    const readSize = Math.min(stat.size, 512 * 1024);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    const content = buf.toString('utf8');
    const firstNewline = stat.size > readSize ? content.indexOf('\n') + 1 : 0;
    const lines = content.slice(firstNewline).trim().split('\n');
    const recentLines = lines.slice(-500);

    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        const msg = entry.message || {};
        const msgContent = msg.content;

        if (entry.type === 'user') {
          let text = '';
          if (typeof msgContent === 'string') text = msgContent;
          else if (Array.isArray(msgContent)) {
            text = msgContent.filter(b => b.type === 'text').map(b => b.text).join(' ');
          }
          if (text.length > 5) {
            result.userMessages.push(text.slice(0, 500));
            // Detect channel sources
            const channelMatch = text.match(/<channel\s+source="([^"]+)"/);
            if (channelMatch) result.channelSources.add(channelMatch[1]);
          }
        }

        if (entry.type === 'assistant' && Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === 'tool_use') {
              const name = block.name || '';
              result.toolCounts[name] = (result.toolCounts[name] || 0) + 1;
              const inp = block.input || {};
              if (inp.file_path && (name === 'Edit' || name === 'Write')) {
                if (!result.modifiedFiles.includes(inp.file_path)) {
                  result.modifiedFiles.push(inp.file_path);
                }
              }
            }
            if (block.type === 'text' && block.text) {
              result.lastAssistantText = block.text.slice(0, 300);
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  return result;
}

// === Create session archive ===
function archiveSession(ctx) {
  try {
    fs.mkdirSync(archiveDir, { recursive: true });

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
    const archivePath = path.join(archiveDir, `${dateStr}-${timeStr}-session.md`);

    const totalTools = Object.values(ctx.toolCounts).reduce((a, b) => a + b, 0);
    const topTools = Object.entries(ctx.toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n, c]) => `${n}:${c}`)
      .join(', ');

    const channels = [...ctx.channelSources].join(', ') || 'terminal only';

    const content = `# Session Archive — ${dateStr} ${timeStr}

## Summary
- **Ended**: ${reason}
- **Messages**: ${ctx.userMessages.length} user messages
- **Channels**: ${channels}
- **Tools**: ${totalTools} calls (${topTools})
- **Files modified**: ${ctx.modifiedFiles.length}

## First Request
${ctx.userMessages[0] ? ctx.userMessages[0].slice(0, 300) : '(none)'}

## Last Request
${ctx.userMessages.length > 1 ? ctx.userMessages[ctx.userMessages.length - 1].slice(0, 300) : '(same as first)'}

## Modified Files
${ctx.modifiedFiles.map(f => `- ${f}`).join('\n') || '(none)'}

## Last Assistant Output
${ctx.lastAssistantText || '(none)'}
`;

    fs.writeFileSync(archivePath, content, 'utf-8');
  } catch (e) {}
}

// === Mark threads as inactive ===
function updateThreadsOnExit() {
  try {
    const threadsPath = path.join(memoryDir, 'active-threads.md');
    if (!fs.existsSync(threadsPath)) return;

    let content = fs.readFileSync(threadsPath, 'utf8');
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

    // Replace any existing session-end comment (avoid unbounded growth)
    if (content.includes('## [')) {
      content = content.replace(/\n<!-- Session ended at .* -->\n/g, '');
      content += `\n<!-- Session ended at ${now} (${reason}). Threads may need refresh on next startup. -->\n`;
      fs.writeFileSync(threadsPath, content, 'utf-8');
    }
  } catch (e) {}
}

// === Main ===
try {
  const ctx = extractFromTranscript();

  if (ctx.userMessages.length === 0 && ctx.modifiedFiles.length === 0) {
    process.exit(0);
  }

  // Archive the session
  archiveSession(ctx);

  // Update thread state
  updateThreadsOnExit();
} catch (e) {}

process.exit(0);
