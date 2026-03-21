---
name: session-logs
description: >
  Search and analyze past Claude Code session logs using jq and ripgrep (rg).
  Find conversations by date, keyword, or topic. Extract decisions, code changes,
  and key moments from session history. Use when user says "search past sessions",
  "what did we discuss about X", "find old conversation", or "session history".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to find or review past conversation sessions, search for a
  previously discussed topic, or analyze session history. Triggers: "search past
  sessions", "find conversation about", "what did we discuss", "session history",
  "past logs", "previous conversation", "find when we talked about".
argument-hint: "<action: list|search|view|analyze> [query] [--date YYYY-MM-DD] [--limit N]"
---

# Session Logs

Search and analyze past Claude Code session and conversation logs using `jq` and `rg`
(ripgrep). No external CLI beyond `jq` and `rg` needed.

## Prerequisites

```bash
# Install jq (JSON processor)
brew install jq          # macOS
sudo apt install jq      # Ubuntu/Debian

# Install ripgrep
brew install ripgrep     # macOS
sudo apt install ripgrep # Ubuntu/Debian

# Verify
jq --version && rg --version
```

## Common Log Locations

| Location | Description |
|----------|-------------|
| `~/.claude/` | Claude Code settings and memory |
| `~/.claude/projects/` | Per-project session data |
| `workspace/` | Saved session outputs |
| `memory/` | Agent memory files |

## Commands

**List recent session files:**
```bash
ls -lt ~/.claude/projects/ | head -20
```

**Search session logs by keyword:**
```bash
rg "keyword" ~/.claude/projects/ --type json -l
```

**Search with context lines:**
```bash
rg -C 3 "keyword" ~/.claude/projects/ --type json
```

**Search memory files:**
```bash
rg "topic" memory/ -l
rg -i "topic" memory/learned-today.md
```

**Parse JSONL session file:**
```bash
# Show all user messages from a session file
cat <session-file.jsonl> | jq -r 'select(.role=="user") | .content'

# Show assistant messages
cat <session-file.jsonl> | jq -r 'select(.role=="assistant") | .content[:200]'

# Extract tool uses
cat <session-file.jsonl> | jq -r 'select(.type=="tool_use") | {name, input}'
```

**Search by date range:**
```bash
# Find files modified in the last 7 days
find ~/.claude/projects/ -name "*.json" -newer $(date -d "7 days ago" +%Y-%m-%d 2>/dev/null || date -v-7d +%Y-%m-%d) 2>/dev/null

# macOS: files from today
find ~/.claude/projects/ -name "*.json" -newer $(date -v-1d +%Y-%m-%d)
```

**Search workspace saved outputs:**
```bash
rg -i "keyword" workspace/ -l
rg -i -C 2 "keyword" workspace/
```

**Analyze memory for a topic:**
```bash
rg -i "keyword" memory/ --type md
```

## Usage Examples

**Find past discussion about a feature:**
```bash
rg -i "authentication" memory/ workspace/ --type md -l
```

**Search all session files for a decision:**
```bash
rg -i "decided to use" ~/.claude/projects/ --type json -C 2 | head -40
```

**Extract key points from a session file:**
```bash
# Summarize assistant responses from a specific session
jq -r 'select(.role=="assistant") | .content' <session.jsonl> | head -100
```

**Review today's memory learnings:**
```bash
cat memory/learned-today.md
```

## Rules

- Always check if `jq` and `rg` are installed first before running searches
- If not installed, show the install commands and stop
- Never read or expose raw API keys, tokens, or credentials found in logs
- Redact sensitive patterns (tokens, passwords, API keys) before showing output
- Default to searching `memory/` and `workspace/` first (faster); escalate to `~/.claude/projects/` if needed
- When results are large, save to `workspace/session-search-<query>.md` and summarize inline
- Limit inline output to 20-30 lines; always offer to save full results to workspace
- Confirm searches with: "Found <N> matches for '<query>'"
