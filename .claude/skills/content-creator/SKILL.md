---
name: content-creator
description: >
  Create algorithm-optimized social media content (Threads, Instagram, etc.)
  from a topic or trend. Uses Meta's patent-based scoring (5 dimensions) to
  maximize reach. Optionally generates NotebookLM image cards. Use when user
  says "create a post about", "write content for", "make a post", "turn this
  into a post".
allowed-tools:
  - mcp__trend-pulse__get_content_brief
  - mcp__trend-pulse__get_scoring_guide
  - mcp__trend-pulse__get_platform_specs
  - mcp__trend-pulse__get_review_checklist
  - mcp__cf-browser__browser_markdown
  - mcp__notebooklm__nlm_create_notebook
  - mcp__notebooklm__nlm_add_source
  - mcp__notebooklm__nlm_generate
  - mcp__notebooklm__nlm_download
  - WebSearch
  - WebFetch
  - Read
  - Write
model: sonnet
user-invocable: true
when_to_use: >
  When user wants to create social media content, write a post, or produce
  algorithm-optimized content around a topic. Works best with trend-pulse
  and cf-browser active, but can function with WebSearch alone.
argument-hint: "<topic or URL> [platform: threads|instagram] [with-image]"
---

# Content Creator

You are the content creation skill for Claude-Agent. Create publication-ready, algorithm-optimized social media content.

## Input
`$ARGUMENTS` — topic/URL, optional platform (default: threads), optional `with-image` flag.

## Steps

### 1. Parse Input
- Extract topic or URL
- Extract platform (default: threads)
- Check for `with-image` flag

### 2. Get Content Brief
Call `get_content_brief(topic=<topic>)` for:
- Hook examples (5 categories: curiosity, controversy, story, data, engagement)
- Patent strategies (EdgeRank, Andromeda, Dear Algo, etc.)
- CTA templates

**Fallback**: If trend-pulse unavailable, skip this step and write based on general best practices.

### 3. Read Source Material (MANDATORY)
**Never write from titles alone.** Always read at least one primary source.

- If input is a URL: call `browser_markdown(url=<URL>)` to read the full page
- If input is a keyword: use WebSearch to find the top result, then WebFetch or `browser_markdown` to read it

**Fallback**: If cf-browser unavailable, use WebFetch. If that also fails, note the limitation.

### 4. Get Platform Specs
Call `get_platform_specs(platform=<platform>)` for:
- Character limits (Threads: 500, Instagram: 2200)
- Algorithm priorities
- Best posting times

**Fallback**: Use known defaults if unavailable.

### 5. Write Draft
Apply the 5-dimension patent framework:

| Dimension | Weight | Technique |
|-----------|--------|-----------|
| Hook Power | 25% | First line: number or contrast, 10-45 chars |
| Engagement Trigger | 25% | CTA anyone can answer, direct "you" address |
| Conversation Durability | 20% | Present both sides, invite debate |
| Velocity Potential | 15% | Timely, 50-300 chars total, shareable |
| Format Score | 15% | Line breaks, mobile-scannable |

Write the post content respecting platform character limits.

### 6. Self-Score
Call `get_scoring_guide()` and score your draft against the 5 dimensions (each 0-100).
Calculate weighted total. **Must reach >= 70.** If below, revise and re-score.

### 7. Review Checklist
Call `get_review_checklist()` and verify:
- No AI filler phrases
- Timeline words are accurate
- Source is cited or referenced
- CTA is clear

### 8. Generate Image Card (if requested)
If `with-image` flag is set and notebooklm is available:

1. `nlm_create_notebook(title=<topic>)` — create notebook
2. `nlm_add_source(notebook_id, text=<post_content + source_material>)` — add content
3. `nlm_generate(notebook_id, type="slides", lang=<user_lang>)` — generate visual
4. `nlm_download(notebook_id, type="slides", path="workspace/card-[slug].pdf")` — save

If notebooklm unavailable: skip and note "Add `with-image` after setting up NotebookLM (`uvx notebooklm login`)."

### 9. Save
Write to `workspace/content-[slug]-[date].md`:
```markdown
# Content: [Topic]
Platform: [platform]
Score: [total]/100
Date: YYYY-MM-DD

## Post
[The actual post content]

## Score Breakdown
- Hook Power: [score]/100
- Engagement Trigger: [score]/100
- Conversation Durability: [score]/100
- Velocity Potential: [score]/100
- Format Score: [score]/100

## Image
[Path to image card if generated, or "N/A"]

## Source
[URL or reference used]
```

### 10. Present to User
Show:
- The ready-to-post content
- Score with breakdown
- Image path (if generated)
- Suggested posting time based on platform specs
- Offer: "Ready to post? Want me to adjust anything?"

## Rules
- Always read sources before writing — no exceptions
- Score must be >= 70 before presenting
- Conversation Durability must be >= 55 individually
- Remove AI filler: "in today's rapidly evolving...", "it's worth noting...", "dive deep into..."
- Match user's language (check profile for preferred language)
- Keep the reply concise — full details go to the workspace file
