---
name: migrate-openclaw
description: >
  One-click migration from OpenClaw to Claude-Agent. Reads ~/.openclaw/
  and imports memory, skills, agents, conversations, and configuration.
  Preserves your assistant's personality, knowledge, and customizations.
  Use when user says "migrate from openclaw", "import openclaw data",
  "switch from openclaw", or "I'm coming from openclaw".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
model: sonnet
user-invocable: true
when_to_use: >
  When user wants to migrate from OpenClaw to Claude-Agent,
  import their OpenClaw data, or switch from OpenClaw.
argument-hint: "[--openclaw-dir <path>] [--dry-run] [--merge]"
---

# Migrate from OpenClaw

You are the OpenClaw migration skill for Claude-Agent. Help the user migrate their data from OpenClaw to Claude-Agent with a smooth, guided experience.

## Prerequisites

The migration script is at `scripts/migrate-openclaw.cjs` (Node.js, zero dependencies).

## Steps

### 1. Check OpenClaw Installation

First, check if OpenClaw is installed:
```bash
ls -la ~/.openclaw/ 2>/dev/null
```

If not found, ask the user for the path:
- "Where is your OpenClaw installation? (default: ~/.openclaw/)"
- If they provide a path, use `--openclaw-dir <path>`

### 2. Preview Migration (Dry Run)

Run the migration script in dry-run mode to show what will be migrated:
```bash
node scripts/migrate-openclaw.cjs --dry-run --verbose
```

Present the summary to the user:
- How many skills, agents, memory entries will be migrated
- What will be skipped
- Any manual actions required

### 3. Confirm with User

Ask the user to confirm:
- "Ready to migrate? This will import your OpenClaw data into Claude-Agent."
- "Your existing Claude-Agent data will be preserved (new data is added alongside it)."
- "Use --merge to overwrite existing data if you want to re-run the migration."

### 4. Run Migration

Execute the full migration:
```bash
node scripts/migrate-openclaw.cjs --verbose
```

If the user wants to merge with existing data:
```bash
node scripts/migrate-openclaw.cjs --merge --verbose
```

### 5. Read and Present Report

After migration, read the report:
```bash
cat workspace/migration-report.md
```

Present a friendly summary:
- What was successfully migrated
- What needs manual attention
- Next steps

### 6. Verify

Run a quick verification:
- Check memory files are populated: `ls memory/`
- Check skills were added: `ls .claude/skills/`
- Check CLAUDE.md was updated: `grep "OpenClaw" CLAUDE.md`

### 7. Welcome Message

End with a warm welcome:

```
Welcome to Claude-Agent! Your OpenClaw data has been imported.

What was migrated:
- Your personality (SOUL.md → CLAUDE.md)
- Your knowledge base (MEMORY.md → memory/)
- Your skills (N skills adapted to Claude Code format)
- Your workflows (AGENTS.md → individual agents)
- Your recent conversations (summarized)

What you might want to do next:
- Say "good morning" for a briefing with your imported data
- Run /context-health to see everything loaded properly
- Try your migrated skills to see them in action

Your assistant is ready. How can I help?
```

## Fallback

If the migration script fails:
1. Read the error output carefully
2. Common issues:
   - Permission denied → `chmod +x scripts/migrate-openclaw.cjs`
   - OpenClaw path wrong → ask user for correct path
   - JSON parse error → OpenClaw config may use unsupported JSON5 features
3. Offer to migrate components individually (memory only, skills only, etc.)

## Rules
- Always run dry-run first to preview
- Never overwrite existing data without --merge flag
- Never copy credentials directly — note them for manual re-configuration
- Keep the conversation friendly — this is someone switching their daily assistant
