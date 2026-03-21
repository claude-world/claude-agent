---
name: deep-read
description: >
  Read and extract content from JS-rendered web pages using headless Chrome
  (Cloudflare Browser Rendering). Unlike /summarize, handles SPAs, paywalled
  previews, and complex sites. Use when a URL fails with regular fetch,
  or when user says "read this page", "what does this page say",
  "get the content from this URL".
allowed-tools:
  - mcp__cf-browser__browser_markdown
  - mcp__cf-browser__browser_screenshot
  - mcp__cf-browser__browser_json
  - mcp__cf-browser__browser_links
  - WebFetch
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user shares a URL from a JS-heavy site (SPA, dashboard, news behind JS)
  or when /summarize returns garbled/empty content. Requires CF credentials.
argument-hint: "<URL> [extract: summary|data|links|screenshot]"
---

# Deep Read

You are the deep page reading skill for Claude-Agent. Extract content from web pages that regular fetching can't handle.

## Input
`$ARGUMENTS` — a URL and optional extraction mode (default: summary).

## Steps

### 1. Check Availability
If cf-browser MCP is unavailable, fall back to WebFetch with a note:
"Using basic fetch — for JS-heavy pages, set up cf-browser (see README)."

### 2. Extract Content

Based on extraction mode:

**summary** (default):
- Call `browser_markdown(url=<URL>)` — returns clean markdown of the rendered page
- Summarize: TL;DR (1-2 sentences) + Key Points (3-5 bullets)

**data**:
- Call `browser_json(url=<URL>, prompt="Extract the main structured data")` — returns JSON
- Present as a formatted table or structured output

**links**:
- Call `browser_links(url=<URL>)` — returns all hyperlinks on the page
- Group by type: navigation, content, external

**screenshot**:
- Call `browser_screenshot(url=<URL>)` — returns PNG screenshot
- Save to `workspace/screenshot-[domain].png`

### 3. Save if Valuable
Save extracted content to `workspace/deepread-[domain-slug].md`.

### 4. Present
Format the output concisely:
- For summaries: TL;DR + Key Points (under 200 words)
- For data: formatted table
- For links: grouped list
- For screenshots: file path

## Rules
- Always try `browser_markdown` first — it's the cleanest output
- If the page requires login, note this and suggest the user provide cookies
- Keep summaries under 200 words
- Use the user's language for the summary
