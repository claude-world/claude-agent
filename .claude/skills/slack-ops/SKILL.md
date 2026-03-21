---
name: slack-ops
description: >
  Operate Slack via the Web API using curl and a SLACK_TOKEN env var. Send
  messages, add reactions, pin messages, and list channels. Use when user says
  "post to Slack", "send Slack message", "react to message", "pin in Slack",
  or "list Slack channels".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to interact with Slack — post messages, manage reactions, pin
  content, or browse channels. Triggers: "send to Slack", "post in #channel",
  "react with emoji", "pin message", "list channels", "Slack notification".
argument-hint: "<action: send|react|pin|channels|history> [channel] [content]"
---

# Slack Ops

Interact with Slack via the official Web API using `curl`. Requires a
`SLACK_TOKEN` environment variable (Bot Token starting with `xoxb-`).

## Prerequisites

No CLI install needed — uses `curl` (pre-installed on macOS/Linux).

**Set up your bot token:**
```bash
export SLACK_TOKEN="xoxb-your-token-here"
# Or add to ~/.zshrc / ~/.bashrc for persistence
```

To get a token: https://api.slack.com/apps → Create App → OAuth & Permissions →
add scopes (`chat:write`, `channels:read`, `reactions:write`, `pins:write`) →
Install to Workspace → copy Bot User OAuth Token.

## Commands

**Send a message:**
```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "#general", "text": "Hello team!"}'
```

**Send with blocks (rich text):**
```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "#general", "blocks": [{"type":"section","text":{"type":"mrkdwn","text":"*Update*: Build passed."}}]}'
```

**Add a reaction:**
```bash
# Requires channel ID, message timestamp
curl -s -X POST https://slack.com/api/reactions.add \
  -H "Authorization: Bearer $SLACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "C12345678", "name": "white_check_mark", "timestamp": "1609459200.000100"}'
```

**Pin a message:**
```bash
curl -s -X POST https://slack.com/api/pins.add \
  -H "Authorization: Bearer $SLACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "C12345678", "timestamp": "1609459200.000100"}'
```

**List channels:**
```bash
curl -s "https://slack.com/api/conversations.list?limit=50" \
  -H "Authorization: Bearer $SLACK_TOKEN" | jq '.channels[] | {id, name}'
```

**Get channel history:**
```bash
curl -s "https://slack.com/api/conversations.history?channel=C12345678&limit=20" \
  -H "Authorization: Bearer $SLACK_TOKEN" | jq '.messages[] | {ts, text, user}'
```

## Usage Examples

**Post a quick status update:**
```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "#deploys", "text": "v2.1.0 deployed to production."}'
```

## Rules

- Always check that `SLACK_TOKEN` is set before running any command: `[[ -z "$SLACK_TOKEN" ]] && echo "SLACK_TOKEN not set"`
- If token is missing, instruct user to set it and stop
- Never print the token value in output
- Always parse API responses with `jq` and check `"ok": true`; if `"ok": false`, show the `error` field
- Channel names use `#name` format for posting; channel IDs (`C...`) are required for reactions/pins — run `channels.list` first if needed
- Confirm message sends with: "Posted to #<channel>"
- Keep messages concise; for long content, consider posting a summary with a workspace file link
