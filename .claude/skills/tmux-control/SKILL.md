---
name: tmux-control
description: >
  Remote-control tmux sessions — create, attach, list, send keystrokes, and
  scrape pane output. Use when user says "create tmux session", "send keys to
  tmux", "read tmux output", "split pane", or "run command in tmux".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to manage tmux sessions, send commands to running sessions,
  capture pane output, or automate terminal workflows. Triggers: "tmux session",
  "send to tmux", "create pane", "split terminal", "capture tmux output",
  "run in background tmux", "attach to session".
argument-hint: "<action: list|new|attach|send|capture|split|kill> [session] [command]"
---

# Tmux Control

Remote-control tmux sessions programmatically. `tmux` is usually pre-installed;
if not, install it with your package manager.

## Prerequisites

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt install tmux

# Check version
tmux -V
```

## Commands

### Session Management

| Command | Description |
|---------|-------------|
| `tmux list-sessions` | List all active sessions |
| `tmux new-session -d -s <name>` | Create a new detached session |
| `tmux attach-session -t <name>` | Attach to a session (interactive) |
| `tmux kill-session -t <name>` | Kill a session |
| `tmux has-session -t <name> 2>/dev/null` | Check if session exists (exit 0 = yes) |

### Sending Commands & Keystrokes

```bash
# Run a command in a session (sends text + Enter)
tmux send-keys -t <session> "ls -la" Enter

# Send to specific window and pane (session:window.pane)
tmux send-keys -t myapp:0.1 "npm run dev" Enter

# Send a raw keystroke (e.g. Ctrl+C)
tmux send-keys -t <session> C-c

# Send without pressing Enter (useful for partial input)
tmux send-keys -t <session> "some text"
```

### Capturing Pane Output

```bash
# Capture current visible pane content
tmux capture-pane -t <session> -p

# Capture full scrollback buffer to file
tmux capture-pane -t <session> -p -S - > workspace/tmux-output.txt

# Capture last 100 lines
tmux capture-pane -t <session> -p -S -100
```

### Window & Pane Management

```bash
# Create a new window in a session
tmux new-window -t <session> -n <window-name>

# Split pane horizontally (left/right)
tmux split-window -h -t <session>

# Split pane vertically (top/bottom)
tmux split-window -v -t <session>

# List windows in a session
tmux list-windows -t <session>

# List panes in a session
tmux list-panes -t <session>
```

## Usage Examples

**Create a session and run a dev server:**
```bash
tmux new-session -d -s devserver
tmux send-keys -t devserver "cd ~/project && pnpm dev" Enter
```

**Capture output from a running process:**
```bash
tmux capture-pane -t devserver -p -S -50
```

**Send Ctrl+C then restart:**
```bash
tmux send-keys -t devserver C-c
sleep 1
tmux send-keys -t devserver "pnpm dev" Enter
```

**Run a command and capture result:**
```bash
tmux new-session -d -s scratch
tmux send-keys -t scratch "git status" Enter
sleep 1
tmux capture-pane -t scratch -p
tmux kill-session -t scratch
```

## Rules

- Always check if tmux is installed first: `which tmux`
- If not installed, show the install command and stop
- Before sending keys, verify the session exists with `tmux has-session -t <name>`
- When capturing output, always save to `workspace/tmux-<session>-<timestamp>.txt` for long output
- Add appropriate `sleep` between `send-keys` and `capture-pane` to allow commands to complete
- Never send destructive commands (`rm -rf`, `DROP TABLE`, etc.) without explicit user confirmation
- Use `-d` (detached) when creating sessions programmatically — never attach interactively
- Confirm actions with a single line: "Sent '<command>' to session <name>"
