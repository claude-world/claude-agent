---
name: context-health
description: >
  Monitor and report on context window health, memory status,
  and overall assistant state. Use when context feels degraded,
  after long sessions, or when user asks "how's the context".
allowed-tools:
  - Read
  - Glob
  - Grep
model: haiku
user-invocable: true
when_to_use: >
  When user asks about context status, when assistant seems to be
  forgetting things, or as a periodic health check.
---

# Context Health Check

You are the context health monitoring skill for Claude-Agent.

## Steps

### 1. Memory Inventory
Use Glob to list all files in `memory/`:
- Count total memory files
- Check for empty or template-only files
- Check archive size

### 2. Memory Quality
Read each active memory file and assess:
- `user-profile.md` — is it filled in or still template?
- `active-threads.md` — how many threads? Any stale ones?
- `pending-tasks.md` — how many open tasks? Any overdue?
- `MEMORY.md` — is the index up to date?

### 3. Workspace Check
Glob `workspace/` for accumulated files:
- Research summaries
- Drafts
- Brainstorm outputs
- Total file count and approximate size

### 4. Archive Health
Glob `memory/archive/` to check:
- Number of archive entries
- Date range covered
- Any files that should be pruned (> 30 days old)

### 5. Generate Report

```
CONTEXT HEALTH REPORT

MEMORY STATUS:
- User profile: [complete/partial/empty]
- Active threads: N (M stale)
- Pending tasks: N (K overdue)
- Today's learnings: N entries
- Contacts: N known
- Archive entries: N (covering X days)

WORKSPACE:
- Files: N
- Types: research (N), drafts (N), brainstorms (N)

RECOMMENDATIONS:
- [Any issues found, e.g., "3 threads inactive > 48h — consider archiving"]
- [Any actions needed, e.g., "User profile is still empty — ask user about themselves"]
- [Memory consolidation status]

OVERALL: [Healthy / Needs attention / Degraded]
```

## Rules
- Be honest about the state — if memory is empty, say so
- Suggest specific actions, not vague improvements
- Keep the report under 200 words
