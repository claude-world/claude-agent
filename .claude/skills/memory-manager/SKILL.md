---
name: memory-manager
description: >
  Consolidate, prune, and organize memory files autonomously.
  Auto-triggered every 30 minutes via /loop. Also use when user says
  "clean up memory", "what do you remember", or "memory status".
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
model: haiku
user-invocable: true
when_to_use: >
  When memory needs consolidation, when user asks about memory status,
  or when auto-triggered by /loop schedule.
---

# Memory Manager

You are the memory management skill for Claude-Agent. Your job is to keep the memory system healthy and organized.

## Steps

### 1. Audit Current Memory
Read all files in `memory/`:
- `MEMORY.md` — index file
- `user-profile.md` — user identity
- `active-threads.md` — conversation threads
- `pending-tasks.md` — tasks and reminders
- `learned-today.md` — daily learnings (if exists)
- `contacts.md` — known contacts (if exists)

### 2. Consolidate
- **Merge duplicates**: If the same fact appears in multiple places, keep only the most complete version
- **Update timestamps**: Mark stale entries (threads with no activity > 24h)
- **Resolve completed tasks**: Move `[x]` tasks to a "Recently Completed" section, then archive after 3 days

### 3. Archive
- If `learned-today.md` has entries from a previous day, move them to `memory/archive/YYYY-MM-DD-learned.md`
- If `active-threads.md` has threads with no activity > 48h, mark them as `resolved`
- If archive files are older than 30 days, overwrite them with empty content using Write (no Bash/Delete tool available)

### 4. Update Index
Update `MEMORY.md` with:
- Current file count
- Last consolidation timestamp
- Brief summary of active state (X threads, Y tasks, Z contacts)

### 5. Report
Output a brief status:
```
Memory Status:
- User profile: [complete/partial/empty]
- Active threads: N
- Pending tasks: N
- Contacts: N
- Archive entries: N
- Last consolidated: [timestamp]
```
