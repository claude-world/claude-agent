---
name: whatsapp
description: >
  Send WhatsApp messages and search message history via the wacli CLI. Supports
  sending text to contacts or groups and syncing/searching past conversations.
  Use when user says "WhatsApp", "send WhatsApp message", or "search WhatsApp history".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to send a WhatsApp message or search past WhatsApp conversations.
  Triggers: "send WhatsApp to", "message <person> on WhatsApp", "search WhatsApp
  history for", "sync WhatsApp messages".
argument-hint: "<action: send|history|search|sync> [contact] [message]"
---

# WhatsApp

Send messages and search history via `wacli`. Requires WhatsApp Web pairing (QR scan
on first use).

## Prerequisites

```bash
# Install via npm
npm install -g wacli

# First-time setup: pair with WhatsApp Web
wacli auth
# Scan the QR code with WhatsApp on your phone
```

## Commands

| Command | Description |
|---------|-------------|
| `wacli send "<phone>" "<message>"` | Send a message (phone in international format) |
| `wacli send --group "<group name>" "<message>"` | Send to a group |
| `wacli sync` | Sync recent message history locally |
| `wacli history "<phone>"` | Show message history with a contact |
| `wacli history "<phone>" --limit 20` | Show last N messages |
| `wacli search "<query>"` | Search all synced messages for a keyword |
| `wacli contacts` | List saved contacts |

## Usage Examples

**Send a message by phone number:**
```bash
wacli send "+886912345678" "Hi, just checking in!"
```

**Send to a group:**
```bash
wacli send --group "Family" "Dinner at 7pm tonight."
```

**Sync and search history:**
```bash
wacli sync
wacli search "project deadline"
```

**View conversation history:**
```bash
wacli history "+886912345678" --limit 15
```

## Rules

- Always check if CLI is installed first: `which wacli`
- If not installed, show the npm install command and stop
- If not authenticated, run `wacli auth` and instruct user to scan the QR code
- Phone numbers must be in international format (e.g. +886..., +1...)
- Never send a message without confirming recipient and content with the user
- When showing history, default to last 10 messages; save longer history to workspace/ and summarize
- Confirm sends with a single line: "Message sent to <contact>"
- Do not log or store message content in memory files
