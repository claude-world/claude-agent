---
name: apple-notes
description: >
  Manage macOS Apple Notes via the memo CLI — create, view, edit, delete, search,
  move, and export notes across folders. Use when user says "add note", "find note",
  "show my notes", "create note about...", or "export note".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to create, read, search, edit, or manage Apple Notes on macOS.
  Triggers: "add a note", "create note", "find note about...", "show notes",
  "edit note", "delete note", "export note", "move note to folder".
argument-hint: "<action: list|create|view|edit|delete|search|move|export> <details>"
---

# Apple Notes

Manage native macOS Apple Notes using the `memo` CLI. macOS only.

## Prerequisites

```bash
brew install antoniorodr/memo/memo
```

After install, grant Notes access when macOS prompts. If not prompted:
System Settings → Privacy & Security → Contacts/Notes → allow Terminal.

## Commands

| Command | Description |
|---------|-------------|
| `memo list` | List all notes (title + folder) |
| `memo list --folder "<Folder>"` | List notes in a specific folder |
| `memo create "<Title>" --body "<Content>"` | Create a new note |
| `memo view "<Title>"` | View note content |
| `memo edit "<Title>" --body "<New Content>"` | Replace note body |
| `memo delete "<Title>"` | Delete a note |
| `memo search "<Query>"` | Search notes by content |
| `memo move "<Title>" --folder "<Destination>"` | Move note to a folder |
| `memo export "<Title>" --format md` | Export note as Markdown |

## Usage Examples

**Create a quick note:**
```bash
memo create "Meeting notes 2026-03-21" --body "Discussed Q2 roadmap. Next steps: draft proposal."
```

**Search for a note:**
```bash
memo search "quarterly roadmap"
```

**View a specific note:**
```bash
memo view "Meeting notes 2026-03-21"
```

**Export as Markdown to a file:**
```bash
memo export "Meeting notes 2026-03-21" --format md > workspace/meeting-notes.md
```

**Move note to a folder:**
```bash
memo move "Meeting notes 2026-03-21" --folder "Work"
```

## Rules

- Always check if CLI is installed first: `which memo`
- If not installed, show the brew install command and stop
- macOS only — if not on macOS, inform the user and stop
- When creating notes with multi-line content, write content to a temp file and pipe it, or use heredoc via Bash
- When viewing long notes, save to `workspace/note-<slug>.md` and summarize inline rather than dumping full content
- Search is case-insensitive; use concise query terms
- Keep output concise: confirm action taken in one line
- If a title is ambiguous, run `memo list` first and ask the user to clarify
