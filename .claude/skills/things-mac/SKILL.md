---
name: things-mac
description: >
  Add and manage tasks in Things 3 on macOS using URL schemes and the things-cli.
  Use when user says "add to Things", "show Things inbox", "what's due in Things today",
  or "search Things tasks".
allowed-tools:
  - Bash
model: haiku
user-invocable: true
when_to_use: >
  When user wants to interact with the Things 3 task manager on macOS.
  Triggers: "add to Things", "add task to Things 3", "show Things today",
  "what's in my Things inbox", "search Things for...", "Things tasks due today".
argument-hint: "<action: add|inbox|today|search|upcoming|logbook> <details>"
---

# Things 3 (macOS)

Manage Things 3 tasks using URL schemes (built-in) and `things-cli` (optional).
Requires Things 3 app installed from the Mac App Store.

## Prerequisites

**Things 3** must be installed: https://culturedcode.com/things/

**Option 1: URL scheme (no install, built-in)**
```bash
open "things:///add?title=<Task Name>"
```

**Option 2: things-cli for richer scripting:**
```bash
npm install -g things-cli
```

Verify:
```bash
things --version
```

## Commands

### URL Scheme (works without any CLI install)

```bash
# Add a task to Inbox
open "things:///add?title=Buy+groceries"

# Add with notes and due date
open "things:///add?title=Submit+report&notes=Include+Q1+data&deadline=2026-03-25"

# Add to a specific list/project
open "things:///add?title=Write+tests&list=Work"

# Add with tags
open "things:///add?title=Review+PR&tags=code,review"

# Add to Today
open "things:///add?title=Call+Alice&when=today"

# Show the Today list
open "things:///show?id=today"

# Show Inbox
open "things:///show?id=inbox"

# Show Upcoming
open "things:///show?id=upcoming"
```

### things-cli (if installed)

| Command | Description |
|---------|-------------|
| `things inbox` | List inbox tasks |
| `things today` | List today's tasks |
| `things upcoming` | List upcoming tasks |
| `things search "<query>"` | Search tasks |
| `things add "<title>"` | Add a task to inbox |
| `things logbook` | View completed tasks |

## Usage Examples

**Add a task with deadline:**
```bash
open "things:///add?title=File+taxes&deadline=2026-04-15&notes=Use+last+year+as+reference"
```

**Show today's tasks (opens Things app):**
```bash
open "things:///show?id=today"
```

**Add task to a project:**
```bash
open "things:///add?title=Write+unit+tests&list=My+Project&tags=dev"
```

**List today's tasks via CLI (if installed):**
```bash
things today
```

**Search for a task:**
```bash
things search "quarterly report"
```

## Rules

- Always check that Things 3 is installed: `ls /Applications/Things3.app 2>/dev/null || ls "$HOME/Applications/Things3.app" 2>/dev/null`
- If not installed, direct user to https://culturedcode.com/things/ and stop
- URL scheme works without `things-cli` — always try URL scheme first
- URL-encode all parameter values: spaces → `+`, special chars → `%XX`
- The `open` command launches the Things app and adds/shows the item
- When using URL scheme, Things 3 must be running or it will open automatically
- Default destination for new tasks is Inbox unless user specifies a list or `when=today`
- For reading/listing tasks, prefer `things-cli` if installed; if not, use `open` to show the relevant list in the app
- Keep responses concise: confirm "Added to Things: <task title>" in one line
