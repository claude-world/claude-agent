---
name: bear-notes
description: >
  Create, search, and manage Bear notes via the grizzly CLI.
  Use when user says "add a bear note", "search bear notes",
  "list my notes in bear", "open bear note about X".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to create, search, read, or manage notes in the
  Bear app (macOS/iOS). Requires Bear app installed.
argument-hint: "<action: create|search|list|read> <content or query>"
---

# Bear Notes

Manage Bear app notes via the `grizzly` CLI.

## Prerequisites

```bash
go install github.com/tylerwince/grizzly/cmd/grizzly@latest
```

Requires Bear app installed on macOS.

## Commands

| Command | Purpose |
|---------|---------|
| `grizzly list` | List all notes |
| `grizzly list --tag work` | List notes with tag |
| `grizzly search "query"` | Search note content |
| `grizzly read "Note Title"` | Read a specific note |
| `grizzly create --title "T" --body "B" --tag "t"` | Create note |
| `grizzly trash "Note Title"` | Move note to trash |

Alternative (no CLI install — use Bear URL scheme):
```bash
# Create note via URL scheme
open "bear://x-callback-url/create?title=Title&text=Body&tags=tag1,tag2"

# Search
open "bear://x-callback-url/search?term=query"

# Open note
open "bear://x-callback-url/open-note?title=Note%20Title"
```

## Usage Examples

- `/bear-notes create "Meeting Notes" "Discussed Q3 roadmap" --tag meetings`
- `/bear-notes search "project plan"`
- `/bear-notes list --tag work`

## Rules
- Check if `grizzly` is installed: `which grizzly`
- If not installed, fall back to Bear URL scheme (`open bear://...`)
- macOS only
- Keep note content concise unless user specifies otherwise
- Use tags for organization (Bear's strength is tagging)
