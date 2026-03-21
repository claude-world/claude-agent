---
name: apple-reminders
description: >
  Manage macOS Apple Reminders via the remindctl CLI — list, add, edit, complete,
  and delete reminders across all reminder lists. Use when user says "remind me",
  "add to reminders", "show my reminders", "mark reminder done", or "delete reminder".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to create, view, complete, or delete Apple Reminders on macOS.
  Triggers: "remind me to...", "add reminder", "show reminders", "what are my reminders",
  "mark done", "complete reminder", "delete reminder".
argument-hint: "<action: list|add|complete|delete|edit> <details>"
---

# Apple Reminders

Manage native macOS Apple Reminders using the `remindctl` CLI. macOS only.

## Prerequisites

```bash
brew install steipete/tap/remindctl
```

After install, grant Reminders access when macOS prompts. If not prompted:
System Settings → Privacy & Security → Reminders → allow Terminal.

## Commands

| Command | Description |
|---------|-------------|
| `remindctl list` | List all reminder lists |
| `remindctl list "<List Name>"` | Show reminders in a specific list |
| `remindctl add "<List>" "<Title>" [--due "YYYY-MM-DD HH:MM"]` | Add a reminder |
| `remindctl complete "<List>" "<Title>"` | Mark a reminder as complete |
| `remindctl delete "<List>" "<Title>"` | Delete a reminder |
| `remindctl edit "<List>" "<Title>" --title "<New Title>"` | Rename a reminder |

## Usage Examples

**List today's reminders:**
```bash
remindctl list "Reminders"
```

**Add a reminder with due date:**
```bash
remindctl add "Reminders" "Call dentist" --due "2026-03-25 10:00"
```

**Complete a reminder:**
```bash
remindctl complete "Reminders" "Call dentist"
```

**Add to a custom list:**
```bash
remindctl add "Work" "Submit report by EOD"
```

## Rules

- Always check if CLI is installed first: `which remindctl`
- If not installed, show the brew install command and stop
- macOS only — if not on macOS, inform the user and stop
- When listing, default to the "Reminders" list unless user specifies another
- When adding without a due date, add without `--due` flag
- Parse natural language times (e.g., "tomorrow at 9am") into `YYYY-MM-DD HH:MM` format before passing to CLI
- Keep output concise: confirm action taken in one line
- If a list name is ambiguous, run `remindctl list` first to show available lists
