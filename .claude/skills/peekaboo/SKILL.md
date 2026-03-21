---
name: peekaboo
description: >
  Capture and automate macOS UI with the Peekaboo CLI. Screenshots,
  element inspection, click automation, and accessibility tree reading.
  Use when user says "screenshot this app", "click on button",
  "automate UI", "what's on screen".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to capture macOS screenshots, inspect UI elements,
  automate clicking/typing in apps, or read the accessibility tree.
  macOS only.
argument-hint: "<action: screenshot|inspect|click|type> [app name] [element]"
---

# Peekaboo — macOS UI Automation

Capture and control macOS UI elements via the Peekaboo CLI.

## Prerequisites

```bash
brew install steipete/tap/peekaboo
```

Requires macOS Accessibility permissions (System Settings → Privacy & Security → Accessibility).

## Commands

| Command | Purpose |
|---------|---------|
| `peekaboo screenshot` | Capture full screen |
| `peekaboo screenshot --app "Safari"` | Capture specific app |
| `peekaboo screenshot --window-id N` | Capture specific window |
| `peekaboo inspect --app "Finder"` | List UI elements (accessibility tree) |
| `peekaboo click --app "App" --element "Button Name"` | Click element |
| `peekaboo type --app "App" --element "TextField" --text "hello"` | Type text |
| `peekaboo list-windows` | List all open windows |
| `peekaboo list-apps` | List running applications |

## Usage Examples

- `/peekaboo screenshot Safari` — capture Safari window
- `/peekaboo inspect Finder` — show all UI elements in Finder
- `/peekaboo click "System Settings" "Wi-Fi"` — click Wi-Fi in Settings

## Rules
- Check if `peekaboo` is installed: `which peekaboo`
- If not installed: `brew install steipete/tap/peekaboo`
- macOS only — inform Linux/Windows users this skill is unavailable
- Screenshots saved to `workspace/screenshot-<app>-<timestamp>.png`
- Always verify accessibility permissions if commands fail
