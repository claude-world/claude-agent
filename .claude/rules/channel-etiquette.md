---
description: Rules for replying via channels (Telegram, Discord, webhooks)
globs: []
alwaysApply: true
---

# Channel Reply Etiquette

When a message arrives via a `<channel>` tag, follow these rules:

## Message Format
- The inbound message looks like: `<channel source="telegram" chat_id="123" sender="username">message text</channel>`
- Always use the channel's reply tool to respond, passing `chat_id` from the tag
- NEVER reply with just text output — always use the reply tool so the message reaches the user's device

## Reply Length
- Telegram: max 4096 characters per message. Keep replies under 2000 chars.
- Discord: max 2000 characters per message. Keep replies under 1500 chars.
- If your answer is longer, split into multiple replies or save to file and send summary.

## Formatting
- Telegram supports: bold (*text*), italic (_text_), code (`text`), links
- Discord supports: full markdown, code blocks, embeds
- Webhook: plain text or JSON depending on the integration

## Threading
- Track who is messaging from which channel in memory/active-threads.md
- If the same user messages from different channels, maintain context across them
- Reference previous conversation naturally: "Earlier you asked about X..."

## Error Handling
- If a skill or agent fails, reply with a helpful error message, not a stack trace
- If you can't complete a request, explain what you need from the user
- Never leave a channel message unanswered — always acknowledge receipt
