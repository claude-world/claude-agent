---
name: imessage
description: >
  Send and receive iMessages via the imsg CLI. List conversations, read message
  history, and send messages directly through Messages.app on macOS. Use when
  user says "send iMessage", "read my messages", "text someone", or "iMessage history".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to send, read, or manage iMessages on macOS. Triggers: "send
  iMessage to", "text <person>", "read my messages", "show iMessage history",
  "list chats", "check messages from".
argument-hint: "<action: list|history|send> [contact] [message]"
---

# iMessage

Send and receive iMessages via the `imsg` CLI. macOS only — requires Messages.app with
an active Apple ID.

## Prerequisites

```bash
brew install steipete/tap/imsg
```

After install, grant Full Disk Access to Terminal (required to read the Messages database):
System Settings → Privacy & Security → Full Disk Access → add Terminal (or iTerm2).

## Commands

| Command | Description |
|---------|-------------|
| `imsg list` | List all conversations (contact + last message preview) |
| `imsg history "<contact>"` | Show recent message history with a contact |
| `imsg history "<contact>" --limit 20` | Show last N messages |
| `imsg send "<contact>" "<message>"` | Send an iMessage via Messages.app |
| `imsg send "+1XXXXXXXXXX" "<message>"` | Send by phone number |

## Usage Examples

**List all conversations:**
```bash
imsg list
```

**Read history with a contact:**
```bash
imsg history "Alice"
imsg history "Alice" --limit 30
```

**Send a message:**
```bash
imsg send "Alice" "Hey, are we still on for lunch?"
imsg send "+18005550100" "Your order is ready."
```

## Rules

- Always check if CLI is installed first: `which imsg`
- If not installed, show the brew install command and stop
- macOS only — if not on macOS, inform the user and stop
- If Full Disk Access is not granted, the CLI will fail with a permissions error; instruct the user to add Terminal in System Settings
- Never display raw phone numbers or contact details in final response — reference by name only
- When displaying history, keep output to last 10 messages by default unless the user requests more
- Confirm sends with a single line: "Message sent to <contact>"
- Never send a message without explicit user confirmation of the recipient and content
