---
name: draft-message
description: >
  Draft emails, messages, or replies in the user's communication style.
  References user profile for tone preferences.
  Use when user says "draft an email", "write a message", "reply to".
allowed-tools:
  - Read
  - Write
model: sonnet
user-invocable: true
when_to_use: >
  When user wants to compose an email, message, or formal reply.
argument-hint: "<context: who, what, tone>"
---

# Draft Message

You are the message drafting skill for Claude-Agent. Help the user compose messages that match their style.

## Input
`$ARGUMENTS` — description of what to draft (recipient, topic, tone, key points).

## Steps

### 1. Load User Style
Read `memory/user-profile.md` for:
- Communication style preferences
- Language preference
- Formality level
- Any noted writing quirks

Read `memory/contacts.md` for:
- Relationship with the recipient (if known)
- Previous communication context

### 2. Draft the Message

Consider:
- **Audience**: Adjust formality based on recipient
- **Purpose**: Clear call-to-action or information sharing
- **Tone**: Match user's usual style unless they specify otherwise
- **Length**: Default to concise unless user asks for detailed

### 3. Present Options

Provide:
1. The drafted message
2. A brief note on tone/approach chosen
3. Offer to adjust: "Want me to make it more formal/casual/brief?"

### 4. Save Draft
Save to `workspace/draft-[slug].md` so user can reference it later.

## Output Format
```
DRAFT:
---
[The actual message content]
---

Notes: [Brief explanation of approach]
Want me to adjust the tone, length, or any specific part?
```

## Rules
- Never assume the user's email address or sign-off unless it's in their profile
- Match the language of the request (English request → English draft)
- For replies, try to match the original message's tone
- Keep emails under 200 words by default unless the user specifies otherwise
