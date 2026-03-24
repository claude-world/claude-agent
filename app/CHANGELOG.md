# Changelog

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
