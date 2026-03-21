---
name: email
description: >
  Manage email via the himalaya CLI — list, read, compose, reply, forward, and search
  emails across IMAP/SMTP accounts. Use when user says "check email", "send email",
  "reply to...", "forward email", "search inbox", or "read message".
allowed-tools:
  - Bash
  - Read
  - Write
model: sonnet
user-invocable: true
when_to_use: >
  When user wants to read, send, reply to, forward, or search email.
  Triggers: "check my email", "any new emails", "send email to...", "reply to...",
  "forward this to...", "search inbox for...", "read email from...".
argument-hint: "<action: list|read|send|reply|forward|search|delete> <details>"
---

# Email

Manage email via the `himalaya` CLI supporting IMAP/SMTP. Requires account configuration.

## Prerequisites

```bash
brew install himalaya
```

Configure your account:
```bash
himalaya account configure
```

This creates `~/.config/himalaya/config.toml`. You will need:
- IMAP host, port, credentials
- SMTP host, port, credentials
- For Gmail: use App Password (not regular password) and enable IMAP in Gmail settings

## Commands

| Command | Description |
|---------|-------------|
| `himalaya envelope list` | List inbox messages (most recent first) |
| `himalaya envelope list --folder Sent` | List sent messages |
| `himalaya message read <ID>` | Read a message by ID |
| `himalaya message write` | Compose a new message (opens editor) |
| `himalaya message reply <ID>` | Reply to a message |
| `himalaya message reply --all <ID>` | Reply-all to a message |
| `himalaya message forward <ID>` | Forward a message |
| `himalaya envelope search "<query>"` | Search messages |
| `himalaya message delete <ID>` | Move message to trash |
| `himalaya account list` | List configured accounts |
| `himalaya -a <account> envelope list` | List mail for a specific account |

## Usage Examples

**Check inbox (latest 20):**
```bash
himalaya envelope list
```

**Read a specific email:**
```bash
himalaya message read 42
```

**Compose and send (non-interactive, pipe body):**
```bash
echo "Hi Alice,\n\nPlease find the report attached.\n\nBest regards" | \
  himalaya message write --to "alice@example.com" --subject "Q1 Report"
```

**Search for emails:**
```bash
himalaya envelope search "from:boss@company.com subject:quarterly"
```

**Reply to a message:**
```bash
echo "Thanks, will do!" | himalaya message reply 42
```

## Rules

- Always check if CLI is installed first: `which himalaya`
- If not installed, show the brew install command and stop
- If no account is configured, run `himalaya account list` to check — if empty, guide the user to run `himalaya account configure`
- NEVER include credentials, passwords, or API keys in responses
- When showing email lists, display: ID, sender, subject, date — keep it concise
- When reading emails, truncate body at 1000 chars and save full content to `workspace/email-<id>.md` if longer
- When composing, draft the message body and confirm with the user before sending
- For multi-account setups, always clarify which account to use if not specified
- Keep replies brief: confirm send/action with "Sent to <recipient>." or equivalent
