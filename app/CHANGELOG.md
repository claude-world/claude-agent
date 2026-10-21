# Changelog

## [Unreleased]

### Changed

- Dev tooling: `typescript` 6 → 7 (native compiler), `vitest` 4 → 5,
  `@types/better-sqlite3` 7 → 9; `react`/`react-dom` 19.3, `@types/ws` 8.18.2.
- CI and publish workflows skip `onnxruntime-node`'s optional CUDA download
  (`ONNXRUNTIME_NODE_INSTALL=skip`); the CPU binaries ship in the package.
- Dependabot ignores `apache-arrow` > 18.1.0, matching `@lancedb/lancedb`'s peer range.

## [2.2.0] - 2026-10-21

Dependency, security, and toolchain refresh.

### Breaking Changes

- **Node.js >= 22 required.** Several dependencies (`@lancedb/lancedb`, `better-sqlite3`,
  `openai`, `electron`, `concurrently`) dropped Node 20, which is now end-of-life. An
  `engines.node >= 22` floor is declared. The Claude Code CLI usage and the lifecycle
  hooks (built-in modules only) are unaffected.
- **Telegram library rewrite**: `node-telegram-bot-api` upgraded `0.67` → `2.x`, a full
  API redesign. The Telegram bridge was migrated to the new `Bot` / `api` / `Context`
  interface (`bot.api.sendMessage({ chat_id, text })`, `bot.startPolling()`, `bot.catch()`).
  User-facing behavior is unchanged.
- **Embeddings backend**: replaced the deprecated `@xenova/transformers` with its
  maintained successor `@huggingface/transformers` (v4). Local semantic search is
  unchanged; the TF-IDF fallback still applies when the model is unavailable.

### Security

- npm audit findings reduced **53 → 12** (from 7 critical / 27 high to **0 critical**,
  4 high, 8 moderate). Clearing the old Telegram HTTP stack removed the `request`,
  `form-data`, `tough-cookie`, `qs`, and `uuid` advisories; lockfile refresh resolved
  `shell-quote`, `tar`, `proxy-addr`, `undici`, `ws`, and `vite`.
- Remaining advisories are dev/build-time only (the `electron-builder` chain, used to
  package installers) or upstream libvips issues in `sharp` with no fixed release; none
  are reachable from the shipped server runtime.

### Model Currency

- Default direct-SDK model updated `claude-sonnet-4-6` → `claude-sonnet-5-5`. UI and
  doc model references refreshed to current IDs.

### Added

- **CI**: GitHub Actions workflow running install, typecheck, test, and build on Node
  22, 24, and 26.
- **Dependabot**: `.github/dependabot.yml` for npm (`/app`) and github-actions, monthly,
  with minor+patch updates grouped to reduce PR noise.
- `npm run typecheck` script (`tsc --noEmit`).

### Packaging

- Added a `files` allowlist and `build.emptyOutDir` so `npm publish` ships a
  deterministic ~370 kB tarball regardless of local build/runtime state (previously a
  local publish could include hundreds of MB of stale `dist`/`release` output).
- Stopped tracking and shipping stale runtime session archives under `app/memory/`.

### Fixed

- `AgentSession` now handles the child-process `'error'` event when spawning the
  `claude` CLI. A missing or unspawnable CLI (e.g. Claude Code not installed or not on
  `PATH`) previously surfaced as an uncaught exception; it is now logged with a clear
  message and the response stream ends cleanly.

### Package Upgrades

| Package | From | To |
|---------|------|----|
| @anthropic-ai/sdk | 0.88 | 0.137 |
| node-telegram-bot-api | 0.67 | 2.1 |
| openai | 6 | 7 |
| @lancedb/lancedb | 0.27 | 0.40 |
| better-sqlite3 | 12 | 13 |
| electron | 41 | 44 |
| electron-builder | 26.0 | 26.15 |
| discord.js | 14.18 | 14.27 |
| express | 5.1 | 5.3 |
| ws | 8.18 | 8.22 |
| node-cron | 4.2 | 4.6 |
| concurrently | 9 | 10 |
| vite | 8.0 | 8.3 |
| vitest | 4.0 | 4.1 |
| tailwindcss / @tailwindcss/vite | 4.2 | 4.3 |
| @vitejs/plugin-react | 6.0 | 6.1 |
| @xenova/transformers | 2.17 | → @huggingface/transformers 4.3 |

## [1.3.0] - 2026-03-28

### Breaking Changes

- **SDK to CLI migration**: Replaced the `@anthropic-ai/claude-code` SDK `query()` function with Claude CLI subprocess invocation. The SDK removed its programmatic API in v2.0.25+. AgentSession now spawns `claude -p --output-format stream-json` per message with `--resume` for conversation continuity. Same interface, better process isolation.
- **Express 5**: Upgraded from Express 4 to Express 5. Async error handling is now native.
- **React 19**: Upgraded from React 18 to React 19. No component changes required.
- **better-sqlite3 12**: Upgraded from v11 to v12.
- **node-cron 4**: Upgraded from v3 to v4.

### Security

- Removed direct dependency on `@anthropic-ai/claude-code` npm package (had 9 CVEs in v1.x). Now uses the globally installed CLI binary.
- Upgraded `node-telegram-bot-api` 0.66 -> 0.67 (form-data vulnerability fix)
- Upgraded `discord.js` 14.16 -> 14.25 (undici security patches)
- Upgraded `electron` 33 -> 35, `electron-builder` 25 -> 26

### Added

- **Health check endpoint**: `GET /api/health` — returns uptime, memory, active sessions, bridge status
- **Export/backup endpoint**: `GET /api/export` — full JSON backup of sessions, messages, settings, tasks
- **Usage stats endpoint**: `GET /api/stats` — session counts, task execution metrics, costs
- **Webhook channel**: `POST /api/webhook` — inbound webhook for external integrations (supports optional secret auth)
- **API pagination**: Sessions and messages endpoints now support `?limit=N&offset=N` query params
- **Rate limiting**: In-memory rate limiter (30 req/min) on WebSocket chat messages
- **Session TTL**: Automatic cleanup of idle in-memory sessions every 10 minutes
- **Vitest**: Added test framework with `npm test` script
- **Fixed SDK option**: Changed incorrect `systemPrompt` to `appendSystemPrompt` (was silently ignored)

### Package Upgrades

| Package | From | To |
|---------|------|----|
| express | 4.22 | 5.2 |
| react / react-dom | 18.3 | 19.2 |
| better-sqlite3 | 11.10 | 12.8 |
| electron | 33.4 | 35.7 |
| electron-builder | 25.1 | 26.8 |
| node-cron | 3.0 | 4.2 |
| discord.js | 14.16 | 14.25 |
| node-telegram-bot-api | 0.66 | 0.67 |
| react-markdown | 9.1 | 10.1 |
| @types/react | 18.3 | 19.2 |
| @vitejs/plugin-react | 4.3 | 4.7 |

### Fixed

- `MemoryPage.tsx`: Fixed possible undefined access on `file.size` and `file.modified_at`
- `ScheduledTasksPage.tsx`: Fixed comparison with non-existent `'completed'` status (should be `'success'`)
- `SettingsPage.tsx`: Added missing `McpServer` type import and `setMcpServers` state declaration

## [1.1.0] - 2026-03-24

### Fixed - Orphan Process Prevention

Server processes were not properly cleaned up when the Electron app closed or restarted,
leading to dozens of zombie Node.js processes consuming 60-86% CPU each (observed: 19
orphan processes totaling ~1400% CPU and ~10GB RAM).

#### Root Causes

1. **Process tree not killed** — `killServer()` only terminated the tsx launcher; the actual
   Node.js server worker (child process) survived as an orphan.
2. **No `process.exit()` in shutdown** — the server's graceful shutdown closed connections
   but never exited, leaving processes alive if any event loop handles remained.
3. **No port conflict detection** — restarting the app spawned new server processes without
   checking if the port was already occupied.

#### Fixes

**Electron (`main.cjs`)**
- Added `cleanupOrphans()` on startup — checks PID file and `lsof` to kill stale processes
- Added `isOurServer(pid)` validation to prevent killing recycled PIDs
- `killServer()` now kills the entire process tree via `pkill -P` + `lsof` fallback
- Prevents double-kill from `before-quit` + `window-all-closed` events
- Added `app.requestSingleInstanceLock()` to prevent multiple Electron instances
- Force-kill timer uses `.unref()` and validates PID liveness before SIGKILL

**Server (`server/index.ts`)**
- `shutdown()` now calls `process.exit(0)` after graceful close, with 8s forced exit timeout
- Writes PID file (`~/.claude-agent/server.pid`) on startup, removes on shutdown
- `EADDRINUSE` causes immediate exit (dual handler: `server.on("error")` + `uncaughtException`)
- All WebSocket clients are `terminate()`d before `wss.close()` to prevent hanging
- Bridge cleanup (Telegram/Discord `.stop()`) included in shutdown sequence
- `uncaughtException` now logs full stack trace instead of just message

### Defense Layers

```
Startup:   cleanupOrphans() → PID file check → lsof port check → isOurServer() validation
Runtime:   PID file written → EADDRINUSE immediate exit → single instance lock
Shutdown:  SIGTERM → pkill child tree → 3s SIGKILL escalation → WS terminate → process.exit(0) → 8s force exit
```

## [1.0.0] - 2026-03-23

Initial release — persistent personal assistant for Claude Code with Telegram/Discord
bridges, web UI, scheduled tasks, and secrets vault.
