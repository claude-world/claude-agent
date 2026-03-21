---
description: MCP server capabilities, auth requirements, and graceful degradation rules
globs: []
alwaysApply: true
---

# MCP Capabilities

## Tier 1: Zero-Auth (Always Available)

### trend-pulse (11 tools)
Trending topics from 20 free sources. No credentials needed.
- `get_trending` — fetch from all sources with geo filter
- `search_trends` — search by keyword across sources
- `get_content_brief` — writing brief with hook examples and patent strategies
- `get_scoring_guide` — 5-dimension patent-based scoring framework
- `get_platform_specs` — platform char limits, algo priorities, best posting times
- `get_review_checklist` — quality gate checklist
- `get_reel_guide` — video script structure guide

### claude-101 (27 tools)
24 use-case templates + 3 meta tools. No credentials needed.
- Use ad-hoc when a request matches a structured template (email drafting, code scaffolding, data analysis, etc.)
- No dedicated skill needed — the assistant can invoke tools directly

## Tier 2: Credential-Required (Optional)

### cf-browser (15 tools)
Headless Chrome via Cloudflare Browser Rendering.
- Requires: `CF_ACCOUNT_ID` + `CF_API_TOKEN` environment variables
- Setup: export the variables in your shell profile
- Key tools: `browser_markdown`, `browser_screenshot`, `browser_json`

### notebooklm (13 tools)
Google NotebookLM for research + artifact generation (audio, video, slides, etc.)
⚠️ `infographic` download is unreliable — use `slides` for visual content.
- Requires: one-time login via `uvx notebooklm login`
- Session stored at `~/.notebooklm/storage_state.json`
- Key tools: `nlm_create_notebook`, `nlm_generate`, `nlm_download`

## Degradation Rules

1. **NEVER block on MCP availability.** Always have a fallback path.
2. cf-browser unavailable → use WebFetch (works for most pages, fails on JS-heavy SPAs)
3. notebooklm unavailable → skip visual/audio generation, tell user setup instructions
4. trend-pulse unavailable → use WebSearch for trending topics
5. claude-101 unavailable → handle the use case directly without template tools
6. If an MCP tool call throws an error, use the fallback silently. Do NOT surface raw MCP errors to the user.
