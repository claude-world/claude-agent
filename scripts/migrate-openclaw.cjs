#!/usr/bin/env node
/**
 * OpenClaw → Claude-Agent Migration Script
 *
 * One-click migration from OpenClaw (https://github.com/openclaw/openclaw)
 * to Claude-Agent. Reads ~/.openclaw/ and generates claude-agent compatible
 * memory, skills, agents, rules, and configuration.
 *
 * Usage:
 *   node scripts/migrate-openclaw.cjs [options]
 *
 * Options:
 *   --openclaw-dir <path>  OpenClaw state directory (default: ~/.openclaw)
 *   --workspace <path>     OpenClaw workspace (auto-detected from config)
 *   --dry-run              Show what would be migrated without making changes
 *   --merge                Merge with existing data instead of skipping
 *   --verbose              Show detailed output
 *   --help                 Show this help message
 *
 * Zero dependencies — uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// === CLI Argument Parsing ===
const args = process.argv.slice(2);
const opts = {
  openclawDir: '',
  workspace: '',
  dryRun: false,
  merge: false,
  verbose: false,
  help: false,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--openclaw-dir': opts.openclawDir = args[++i] || ''; break;
    case '--workspace': opts.workspace = args[++i] || ''; break;
    case '--dry-run': opts.dryRun = true; break;
    case '--merge': opts.merge = true; break;
    case '--verbose': opts.verbose = true; break;
    case '--help': opts.help = true; break;
  }
}

if (opts.help) {
  console.log(`
OpenClaw → Claude-Agent Migration

Usage: node scripts/migrate-openclaw.cjs [options]

Options:
  --openclaw-dir <path>  OpenClaw state directory (default: ~/.openclaw)
  --workspace <path>     OpenClaw workspace (auto-detected from config)
  --dry-run              Show what would be migrated without making changes
  --merge                Merge with existing data instead of skipping
  --verbose              Show detailed output
  --help                 Show this help message
`);
  process.exit(0);
}

// === Paths ===
const homeDir = os.homedir();
const openclawDir = opts.openclawDir || path.join(homeDir, '.openclaw');
const projectDir = path.resolve(__dirname, '..');
const claudeDir = path.join(projectDir, '.claude');
const memoryDir = path.join(projectDir, 'memory');
const archiveDir = path.join(memoryDir, 'archive');

// === Logging ===
const log = (msg) => console.log(msg);
const verbose = (msg) => opts.verbose && console.log(`  [verbose] ${msg}`);
const warn = (msg) => console.log(`  [warn] ${msg}`);

// === Stats ===
const stats = {
  identity: false,
  memoryFacts: 0,
  dailyLogs: 0,
  skills: { migrated: 0, skipped: 0, names: [] },
  agents: 0,
  rules: 0,
  mcpServers: 0,
  sessions: 0,
  credentials: 0,
  errors: [],
  skipped: [],
};

// === Utility Functions ===

function readFileSafe(filepath) {
  try {
    return fs.existsSync(filepath) ? fs.readFileSync(filepath, 'utf8') : null;
  } catch (e) {
    verbose(`Failed to read ${filepath}: ${e.message}`);
    return null;
  }
}

function writeFileSafe(filepath, content) {
  if (opts.dryRun) {
    verbose(`[dry-run] Would write: ${filepath} (${content.length} chars)`);
    return true;
  }
  try {
    const dir = path.dirname(filepath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filepath, content, 'utf8');
    verbose(`Wrote: ${filepath}`);
    return true;
  } catch (e) {
    warn(`Failed to write ${filepath}: ${e.message}`);
    stats.errors.push(`Write failed: ${filepath}`);
    return false;
  }
}

function fileExists(filepath) {
  return fs.existsSync(filepath);
}

// Strip JSON5 comments (// and /* */) for parsing without dependencies
function stripJson5Comments(str) {
  return str
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1'); // trailing commas
}

// Simple YAML frontmatter parser (no deps)
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  const lines = match[1].split('\n');
  let currentKey = '';
  let currentValue = '';
  let inMultiline = false;

  for (const line of lines) {
    if (inMultiline) {
      if (line.startsWith('  ') || line.startsWith('\t')) {
        currentValue += ' ' + line.trim();
        continue;
      } else {
        meta[currentKey] = currentValue.trim();
        inMultiline = false;
      }
    }

    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === '>' || val === '|') {
        inMultiline = true;
        currentValue = '';
      } else if (val.startsWith('[') || val.startsWith('-')) {
        // Array - collect items
        if (val.startsWith('[')) {
          meta[currentKey] = val.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
        } else {
          meta[currentKey] = [val.replace(/^-\s*/, '')];
        }
      } else {
        meta[currentKey] = val.replace(/^["']|["']$/g, '');
      }
    } else if (line.trim().startsWith('- ') && currentKey) {
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(line.trim().replace(/^-\s*/, ''));
    }
  }
  if (inMultiline) meta[currentKey] = currentValue.trim();

  return { meta, body: match[2] };
}

// Map OpenClaw model names to Claude Code model names
function mapModel(model) {
  if (!model) return 'sonnet';
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('gpt-4') || m.includes('gpt4')) return 'sonnet';
  if (m.includes('gpt-3') || m.includes('gpt3')) return 'haiku';
  if (m.includes('gemini-pro') || m.includes('gemini-1.5')) return 'sonnet';
  if (m.includes('gemini-flash')) return 'haiku';
  return 'sonnet'; // default
}

// Generate Claude Code frontmatter for a skill
function generateSkillFrontmatter(meta) {
  const lines = ['---'];
  lines.push(`name: ${meta.name || 'unnamed'}`);
  lines.push(`description: >`);
  lines.push(`  ${meta.description || 'Migrated from OpenClaw'}`);

  // Tools mapping
  const tools = meta.tools || meta['allowed-tools'] || [];
  if (tools.length > 0) {
    lines.push('allowed-tools:');
    for (const t of tools) {
      // Map common tool names
      const mapped = t.replace(/^(web_search|websearch)$/i, 'WebSearch')
        .replace(/^(web_fetch|webfetch|fetch)$/i, 'WebFetch')
        .replace(/^(read_file|file_read)$/i, 'Read')
        .replace(/^(write_file|file_write)$/i, 'Write')
        .replace(/^(edit_file|file_edit)$/i, 'Edit')
        .replace(/^(run_command|shell|exec)$/i, 'Bash')
        .replace(/^(search_files|grep)$/i, 'Grep')
        .replace(/^(find_files|glob)$/i, 'Glob');
      lines.push(`  - ${mapped}`);
    }
  } else {
    lines.push('allowed-tools:');
    lines.push('  - Read');
    lines.push('  - Write');
  }

  lines.push(`model: ${mapModel(meta.model)}`);
  lines.push('user-invocable: true');

  if (meta.trigger || meta.when_to_use) {
    lines.push('when_to_use: >');
    lines.push(`  ${meta.trigger || meta.when_to_use}`);
  }

  if (meta.arguments || meta['argument-hint']) {
    lines.push(`argument-hint: "${meta.arguments || meta['argument-hint']}"`);
  }

  lines.push('---');
  return lines.join('\n');
}

// === Migration Steps ===

function step1_detect() {
  log('\n=== Step 1: Detecting OpenClaw Installation ===');

  if (!fileExists(openclawDir)) {
    log(`\n  OpenClaw not found at: ${openclawDir}`);
    log('  To specify a custom path: --openclaw-dir /path/to/.openclaw');
    process.exit(1);
  }

  // Try to read config
  const configPath = path.join(openclawDir, 'openclaw.json');
  let config = {};
  const configContent = readFileSafe(configPath);
  if (configContent) {
    try {
      config = JSON.parse(stripJson5Comments(configContent));
      verbose('Parsed openclaw.json successfully');
    } catch (e) {
      warn(`Failed to parse openclaw.json: ${e.message}`);
    }
  }

  // Detect workspace
  let workspacePath = opts.workspace;
  if (!workspacePath) {
    // Try config, then common defaults
    workspacePath = config.workspace?.path
      || config.workspacePath
      || path.join(openclawDir, 'workspace');
    if (!fileExists(workspacePath)) {
      workspacePath = path.join(homeDir, '.openclaw', 'workspace');
    }
  }

  if (!fileExists(workspacePath)) {
    warn(`Workspace not found at: ${workspacePath}`);
    workspacePath = null;
  }

  // Count assets
  const sessionDir = path.join(openclawDir, 'sessions');
  const sessionCount = fileExists(sessionDir) ? fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl')).length : 0;

  const skillsDir = workspacePath ? path.join(workspacePath, 'skills') : null;
  const skillCount = skillsDir && fileExists(skillsDir) ? fs.readdirSync(skillsDir).filter(f => fileExists(path.join(skillsDir, f, 'SKILL.md'))).length : 0;

  const memoryLogDir = workspacePath ? path.join(workspacePath, 'memory') : null;
  const logCount = memoryLogDir && fileExists(memoryLogDir) ? fs.readdirSync(memoryLogDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).length : 0;

  log(`  Found OpenClaw at: ${openclawDir}`);
  log(`  Workspace: ${workspacePath || '(not found)'}`);
  log(`  Sessions: ${sessionCount} | Skills: ${skillCount} | Daily logs: ${logCount}`);

  return { config, workspacePath, sessionDir, skillsDir, memoryLogDir };
}

function step2_identity(ctx) {
  log('\n=== Step 2: Migrating Identity (SOUL.md → CLAUDE.md) ===');

  if (!ctx.workspacePath) {
    warn('No workspace found, skipping identity migration');
    return;
  }

  const soulPath = path.join(ctx.workspacePath, 'SOUL.md');
  const soulContent = readFileSafe(soulPath);
  if (!soulContent) {
    warn('SOUL.md not found, using default identity');
    return;
  }

  // Read current CLAUDE.md
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
  const currentClaudeMd = readFileSafe(claudeMdPath);
  if (!currentClaudeMd) {
    warn('CLAUDE.md not found in project');
    return;
  }

  // Extract personality from SOUL.md (skip frontmatter if present)
  const { body: soulBody } = parseFrontmatter(soulContent);
  const personalitySection = `\n## Personality (Migrated from OpenClaw)\n\n${soulBody.trim()}\n`;

  // Insert personality before "## Operating Rules"
  let newClaudeMd;
  if (currentClaudeMd.includes('## Operating Rules')) {
    newClaudeMd = currentClaudeMd.replace(
      '## Operating Rules',
      `${personalitySection}\n---\n\n## Operating Rules`
    );
  } else {
    // Append at end
    newClaudeMd = currentClaudeMd + '\n' + personalitySection;
  }

  if (!opts.merge && fileExists(claudeMdPath)) {
    // Check if already migrated
    if (currentClaudeMd.includes('Migrated from OpenClaw')) {
      log('  CLAUDE.md already contains OpenClaw personality, skipping (use --merge to overwrite)');
      return;
    }
  }

  writeFileSafe(claudeMdPath, newClaudeMd);
  stats.identity = true;
  log(`  Merged SOUL.md personality into CLAUDE.md`);
}

function step3_memory(ctx) {
  log('\n=== Step 3: Migrating Memory ===');

  if (!ctx.workspacePath) {
    warn('No workspace found, skipping memory migration');
    return;
  }

  // 3a: MEMORY.md → user-profile.md
  const memoryMdPath = path.join(ctx.workspacePath, 'MEMORY.md');
  const memoryContent = readFileSafe(memoryMdPath);
  if (memoryContent) {
    const profilePath = path.join(memoryDir, 'user-profile.md');
    const existingProfile = readFileSafe(profilePath) || '';

    if (existingProfile.includes('(not yet known)') || opts.merge) {
      // Fresh template or merge mode — inject knowledge
      const newProfile = `---
name: user-profile
description: User identity, preferences, and communication style
type: user
---

# User Profile

## Identity
- Name: (imported from OpenClaw)
- Role: (imported from OpenClaw)
- Timezone: (imported from OpenClaw)

## Preferences
- Language: (imported from OpenClaw)
- Communication style: (imported from OpenClaw)

## Knowledge Base (Migrated from OpenClaw MEMORY.md)

${memoryContent.trim()}
`;
      writeFileSafe(profilePath, newProfile);
      // Count non-empty lines as "facts"
      stats.memoryFacts = memoryContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
      log(`  Imported ${stats.memoryFacts} knowledge entries from MEMORY.md`);
    } else {
      log('  user-profile.md already populated, skipping (use --merge to overwrite)');
    }
  } else {
    verbose('No MEMORY.md found in workspace');
  }

  // 3b: Daily logs → archive/
  if (ctx.memoryLogDir && fileExists(ctx.memoryLogDir)) {
    const logFiles = fs.readdirSync(ctx.memoryLogDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .slice(-30); // Last 30 days

    for (const logFile of logFiles) {
      const src = path.join(ctx.memoryLogDir, logFile);
      const dest = path.join(archiveDir, logFile.replace('.md', '-learned.md'));

      if (fileExists(dest) && !opts.merge) {
        verbose(`Skipping existing: ${dest}`);
        continue;
      }

      const content = readFileSafe(src);
      if (content) {
        writeFileSafe(dest, content);
        stats.dailyLogs++;
      }
    }
    log(`  Migrated ${stats.dailyLogs} daily log files to memory/archive/`);
  }

  // 3c: SQLite vector DB (optional, requires sqlite3)
  const sqliteFiles = fileExists(path.join(openclawDir, 'memory'))
    ? fs.readdirSync(path.join(openclawDir, 'memory')).filter(f => f.endsWith('.sqlite'))
    : [];

  if (sqliteFiles.length > 0) {
    try {
      execSync('which sqlite3', { stdio: 'pipe' });
      const dbPath = path.join(openclawDir, 'memory', sqliteFiles[0]);
      const query = `SELECT text FROM chunks ORDER BY rowid DESC LIMIT 100;`;
      const result = execSync(`sqlite3 "${dbPath}" "${query}"`, { encoding: 'utf8', timeout: 10000 });

      if (result.trim()) {
        const kbPath = path.join(memoryDir, 'knowledge-base.md');
        const kbContent = `---
name: knowledge-base
description: Knowledge extracted from OpenClaw vector database
type: project
---

# Knowledge Base (Migrated from OpenClaw)

${result.trim().split('\n').slice(0, 100).map(l => `- ${l.slice(0, 200)}`).join('\n')}
`;
        writeFileSafe(kbPath, kbContent);
        log(`  Extracted ${Math.min(result.split('\n').length, 100)} entries from vector DB`);
      }
    } catch (e) {
      verbose('sqlite3 not available, skipping vector DB migration');
      stats.skipped.push('SQLite vector DB (sqlite3 CLI not found)');
    }
  }
}

function step4_skills(ctx) {
  log('\n=== Step 4: Migrating Skills ===');

  if (!ctx.skillsDir || !fileExists(ctx.skillsDir)) {
    warn('No skills directory found');
    return;
  }

  const skillDirs = fs.readdirSync(ctx.skillsDir)
    .filter(d => fileExists(path.join(ctx.skillsDir, d, 'SKILL.md')));

  for (const skillName of skillDirs) {
    const srcPath = path.join(ctx.skillsDir, skillName, 'SKILL.md');
    const destDir = path.join(claudeDir, 'skills', skillName);
    const destPath = path.join(destDir, 'SKILL.md');

    // Skip if already exists (unless --merge)
    if (fileExists(destPath) && !opts.merge) {
      verbose(`Skill ${skillName} already exists, skipping`);
      stats.skills.skipped++;
      continue;
    }

    const content = readFileSafe(srcPath);
    if (!content) continue;

    const { meta, body } = parseFrontmatter(content);

    // Transform frontmatter to Claude Code format
    const newFrontmatter = generateSkillFrontmatter({
      name: meta.name || skillName,
      description: meta.description || `Migrated skill: ${skillName}`,
      tools: meta.tools || meta['allowed-tools'] || [],
      model: meta.model,
      trigger: meta.trigger || meta.when_to_use,
      arguments: meta.arguments || meta['argument-hint'],
    });

    const newContent = `${newFrontmatter}\n\n${body.trim()}\n`;
    writeFileSafe(destPath, newContent);
    stats.skills.migrated++;
    stats.skills.names.push(skillName);
    verbose(`Migrated skill: ${skillName}`);
  }

  log(`  Migrated ${stats.skills.migrated} skills, skipped ${stats.skills.skipped}`);
}

function step5_agents(ctx) {
  log('\n=== Step 5: Migrating Agents (AGENTS.md) ===');

  if (!ctx.workspacePath) return;

  const agentsMdPath = path.join(ctx.workspacePath, 'AGENTS.md');
  const content = readFileSafe(agentsMdPath);
  if (!content) {
    verbose('No AGENTS.md found');
    return;
  }

  // Parse numbered workflows: ## 1. Name, ## 2. Name, etc.
  const sections = content.split(/^##\s+\d+\.\s+/m).filter(s => s.trim());

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const name = lines[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    if (!name || name.length < 2) continue;

    const destPath = path.join(claudeDir, 'agents', `${name}.md`);

    // Don't overwrite existing agents
    if (fileExists(destPath) && !opts.merge) {
      verbose(`Agent ${name} already exists, skipping`);
      continue;
    }

    const description = lines.slice(0, 3).join(' ').slice(0, 200);
    const body = lines.slice(1).join('\n').trim();

    const agentContent = `---
name: ${name}
description: >
  ${description} (Migrated from OpenClaw AGENTS.md)
tools:
  - Read
  - Write
  - WebSearch
  - WebFetch
  - Grep
  - Glob
model: sonnet
---

# ${lines[0].trim()}

${body}
`;

    writeFileSafe(destPath, agentContent);
    stats.agents++;
  }

  log(`  Migrated ${stats.agents} agent workflows`);
}

function step6_config(ctx) {
  log('\n=== Step 6: Migrating Configuration ===');

  // 6a: MCP server configs
  if (ctx.config && ctx.config.mcp) {
    const mcpJsonPath = path.join(projectDir, '.mcp.json');
    const existingMcp = JSON.parse(readFileSafe(mcpJsonPath) || '{"mcpServers":{}}');

    for (const [name, serverConfig] of Object.entries(ctx.config.mcp)) {
      if (!existingMcp.mcpServers[name]) {
        existingMcp.mcpServers[name] = serverConfig;
        stats.mcpServers++;
        verbose(`Added MCP server: ${name}`);
      }
    }

    if (stats.mcpServers > 0) {
      writeFileSafe(mcpJsonPath, JSON.stringify(existingMcp, null, 2) + '\n');
      log(`  Added ${stats.mcpServers} MCP server(s) to .mcp.json`);
    }
  }

  // 6b: Channel credentials → settings.local.json env vars
  const credDir = path.join(openclawDir, 'credentials');
  if (fileExists(credDir)) {
    const credFiles = fs.readdirSync(credDir);
    const envVars = {};

    for (const f of credFiles) {
      const content = readFileSafe(path.join(credDir, f));
      if (!content) continue;
      const name = f.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
      envVars[name] = '(migrated — update with actual value)';
      stats.credentials++;
      verbose(`Found credential: ${f} → ${name}`);
    }

    if (stats.credentials > 0) {
      log(`  Found ${stats.credentials} credential file(s) — manual setup required`);
      stats.skipped.push(`${stats.credentials} credential(s) need manual re-configuration`);
    }
  }
}

function step7_sessions(ctx) {
  log('\n=== Step 7: Migrating Recent Conversations ===');

  if (!ctx.sessionDir || !fileExists(ctx.sessionDir)) {
    verbose('No sessions directory found');
    return;
  }

  const sessionFiles = fs.readdirSync(ctx.sessionDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .slice(-10); // Last 10 sessions

  if (sessionFiles.length === 0) {
    verbose('No session files found');
    return;
  }

  const threads = [];
  const now = new Date();

  for (const sf of sessionFiles) {
    const content = readFileSafe(path.join(ctx.sessionDir, sf));
    if (!content) continue;

    const lines = content.trim().split('\n');
    const recentLines = lines.slice(-20); // Last 20 messages
    let lastUserMsg = '';
    let channel = 'terminal';
    let sender = 'user';
    let lastActivity = now.toISOString().slice(0, 16).replace('T', ' ');

    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === 'user' && entry.content) {
          lastUserMsg = (typeof entry.content === 'string' ? entry.content : '').slice(0, 100);
        }
        if (entry.channel) channel = entry.channel;
        if (entry.sender) sender = entry.sender;
        if (entry.timestamp) {
          lastActivity = new Date(entry.timestamp).toISOString().slice(0, 16).replace('T', ' ');
        }
      } catch (e) { /* skip malformed lines */ }
    }

    if (lastUserMsg) {
      threads.push({ channel, sender, lastActivity, lastMsg: lastUserMsg });
      stats.sessions++;
    }
  }

  if (threads.length > 0) {
    const threadsPath = path.join(memoryDir, 'active-threads.md');
    const existing = readFileSafe(threadsPath) || '';

    if (existing.includes('No active threads yet') || opts.merge) {
      let content = `---
name: active-threads
description: Currently active conversation threads across channels
type: project
---

# Active Conversation Threads

<!-- Migrated from OpenClaw sessions on ${now.toISOString().slice(0, 10)} -->

`;
      for (const t of threads) {
        content += `## [${t.channel}] ${t.sender}
- **Last activity**: ${t.lastActivity}
- **Status**: migrated
- **Latest**: ${t.lastMsg}

`;
      }

      writeFileSafe(threadsPath, content);
      log(`  Summarized ${stats.sessions} recent sessions into active-threads.md`);
    } else {
      log('  active-threads.md already has content, skipping (use --merge)');
    }
  }
}

function step8_rules(ctx) {
  log('\n=== Step 8: Migrating Tool Conventions & Security ===');

  if (!ctx.workspacePath) return;

  // TOOLS.md → tool-conventions.md
  const toolsPath = path.join(ctx.workspacePath, 'TOOLS.md');
  const toolsContent = readFileSafe(toolsPath);
  if (toolsContent) {
    const destPath = path.join(claudeDir, 'rules', 'tool-conventions.md');
    if (!fileExists(destPath) || opts.merge) {
      const ruleContent = `---
description: Tool usage conventions migrated from OpenClaw TOOLS.md
globs: []
alwaysApply: true
---

# Tool Conventions (Migrated from OpenClaw)

${toolsContent.trim()}
`;
      writeFileSafe(destPath, ruleContent);
      stats.rules++;
      log('  Migrated TOOLS.md → .claude/rules/tool-conventions.md');
    }
  }

  // SHIELD.md → security-policy.md
  const shieldPath = path.join(ctx.workspacePath, 'SHIELD.md');
  const shieldContent = readFileSafe(shieldPath);
  if (shieldContent) {
    const destPath = path.join(claudeDir, 'rules', 'security-policy.md');
    if (!fileExists(destPath) || opts.merge) {
      const ruleContent = `---
description: Security policies migrated from OpenClaw SHIELD.md
globs: []
alwaysApply: true
---

# Security Policy (Migrated from OpenClaw)

${shieldContent.trim()}
`;
      writeFileSafe(destPath, ruleContent);
      stats.rules++;
      log('  Migrated SHIELD.md → .claude/rules/security-policy.md');
    }
  }
}

function step9_report() {
  log('\n=== Step 9: Migration Report ===');

  const now = new Date().toISOString().slice(0, 10);
  const report = `# OpenClaw → Claude-Agent Migration Report

**Date**: ${now}
**Source**: ${openclawDir}
**Mode**: ${opts.dryRun ? 'DRY RUN (no changes made)' : 'Live migration'}

## Migrated

| Component | Count | Details |
|-----------|-------|---------|
| Identity (SOUL.md) | ${stats.identity ? '1' : '0'} | ${stats.identity ? 'Personality merged into CLAUDE.md' : 'Skipped'} |
| Memory facts | ${stats.memoryFacts} | From MEMORY.md |
| Daily logs | ${stats.dailyLogs} | Copied to memory/archive/ |
| Skills | ${stats.skills.migrated} | ${stats.skills.names.join(', ') || 'None'} |
| Agents | ${stats.agents} | From AGENTS.md workflows |
| Rules | ${stats.rules} | TOOLS.md, SHIELD.md |
| MCP servers | ${stats.mcpServers} | Added to .mcp.json |
| Sessions | ${stats.sessions} | Summarized to active-threads.md |

## Skipped / Manual Action Required

${stats.skipped.length > 0 ? stats.skipped.map(s => `- ${s}`).join('\n') : '- None'}

## Errors

${stats.errors.length > 0 ? stats.errors.map(e => `- ${e}`).join('\n') : '- None'}

## Next Steps

1. **Start Claude Code**: \`cd ${projectDir} && claude\`
2. **Verify memory**: Say "good morning" to check if your profile loaded
3. **Check skills**: Run \`/context-health\` to see what's available
4. **Set up channels**: Re-configure Telegram/Discord tokens if needed
5. **Review migrated skills**: Check .claude/skills/ for adapted skill files
`;

  const reportPath = path.join(projectDir, 'workspace', 'migration-report.md');
  writeFileSafe(reportPath, report);
  log(`\n  Report saved to: workspace/migration-report.md`);
  log(report);
}

// === Main ===
function main() {
  log('╔══════════════════════════════════════════════════════╗');
  log('║  OpenClaw → Claude-Agent Migration                  ║');
  log('╚══════════════════════════════════════════════════════╝');

  if (opts.dryRun) {
    log('\n  [DRY RUN MODE — no changes will be made]\n');
  }

  const ctx = step1_detect();
  step2_identity(ctx);
  step3_memory(ctx);
  step4_skills(ctx);
  step5_agents(ctx);
  step6_config(ctx);
  step7_sessions(ctx);
  step8_rules(ctx);
  step9_report();

  log('\n  Migration complete!');
}

main();
