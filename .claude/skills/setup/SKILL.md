---
name: setup
description: >
  Interactive onboarding for new users. Detects your environment, checks
  installed CLI tools, configures your profile, enables scheduled routines,
  and shows available skills. Run this once after cloning the project.
  Use when user says "setup", "get started", "initialize", "first time",
  or on first session when memory is empty.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
model: sonnet
user-invocable: true
when_to_use: >
  When user first starts claude-agent, says "setup", "get started",
  "help me configure", or when memory/user-profile.md is still empty.
argument-hint: "[--skip-checks] [--minimal]"
---

# Setup — First-Time Configuration

Welcome new users and configure claude-agent for their environment.

## Steps

### 1. Welcome & Detect Environment

```bash
# Detect OS and shell
uname -s  # Darwin / Linux
echo $SHELL
node --version
```

Present:
```
Welcome to Claude-Agent!

I'll help you set up in ~2 minutes. Here's what we'll do:
1. Learn about you (name, timezone, preferences)
2. Check which tools you have installed
3. Enable the skills that work on your system
4. Set up scheduled routines (optional)
5. Show you what's available

Detected: macOS / Linux | Node vX | zsh/bash
```

### 2. User Profile

Ask these questions and save to `memory/user-profile.md`:

- "What should I call you?"
- "What timezone are you in?" (auto-detect: `date +%Z`)
- "What language do you prefer?" (zh-TW / en / ja / other)
- "What's your role?" (developer / designer / PM / student / other)
- "What topics interest you most?" (for daily briefing & trend scout)

Update `memory/user-profile.md` with the answers.

### 3. Tool Inventory

Check which CLI tools are installed and categorize available skills:

```bash
# Check each tool — fast parallel checks
for cmd in gh himalaya gogcli memo remindctl things grizzly obsidian-cli \
  spogo spotify_player sonos openhue eightctl camsnap ffmpeg \
  whisper imsg wacli xurl op peekaboo jq rg nano-pdf gifgrep curl uvx; do
  which $cmd 2>/dev/null && echo "FOUND: $cmd" || echo "MISSING: $cmd"
done
```

Present results grouped:

```
Tool Inventory:

READY (installed):
  gh          → /github-ops, /gh-issues
  himalaya    → /email
  ffmpeg      → /video-extract
  curl        → /weather, /quick-research (always available)
  jq          → /session-logs
  rg          → /session-logs

NOT INSTALLED (skills available after install):
  gogcli      → /google-workspace    (brew install steipete/tap/gogcli)
  grizzly     → /bear-notes          (go install github.com/tylerwince/grizzly/cmd/grizzly@latest)
  spogo       → /spotify             (cargo install spogo)
  openhue     → /hue-lights          (brew install openhue)
  ...

NO INSTALL NEEDED (always available):
  /memory-manager  /task-tracker  /daily-briefing  /brainstorm
  /draft-message   /quick-research  /summarize  /context-health
  /weather  /security-audit  /skill-creator
```

### 4. MCP Server Status

Check which MCP servers are responding:

```bash
# Verify MCP servers in .mcp.json
cat .mcp.json | python3 -c "import json,sys; [print(k) for k in json.load(sys.stdin)['mcpServers']]"
```

Present:
```
MCP Servers:

  trend-pulse    (zero-auth)  → /trend-scout, /content-creator
  claude-101     (zero-auth)  → 27 template tools
  cf-browser     (needs CF credentials)  → /deep-read
  notebooklm     (needs Google login)    → /podcast-maker, /content-creator with-image

Setup instructions for optional servers:
  cf-browser:  export CF_ACCOUNT_ID="..." CF_API_TOKEN="..." in ~/.zshrc
  notebooklm:  uvx notebooklm login (one-time browser sign-in)
```

### 5. Scheduled Routines

Ask if user wants recurring tasks:

```
Would you like to set up any recurring routines?

1. Memory consolidation — every few hours (recommended)
2. Daily briefing — every morning at a specific time
3. RSS feed check — periodic blog/news monitoring
4. Skip — set up later

Which ones? (1,2,3 or skip)
```

If user selects options, explain how to use `/loop`:
- Memory: `/loop 3h /memory-manager`
- Briefing: Explain the user can say "good morning" or set a reminder
- RSS: `/loop 1h /rss-monitor`

### 6. Quick Tour

Show a categorized skill summary based on what's available:

```
Your Claude-Agent is ready! Here's what you can do:

CORE (always available):
  "Good morning"           → daily briefing with your tasks & news
  "Remind me to X at Y"   → task tracking with reminders
  "Research X"             → web research with summary
  "Summarize <URL>"        → condense any article
  "Brainstorm about X"     → structured ideation
  "What do you remember?"  → check your memory

CONTENT (MCP-powered):
  "What's trending?"       → 20 free trend sources
  "Create a post about X"  → patent-scored social content
  "Make a podcast about X" → AI podcast via NotebookLM

INSTALLED ON YOUR SYSTEM:
  [list only skills with installed CLI tools]

MESSAGING:
  [list available messaging skills]

Type any of these naturally — I'll route to the right skill.
Run /context-health anytime to check system status.
```

### 7. Save Setup State

Write a marker to avoid re-prompting:

```
# In memory/user-profile.md, add:
## Setup
- Setup completed: YYYY-MM-DD
- OS: macOS/Linux
- Installed tools: [list]
- MCP servers: [list]
- Scheduled routines: [list or "none"]
```

## Rules
- Be friendly and conversational — this is the first impression
- Don't overwhelm — show what's relevant to their system
- Skip tool checks if --skip-checks flag is set
- Minimal mode (--minimal): just ask name/timezone, skip tool inventory
- If user is migrating from OpenClaw, suggest `/migrate-openclaw` first
- Save everything to memory immediately — don't wait
