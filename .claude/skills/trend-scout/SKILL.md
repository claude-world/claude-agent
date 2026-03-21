---
name: trend-scout
description: >
  Discover trending topics from 20 free sources (Google Trends, HackerNews,
  Reddit, GitHub, Product Hunt, etc.) with no API keys required. Returns
  trend summaries with velocity and context. Use when user asks "what's
  trending", "any hot topics", "what's popular right now".
allowed-tools:
  - mcp__trend-pulse__get_trending
  - mcp__trend-pulse__search_trends
  - mcp__trend-pulse__get_trend_history
  - mcp__trend-pulse__take_snapshot
  - mcp__trend-pulse__list_sources
  - WebSearch
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user asks about trends, hot topics, viral topics, or what's popular
  in tech/social media/news right now. No credentials required.
argument-hint: "[geo: TW|US|JP] [keyword to filter]"
---

# Trend Scout

You are the trend discovery skill for Claude-Agent. Surface what's trending right now from 20 free sources.

## Input
`$ARGUMENTS` — optional geo tag (TW, US, JP) and/or keyword filter.

## Steps

### 1. Parse Arguments
- Extract geo code if present (default: no filter = world)
- Extract keyword filter if present

### 2. Fetch Trends
Call `get_trending(sources="", geo=<geo>, count=20)` to query all 20 sources simultaneously.

If a keyword was provided, also call `search_trends(query=<keyword>)` for cross-source results.

**Fallback**: If trend-pulse MCP is unavailable, use WebSearch for "trending topics today [geo]" and format results manually.

### 3. Enrich Top Results
For the top 3-5 trends, call `get_trend_history(topic=<name>)` to get:
- Velocity (rising/stable/declining)
- How long it's been trending
- Direction signal

### 4. Save Snapshot
Call `take_snapshot()` to save current trends for future velocity tracking.

### 5. Format Output

```
TRENDING NOW [geo/worldwide]

1. [Topic] — [Source] | [velocity: rising/stable]
   Brief: [1-sentence context]

2. [Topic] — [Source] | [velocity]
   Brief: [1-sentence context]

3-5. ...

Sources queried: [N] | Snapshot saved: [timestamp]
```

### 6. Suggest Follow-up
End with: "Want me to create a post about any of these? Or dig deeper into one?"

## Rules
- Keep output under 300 words
- Show source name for each trend (Google Trends, HN, Reddit, etc.)
- Include velocity direction when available
- If no trends found for a keyword, say so and suggest broader search
- Save substantive results to `workspace/trends-YYYY-MM-DD.md`
