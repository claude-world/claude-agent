# Claude-Agent

> Turn Claude Code into a persistent personal assistant with autonomous memory, multi-channel support, and intelligent task delegation.

Claude-Agent is a ready-to-use [Claude Code](https://docs.anthropic.com/en/docs/claude-code) project that transforms Claude into a long-running personal assistant. It receives messages from multiple channels (Telegram, Discord, webhooks, terminal), remembers context across sessions, and delegates complex tasks to specialist agents — all within Claude Code's native architecture.

## Features

| Category | What |
|----------|------|
| **49 Skills** | Productivity, smart home, media, messaging, security — full [OpenClaw](https://github.com/openclaw/openclaw) feature parity |
| **4 Use Methods** | CLI, Web UI (localhost:3456), Desktop App (.dmg/.exe), Telegram/Discord |
| **12-Page Control Panel** | Chat, History, Projects, Skills, Agents, Memory, MCP, Secrets, Schedule, Config Bot, Settings, Channels |
| **Scheduled Tasks** | Cron-based agent scheduling with execution history and manual trigger |
| **Project Discussion** | Multi-expert roundtable, debate, relay modes with streaming + Markdown output |
| **4 Agents** | researcher, writer, analyst, content-publisher (import/export/create with AI) |
| **Persistent Memory** | Autonomous markdown-based memory surviving compaction and restarts |
| **4 MCP Servers** | trend-pulse, claude-101, cf-browser, notebooklm (66 tools) |
| **CLI Detection** | Auto-detects claude, codex, gemini, opencode, node, uvx, gh |
| **Content Pipeline** | Trend discovery → patent-scored posts → NotebookLM image cards / podcasts |
| **4 Lifecycle Hooks** | Session bootstrap, message classifier, context guardian, session farewell |
| **i18n** | English, 繁體中文, 日本語 — all 12 pages fully translated |
| **OpenClaw Migration** | One-click import of memory, skills, agents, config |
| **Desktop App** | Electron packaging for macOS (.dmg), Windows (.exe), Linux (.AppImage) |

## Architecture

```
claude-agent/
├── .claude/
│   ├── settings.json            Hook configuration + env vars
│   ├── hooks/ (4)               Session lifecycle (Node.js)
│   ├── agents/ (4)              researcher, writer, analyst, content-publisher
│   ├── skills/ (49)             7 categories — see Skills Reference below
│   └── rules/ (4)               memory, channels, MCP, content quality
├── app/                         Web UI + Desktop App + Bridges
│   ├── server/
│   │   ├── index.ts             Express + WebSocket (port 3456)
│   │   ├── agent.ts             Claude Code SDK wrapper
│   │   ├── db.ts                SQLite (sessions, messages, settings, channels, tasks)
│   │   ├── scheduler.ts         Cron task scheduler (node-cron)
│   │   ├── discussion.ts        Multi-expert discussion engine
│   │   ├── telegram.ts          Built-in Telegram bridge
│   │   └── discord.ts           Built-in Discord bridge
│   ├── client/
│   │   ├── App.tsx              React 18 + Tailwind (12 pages)
│   │   ├── i18n.ts              Translations (en, zh-TW, ja)
│   │   └── components/ (12)     Chat, History, Projects, Skills, Agents, Memory, MCP, Secrets, Tasks, Config Bot, Settings, Channels
│   ├── electron/main.cjs        Desktop app entry point
│   └── package.json             App dependencies
├── memory/                      Persistent memory (auto-managed)
├── scripts/migrate-openclaw.cjs One-click OpenClaw migration
├── workspace/                   Runtime output (gitignored)
├── .mcp.json                    4 MCP servers (trend-pulse, claude-101, cf-browser, notebooklm)
├── CLAUDE.md                    Assistant identity + operating rules
└── README.md
```

## Installation

```bash
git clone https://github.com/claude-world/claude-agent.git
cd claude-agent
```

### Prerequisites

- **Node.js** >= 18
- **Claude Code CLI** — for Method 1 & 3. [Install here](https://docs.anthropic.com/en/docs/claude-code)

### Three Ways to Use

| Method | Best For | Command |
|--------|----------|---------|
| **1. CLI** | Developers, terminal users | `claude` |
| **2. Web UI** | Everyone, visual setup | `cd app && npm install && npm run dev` |
| **3. Telegram/Discord** | Mobile, on-the-go | Via CLI Channels or Web UI |

---

### Method 1: CLI (Terminal)

```bash
# Start Claude Code in the project directory
claude

# First time? Run guided setup
/setup
```

`/setup` will:
- Detect your OS and installed CLI tools
- Configure your profile (name, timezone, language)
- Show available skills grouped by category
- Set up scheduled routines (memory consolidation, daily briefing)

After setup, just talk naturally:
- "What's the weather in Taipei?"
- "Play some music"
- "Remind me to call the dentist at 3pm"
- "What's trending?"

---

### Method 2: Web UI (Browser)

```bash
cd app
npm install    # First time only
npm run dev    # Start the control panel
```

Open **http://localhost:3456** in your browser.

**12 Pages:**

| Page | Description |
|------|-------------|
| **💬 Chat** | Talk to your agent with streaming responses and tool call visualization |
| **📋 History** | Browse all session messages, search across conversations, view tool calls |
| **🏛️ Projects** | Multi-expert collaborative discussion with cross-CLI debate |
| **⚡ Skills** | Browse 49 skills, search, import/export, create new skills with AI |
| **🤖 Agents** | Manage 4 agents, import/export, create new agents with AI |
| **🧠 Memory** | View and edit your agent's memory files |
| **🔌 MCP** | Add/remove MCP servers, view tool counts and tier status |
| **🔑 Secrets** | Store API tokens and credentials, auto-injected as env vars |
| **⏰ Schedule** | Cron-based task scheduling, assign to agents, execution history |
| **🛠️ Config Bot** | Configure the entire system through natural language conversation |
| **⚙️ Settings** | Language, model, CLI detection, project directory, OpenClaw migration |
| **📡 Channels** | Configure Telegram/Discord bots with start/stop and live status |

---

### Method 3: Telegram / Discord

**Option A: Via Claude Code Channels (native)**

```bash
# Telegram
/plugin install telegram@claude-plugins-official
/telegram:configure YOUR_BOT_TOKEN
claude --channels plugin:telegram@claude-plugins-official
# DM your bot → get pairing code → /telegram:access pair ABCDEF

# Discord
/plugin install discord@claude-plugins-official
/discord:configure YOUR_BOT_TOKEN
claude --channels plugin:discord@claude-plugins-official
# DM your bot → get pairing code → /discord:access pair ABCDEF

# Both together
claude --channels plugin:telegram@claude-plugins-official,plugin:discord@claude-plugins-official
```

**Option B: Via Web UI**

1. Start the Web UI: `cd app && npm run dev`
2. Go to **Channels** page
3. Click "Add Telegram Bot" or "Add Discord Bot"
4. Paste your bot token → Save → Enable
5. Messages from Telegram/Discord flow through the agent with full skill access

**How to get a bot token:**
- **Telegram**: Open @BotFather → `/newbot` → copy the token
- **Discord**: https://discord.com/developers/applications → New Application → Bot tab → Reset Token → copy token. Enable "Message Content Intent". Invite to your server via OAuth2 URL Generator (scope: `bot`, permissions: Send Messages, Read Message History)

---

### After Installation

Your agent is ready. Here's what you can do:

```
"Good morning"              → Daily briefing with tasks & news
"Research AI coding tools"  → Web research with summary
"Create a post about X"    → Patent-scored social content
"Make a podcast about X"   → AI podcast via NotebookLM
"Play some music"          → Spotify control
"Check my email"           → Email via himalaya
"What's trending?"         → 20 free trend sources
"Remind me at 3pm to..."   → Task with cron reminder
```

All 49 skills respond to natural language. No need to memorize commands.

### Method 4: Desktop App (macOS / Windows / Linux)

```bash
cd app
npm install

# Run as desktop app (dev mode)
npm run electron:dev

# Build distributable
npm run electron:build:mac    # → release/Claude Agent.dmg
npm run electron:build:win    # → release/Claude Agent Setup.exe
npm run electron:build:linux  # → release/Claude Agent.AppImage
```

The desktop app bundles the web UI + server into a single native application. No browser needed.

### Production Server (headless)

```bash
cd app
npm install
npm run build        # Build optimized client
npm run start        # Start production server
# → http://localhost:3456
```

For background operation:
```bash
# tmux
tmux new -d -s agent 'cd app && npm run start'

# PM2
pm2 start "npm run start" --name claude-agent --cwd app
```

## How It Works

### Session Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                     Session Start                           │
│  session-bootstrap.cjs → loads memory into context          │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Message Arrives                           │
│  message-classifier.cjs → classifies intent, adds routing   │
│  hints (research? task? brainstorm? simple reply?)          │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Claude Processes                           │
│  - Simple: answer directly in main context                  │
│  - Complex: delegate to skill or agent                      │
│  - Memory: auto-save facts, threads, tasks                  │
└──────┬──────────────────────────────────┬───────────────────┘
       │                                  │
       ▼                                  ▼
┌──────────────┐                ┌─────────────────────────────┐
│  Compaction  │                │       Session End            │
│  context-    │                │  session-farewell.cjs →      │
│  guardian →  │                │  archive session, update     │
│  preserve    │                │  thread state                │
│  active state│                └─────────────────────────────┘
└──────────────┘
```

### Task Routing

| Message Pattern | Routed To |
|----------------|-----------|
| Quick question | Main context (direct reply) |
| "Research..." / "Find out about..." | `/quick-research` skill |
| "Remind me..." / "Add task..." | `/task-tracker` skill |
| "Summarize..." / shared URL | `/summarize` skill |
| "Draft an email..." | `/draft-message` skill |
| "Brainstorm..." / "Ideas for..." | `/brainstorm` skill |
| "Good morning" | `/daily-briefing` skill |
| "Memory status" | `/memory-manager` skill |
| "Context health" | `/context-health` skill |
| Complex multi-source research | `researcher` agent |
| Long-form content creation | `writer` agent |
| Data analysis / comparison | `analyst` agent |

### Memory System

Claude-Agent autonomously manages its own memory without being asked:

| Event | Memory Action |
|-------|--------------|
| New fact about you | Updates `user-profile.md` |
| New conversation thread | Updates `active-threads.md` |
| New task or reminder | Updates `pending-tasks.md` |
| Interesting learning | Appends to `learned-today.md` |
| New contact mentioned | Updates `contacts.md` |
| Every 30 minutes | `/memory-manager` consolidates & archives |
| Session end | Hook archives session state |

## Skills Reference (49 skills)

### Core Assistant
| Command | Model | Description |
|---------|-------|-------------|
| `/memory-manager` | haiku | Consolidate, prune, archive memory files |
| `/task-tracker` | haiku | Manage tasks, set reminders with cron |
| `/quick-research` | sonnet | Web search + summary (3-5 sources) |
| `/daily-briefing` | sonnet | Morning overview: tasks, threads, news |
| `/summarize` | haiku | Condense articles, URLs, or long text |
| `/draft-message` | sonnet | Compose emails/messages in your style |
| `/brainstorm` | sonnet | Structured ideation with multiple perspectives |
| `/context-health` | haiku | Monitor context window and memory status |
| `/skill-creator` | sonnet | Create new skills from descriptions |

### Content & Research
| Command | Model | Description |
|---------|-------|-------------|
| `/trend-scout` | haiku | Trending topics from 20 free sources |
| `/content-creator` | sonnet | Patent-scored social content + image cards |
| `/podcast-maker` | sonnet | AI podcast + video via NotebookLM |
| `/deep-read` | haiku | JS-rendered page reading via headless Chrome |
| `/image-gen` | haiku | Generate images via OpenAI DALL-E API |
| `/rss-monitor` | haiku | Monitor RSS/Atom feeds for updates |

### Productivity
| Command | Model | Description |
|---------|-------|-------------|
| `/email` | sonnet | Email via himalaya CLI (IMAP/SMTP) |
| `/google-workspace` | sonnet | Gmail, Calendar, Drive, Sheets, Docs |
| `/github-ops` | sonnet | GitHub issues, PRs, CI via gh CLI |
| `/gh-issues` | sonnet | Auto-fix GitHub issues + open PRs |
| `/notion` | haiku | Notion pages, databases, blocks |
| `/obsidian` | haiku | Obsidian vault notes CRUD |
| `/trello` | haiku | Trello boards, lists, cards |
| `/things-mac` | haiku | Things 3 task manager (macOS) |
| `/pdf-editor` | haiku | Edit, merge, extract PDFs |
| `/bear-notes` | haiku | Bear app note management |
| `/apple-notes` | haiku | Apple Notes via memo CLI |
| `/apple-reminders` | haiku | Apple Reminders via remindctl |

### Messaging
| Command | Model | Description |
|---------|-------|-------------|
| `/imessage` | haiku | iMessage via imsg CLI (macOS) |
| `/whatsapp` | haiku | WhatsApp via wacli CLI |
| `/slack-ops` | haiku | Slack API messaging |
| `/x-twitter` | haiku | X/Twitter via xurl CLI |

### Smart Home & Media
| Command | Model | Description |
|---------|-------|-------------|
| `/spotify` | haiku | Spotify playback control |
| `/sonos` | haiku | Sonos multi-room audio |
| `/hue-lights` | haiku | Philips Hue light control |
| `/smart-bed` | haiku | Eight Sleep pod control |
| `/camera` | haiku | RTSP/ONVIF camera capture |
| `/video-extract` | haiku | Video frames/clips via ffmpeg |
| `/speech-to-text` | haiku | Whisper transcription (local) |
| `/text-to-speech` | haiku | TTS via say/sherpa/ElevenLabs |
| `/gif-search` | haiku | Search and download GIFs |

### System & Security
| Command | Model | Description |
|---------|-------|-------------|
| `/weather` | haiku | Weather via wttr.in (no API key) |
| `/places` | haiku | Google Places search |
| `/password-manager` | haiku | 1Password secrets via op CLI |
| `/security-audit` | haiku | Host security check (no install) |
| `/tmux-control` | haiku | Remote-control tmux sessions |
| `/session-logs` | haiku | Search past session logs |
| `/peekaboo` | haiku | macOS UI automation/screenshots |

### Migration
| Command | Model | Description |
|---------|-------|-------------|
| `/migrate-openclaw` | sonnet | One-click migration from OpenClaw |

## Agents Reference

| Agent | Model | Use Case |
|-------|-------|----------|
| `researcher` | sonnet | Deep research requiring 5-10 sources, comparative analysis |
| `writer` | sonnet | Long-form content: articles, reports, essays (500+ words) |
| `analyst` | sonnet | Data analysis, decision matrices, pros/cons evaluation |
| `content-publisher` | sonnet | Full pipeline: trends → research → write → score → visuals → package |

Agents save detailed output to `workspace/` and return concise summaries to the main context.

## MCP Integration

Claude-Agent comes pre-configured with 4 MCP servers that unlock advanced capabilities.

**Prerequisites**: Install `uv` (Python package runner, needed for `uvx`):
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Tier 1: Zero-Auth (Works Immediately)

| Server | Tools | Capabilities |
|--------|-------|-------------|
| [trend-pulse](https://github.com/claude-world/trend-pulse) | 11 | 20 free trend sources, patent-based content scoring, platform specs |
| [claude-101](https://github.com/claude-world/claude-101) | 27 | 24 use-case templates: email drafting, code scaffolding, data analysis |

No setup needed — these work out of the box.

### Tier 2: Credential-Required (Optional)

| Server | Tools | Setup | Capabilities |
|--------|-------|-------|-------------|
| [cf-browser](https://github.com/claude-world/cf-browser) | 15 | CF credentials | Headless Chrome: JS rendering, screenshots, structured extraction |
| [notebooklm](https://github.com/claude-world/notebooklm-skill) | 13 | Google login | AI podcasts, slides, reports, quizzes, research |

#### Setup cf-browser (headless Chrome)
```bash
# 1. Get Cloudflare credentials:
#    https://dash.cloudflare.com → Account ID (in sidebar)
#    https://dash.cloudflare.com/profile/api-tokens → Create Token
#    → Use "Edit Cloudflare Workers" template or custom with Browser Rendering permission

# 2. Add to your shell profile (~/.zshrc or ~/.bashrc):
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"

# 3. Reload shell
source ~/.zshrc

# 4. Verify: restart claude in the project dir, then try:
#    /deep-read https://some-javascript-heavy-site.com
```

#### Setup notebooklm (AI podcasts, slides, research)
```bash
# 1. One-time Google login (opens Chromium browser):
uvx notebooklm login
# → Sign in with your Google account
# → Session saved to ~/.notebooklm/

# 2. Verify: restart claude in the project dir, then try:
#    /podcast-maker "AI coding tools in 2026" en
```

### Content Pipeline

The new skills chain together into a powerful content creation pipeline:

```
/trend-scout               → Discover what's trending (20 sources)
       ↓
/content-creator <topic>   → Research + write + patent-score the post
       ↓
  [with-image flag]        → Generate NotebookLM image card
       ↓
  Ready to publish         → Scored draft in workspace/

Alternative paths:
/podcast-maker <topic>     → AI podcast (M4A) + optional video (MP4)
/deep-read <URL>           → Extract content from JS-heavy pages
content-publisher agent    → Full autonomous pipeline (trend → package)
```

### New Skills (MCP-Powered)

| Skill | Command | Model | Description |
|-------|---------|-------|-------------|
| Trend Scout | `/trend-scout` | haiku | Trending topics from 20 free sources with velocity tracking |
| Content Creator | `/content-creator` | sonnet | Patent-scored social content with optional image cards |
| Podcast Maker | `/podcast-maker` | sonnet | AI podcast + video generation via NotebookLM |
| Deep Read | `/deep-read` | haiku | Read JS-rendered pages via headless Chrome |

### New Agent (MCP-Powered)

| Agent | Model | Use Case |
|-------|-------|----------|
| `content-publisher` | sonnet | Full pipeline: discover trends → research → write → score → visuals → package |

### Graceful Degradation

All MCP-powered features degrade gracefully:
- **No trend-pulse**: `/trend-scout` falls back to WebSearch
- **No cf-browser**: `/content-creator` and `/deep-read` use WebFetch instead
- **No notebooklm**: Image cards and podcasts are skipped with setup instructions shown
- **No MCPs at all**: The core skills + agents work without any MCP server

## Migration from OpenClaw

Coming from [OpenClaw](https://github.com/openclaw/openclaw)? Claude-Agent includes a one-click migration tool.

```bash
# Preview what will be migrated (no changes made)
node scripts/migrate-openclaw.cjs --dry-run

# Run the migration
node scripts/migrate-openclaw.cjs

# Custom OpenClaw path
node scripts/migrate-openclaw.cjs --openclaw-dir /path/to/.openclaw
```

**What gets migrated:**

| OpenClaw | claude-agent | Transform |
|----------|-------------|-----------|
| `SOUL.md` | `CLAUDE.md` | Personality merged into identity section |
| `MEMORY.md` | `memory/user-profile.md` | Knowledge base imported |
| `memory/*.md` | `memory/archive/` | Daily logs copied (last 30 days) |
| `skills/*/SKILL.md` | `.claude/skills/*/SKILL.md` | Frontmatter adapted to Claude Code format |
| `AGENTS.md` | `.claude/agents/*.md` | Workflows split into individual agents |
| `TOOLS.md` | `.claude/rules/tool-conventions.md` | Converted to rule file (created during migration) |
| `sessions/` | `memory/active-threads.md` | Recent sessions summarized |
| `openclaw.json` | `.mcp.json` | MCP server configs extracted |

Or use the skill interactively: `/migrate-openclaw`

## Customization

### Adding a New Skill

Create a file at `.claude/skills/<skill-name>/SKILL.md`:

```markdown
---
name: my-skill
description: What this skill does
allowed-tools:
  - Read
  - Write
  - WebSearch
model: haiku
user-invocable: true
when_to_use: When the user says "my trigger phrase"
---

# My Skill

Instructions for what the skill should do...
```

Then add a routing entry in `CLAUDE.md` under the Task Delegation table.

### Adding a New Agent

Create a file at `.claude/agents/<agent-name>.md`:

```markdown
---
name: my-agent
description: What this agent specializes in
tools:
  - Read
  - Write
  - WebSearch
model: sonnet
---

# My Agent

Instructions for the agent's process, output format, and rules...
```

### Modifying Hooks

Hooks are in `.claude/hooks/` and configured in `.claude/settings.json`. Each hook:
- Receives JSON on stdin with session context
- Outputs JSON on stdout with instructions for Claude
- Has a hard timeout to prevent blocking

### Adjusting Memory Policy

Edit `.claude/rules/memory-policy.md` to change what gets saved, how often, and the archival rules.

## File Ownership

| Directory | Managed By | Git Tracked |
|-----------|-----------|-------------|
| `.claude/` | You (human) | Yes |
| `memory/` (templates) | You (human) | Yes |
| `memory/` (content) | Claude (auto) | Partial (templates only) |
| `memory/archive/` | Claude (auto) | No |
| `workspace/` | Claude (auto) | No |

## Privacy Note

Memory template files (`memory/user-profile.md`, `memory/active-threads.md`, `memory/pending-tasks.md`) are tracked in git with empty placeholders. As Claude populates them with your personal data, **do not push these files to a public repository**. If you fork this project, add these to your `.gitignore`:

```
memory/user-profile.md
memory/active-threads.md
memory/pending-tasks.md
```

Runtime files (`memory/archive/`, `workspace/`, `memory/learned-today.md`, `memory/contacts.md`) are already gitignored.

## Requirements

- **Claude Code CLI** — Latest version recommended
- **Node.js** >= 18 — For hooks (uses only built-in `fs` and `path` modules)
- **uv** (optional) — For MCP servers. Install: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- No additional npm dependencies

## License

[MIT](LICENSE)

## Credits

Built by [Claude World](https://claude-world.com) — the Claude Code advanced usage community.
