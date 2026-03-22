# Contributing to Claude-Agent

Thanks for your interest in contributing! Claude-Agent is designed to be easily extensible — most contributions are just markdown files.

## Ways to Contribute

### Add a New Skill

Skills are the primary extension point. To add a new skill:

1. Create `.claude/skills/<skill-name>/SKILL.md`
2. Follow the frontmatter format (see existing skills for examples)
3. Add a routing entry in `CLAUDE.md` under Task Delegation
4. Test it by running `claude` in the project directory and invoking `/<skill-name>`

**Good skill ideas:**
- Language translation
- Calendar integration
- Code review / PR summary
- Habit tracking
- Expense tracking

### Add a New Agent

Agents handle complex, multi-step tasks that need deep context:

1. Create `.claude/agents/<agent-name>.md`
2. Define the agent's process, output format, and rules
3. Update `CLAUDE.md` to reference the new agent

### Improve Hooks

Hooks are Node.js scripts in `.claude/hooks/`. They must:
- Read JSON from stdin
- Write JSON to stdout
- Complete within their timeout
- Use only Node.js built-in modules (no npm dependencies)

### Improve the Web UI / Desktop App

The control panel lives in `app/` (12 pages):
- **Server** (`app/server/`): Express + WebSocket + SQLite + Telegram/Discord bridges + discussion engine + scheduler
- **Client** (`app/client/`): React 18 + Tailwind CSS + i18n (en/zh-TW/ja) — 12 pages
- **Desktop** (`app/electron/`): Electron packaging for macOS/Windows/Linux

```bash
cd app && npm install && npm run dev      # Dev mode
cd app && npm run electron:dev            # Desktop app
```

### Improve Documentation

- Fix typos, clarify instructions
- Add examples and use cases
- Translate documentation (i18n keys in `app/client/i18n.ts`)

## Guidelines

- **Skills/Hooks**: No npm dependencies. Pure markdown + Node.js built-ins.
- **Web UI**: Standard React + Tailwind patterns. Keep components small.
- **Follow existing patterns** — Look at existing skills/agents for format and style.
- **Test your changes** — Run `claude` in the project directory and verify your addition works.
- **One thing per PR** — Each PR should add one skill, one agent, or fix one issue.

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b add-skill-translation`)
3. Make your changes
4. Test by running Claude Code in the project directory
5. Submit a pull request with a clear description

## Code of Conduct

Be respectful, constructive, and helpful. We're building tools to make people more productive — let's do it collaboratively.

## Questions?

- Open an issue on GitHub
- Join the [Claude World Taiwan Discord](https://discord.gg/claude-world)
