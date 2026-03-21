---
description: Rules for autonomous memory management
globs: []
alwaysApply: true
---

# Memory Management Policy

## What to Save

### Always Save
- User's name, role, preferences, timezone
- Explicit requests: "remember that...", "note that..."
- Decisions made during conversations
- Task assignments and deadlines
- Contact information mentioned
- User's communication style preferences

### Save if Repeated
- Topics the user frequently asks about
- Patterns in user behavior (e.g., always asks for coffee recommendations)
- Preferred tools, services, or platforms

### Never Save
- Sensitive credentials, passwords, API keys
- Temporary debugging information
- Raw tool outputs or error logs
- Information already in files the user can access

## How to Save

1. **Incremental updates**: Edit existing memory files, don't rewrite them
2. **Structured format**: Use markdown headers and bullet points
3. **Timestamped**: Include date when saving time-sensitive information
4. **Concise**: One fact = one line. No verbose descriptions.

## Memory File Responsibilities

| File | Contents | Update Frequency |
|------|----------|-----------------|
| `user-profile.md` | Identity, preferences, style | On new info |
| `active-threads.md` | Current conversations | Every exchange |
| `pending-tasks.md` | Tasks, reminders | On task changes |
| `learned-today.md` | Daily learnings | During session |
| `contacts.md` | People mentioned | On new contacts |
| `MEMORY.md` | Index of all files | By memory-manager |

## Archival Rules
- `learned-today.md` → archived daily to `archive/YYYY-MM-DD-learned.md`
- `active-threads.md` entries older than 24h with no activity → archived
- Archive files older than 30 days → deleted by memory-manager
