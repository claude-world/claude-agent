#!/usr/bin/env node
/**
 * Session Bootstrap — SessionStart hook for Claude-Agent
 *
 * Fires when session starts or resumes. Loads memory into context:
 * 1. User profile
 * 2. Active conversation threads
 * 3. Pending tasks
 *
 * Input (stdin JSON):
 *   { hook_event_name, session_id, transcript_path, cwd, matcher }
 * Output (stdout JSON): { systemMessage: "..." }
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
    process.stderr.write(`[session-bootstrap] Invalid JSON on stdin: ${e.message}\n`);
  }
}

const cwd = inputData.cwd || process.cwd();
const matcher = inputData.matcher || 'startup';
const memoryDir = path.join(cwd, 'memory');

// === Read memory files ===
function readMemory(filename) {
  try {
    const p = path.join(memoryDir, filename);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  } catch (e) {}
  return '';
}

// === Generate context injection ===
function generateBootstrapContext() {
  const parts = [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  parts.push(`[Session ${matcher} at ${now}]`);
  parts.push('');

  // User profile
  const profile = readMemory('user-profile.md');
  if (profile) {
    const profileLines = profile.split('\n')
      .filter(l => l.startsWith('- ') && !l.includes('(not yet known)'));
    if (profileLines.length > 0) {
      parts.push('Loaded user profile:');
      for (const l of profileLines.slice(0, 8)) {
        parts.push(l);
      }
      parts.push('');
    }
  }

  // Active threads
  const threads = readMemory('active-threads.md');
  if (threads && !threads.includes('No active threads yet')) {
    const threadSections = threads.split('\n## ').slice(1);
    if (threadSections.length > 0) {
      parts.push(`Active conversations (${threadSections.length}):`);
      for (const section of threadSections.slice(0, 5)) {
        const firstLine = section.split('\n')[0];
        parts.push(`- ${firstLine}`);
      }
      parts.push('');
    }
  }

  // Pending tasks
  const tasks = readMemory('pending-tasks.md');
  if (tasks && !tasks.includes('No pending tasks yet')) {
    const taskLines = tasks.split('\n').filter(l => l.startsWith('## [ ]'));
    if (taskLines.length > 0) {
      parts.push(`Pending tasks (${taskLines.length}):`);
      for (const t of taskLines.slice(0, 5)) {
        parts.push(`- ${t.replace('## [ ] ', '')}`);
      }
      parts.push('');
    }
  }

  // Remind about scheduled routines
  if (matcher === 'startup') {
    parts.push('Remember to set up scheduled routines:');
    parts.push('- /loop 30m /memory-manager (memory consolidation)');
    parts.push('');
  }

  if (parts.length <= 2) {
    // First-time user detection
    parts.push('NEW USER DETECTED — memory is empty.');
    parts.push('Suggest running /setup for guided onboarding (tool inventory, profile, scheduled routines).');
    parts.push('Or just start chatting — the assistant will learn and save to memory automatically.');
  }

  return parts.join('\n');
}

// === Main ===
try {
  const context = generateBootstrapContext();

  const output = JSON.stringify({
    systemMessage: context,
  });
  process.stdout.write(output);
} catch (e) {}

process.exit(0);
