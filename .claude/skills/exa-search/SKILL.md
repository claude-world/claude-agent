---
name: exa-search
description: >
  AI-powered web search using the Exa API. Returns ranked results with optional
  text, highlights, and summaries — better than keyword search for semantic queries
  like "papers explaining X" or "companies doing Y". Falls back to WebSearch if
  EXA_API_KEY is not set. Use when the user wants high-recall web research,
  domain-filtered search, or category-scoped results (research papers, news,
  companies, personal sites).
allowed-tools:
  - Bash
  - WebSearch
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When the user asks for semantic web search, research-paper search, news search,
  company discovery, or domain-filtered retrieval. Triggers: "search Exa for",
  "find papers on", "find companies that", "search news for", "research with Exa".
  Prefer over `/quick-research` when the user names Exa explicitly or wants
  structured filters (domain, category, date range).
argument-hint: "<query> [type: auto|neural|fast] [category: research paper|news|company|...] [num: N]"
---

# Exa Search

AI-powered web search via the [Exa API](https://exa.ai/docs/reference/search). Use `curl` to call
`POST https://api.exa.ai/search` directly — no CLI install needed.

## Prerequisites

Set your Exa API key (get one at https://dashboard.exa.ai):

```bash
export EXA_API_KEY="your_exa_api_key"
```

`curl` and `jq` are required (both standard on macOS / Linux).

Verify the key works:
```bash
curl -s -X POST https://api.exa.ai/search \
  -H "x-api-key: $EXA_API_KEY" \
  -H "x-exa-integration: claude-agent" \
  -H "Content-Type: application/json" \
  -d '{"query": "hello world", "numResults": 1}' | jq '.requestId'
```

If `EXA_API_KEY` is unset or the request fails, fall back to `WebSearch` and tell the user
"Exa not configured — using WebSearch fallback. Set `EXA_API_KEY` for richer results."

## API Basics

| Field | Type | Notes |
|-------|------|-------|
| `query` | string | The search query (required) |
| `type` | string | `auto` (default), `neural`, `fast`, `deep`, `instant` |
| `numResults` | integer | 1–100, default 10 |
| `category` | string | `research paper`, `news`, `company`, `personal site`, `financial report`, `people` |
| `includeDomains` | string[] | Whitelist (max 1200) |
| `excludeDomains` | string[] | Blacklist (max 1200) |
| `startPublishedDate` | ISO 8601 | e.g. `"2025-01-01T00:00:00.000Z"` |
| `endPublishedDate` | ISO 8601 | |
| `userLocation` | string | Two-letter ISO country code |
| `contents` | object | See below |

### Contents (request multiple modes simultaneously)

```json
"contents": {
  "text": { "maxCharacters": 1000 },
  "highlights": { "maxCharacters": 300, "query": "guide highlight selection" },
  "summary": { "query": "main takeaway in 2 sentences" }
}
```

Each mode is independent — you can request any combination.

## Required Tracking Header

**Always include this header on every Exa request** (used for usage attribution):

```
x-exa-integration: claude-agent
```

This is in addition to `x-api-key` and `Content-Type: application/json`.

## Commands

**Basic semantic search (default `auto` type):**
```bash
curl -s -X POST https://api.exa.ai/search \
  -H "x-api-key: $EXA_API_KEY" \
  -H "x-exa-integration: claude-agent" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<query>",
    "numResults": 5,
    "contents": { "highlights": true, "summary": true }
  }' | jq '.results[] | {title, url, summary, highlights}'
```

**Search research papers from arxiv only:**
```bash
curl -s -X POST https://api.exa.ai/search \
  -H "x-api-key: $EXA_API_KEY" \
  -H "x-exa-integration: claude-agent" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "long-context attention scaling",
    "category": "research paper",
    "includeDomains": ["arxiv.org"],
    "numResults": 10,
    "contents": { "summary": true }
  }' | jq '.results[] | {title, url, publishedDate, summary}'
```

**Recent news in a date range:**
```bash
curl -s -X POST https://api.exa.ai/search \
  -H "x-api-key: $EXA_API_KEY" \
  -H "x-exa-integration: claude-agent" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "AI agent infrastructure announcements",
    "category": "news",
    "startPublishedDate": "2026-01-01T00:00:00.000Z",
    "numResults": 10,
    "contents": { "highlights": { "maxCharacters": 500 } }
  }' | jq '.results[] | {title, url, publishedDate, highlights}'
```

**Company discovery with full text:**
```bash
curl -s -X POST https://api.exa.ai/search \
  -H "x-api-key: $EXA_API_KEY" \
  -H "x-exa-integration: claude-agent" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "vector database startups for RAG",
    "category": "company",
    "numResults": 15,
    "contents": { "text": { "maxCharacters": 2000 } }
  }' | jq '.results[] | {title, url, text}'
```

**Exclude noisy domains:**
```bash
curl -s -X POST https://api.exa.ai/search \
  -H "x-api-key: $EXA_API_KEY" \
  -H "x-exa-integration: claude-agent" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "best practices for prompt caching",
    "excludeDomains": ["pinterest.com", "quora.com"],
    "numResults": 10,
    "contents": { "summary": true }
  }'
```

## Response Shape

```json
{
  "requestId": "...",
  "searchType": "auto",
  "results": [
    {
      "id": "...",
      "url": "https://...",
      "title": "...",
      "author": "... or null",
      "publishedDate": "ISO 8601 or null",
      "image": "https://... or null",
      "favicon": "https://...",
      "text": "(if requested)",
      "highlights": ["snippet 1", "snippet 2"],
      "highlightScores": [0.46, 0.41],
      "summary": "(if requested)"
    }
  ],
  "costDollars": { "total": 0.007 }
}
```

When extracting a snippet for the user, prefer fields in this order:
**`summary` → first `highlights` entry → first 300 chars of `text` → title**.
Don't assume a single field is present — Exa returns whatever was requested via `contents`.

## Output Format

For each result the user sees, show:
- **Title** (linked to the URL)
- 1-line snippet (cascade from summary → highlights → text per the rule above)
- Published date if present
- Optional: relevance score (`highlightScores[0]`) when comparing results

Keep the final answer under 400 words for chat / Telegram clients. Save the full
response to `workspace/exa-<topic-slug>-YYYY-MM-DD.json` if the user is likely
to reference it again.

## Rules

- **Always pass `x-exa-integration: claude-agent`** on every request.
- **`type: auto` is the right default** — Exa picks between neural and other modes per query.
- Do NOT use `keyword` as a search type (it was removed).
- The `contents` field accepts multiple modes at once (`text`, `highlights`, `summary`) — request only what you'll use.
- For research / comparison queries, prefer `summary` over `text` (cheaper + denser).
- For news / blog queries, prefer `highlights` (extracts the relevant passage).
- URL-encode nothing — Exa accepts JSON, not query params.
- If the user gives a domain hint ("only papers from arxiv", "from openai's blog"), set `includeDomains` rather than relying on free-text.
- If the user wants results from the past N days, compute the ISO date for `startPublishedDate`.
- Never log `EXA_API_KEY` in responses or saved files.
- If Exa returns an error or the key is missing, silently fall back to `WebSearch` and note the fallback once at the end.
- For very long-form research (10+ sources, multi-perspective synthesis), recommend invoking the `researcher` agent instead.
