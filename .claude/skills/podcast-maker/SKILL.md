---
name: podcast-maker
description: >
  Generate an AI podcast (audio + optional video) from any topic using
  Google NotebookLM. Ingests sources, synthesizes research, generates a
  natural two-host discussion. Use when user says "make a podcast about",
  "create an audio summary", "turn this into a podcast", "make me something
  to listen to".
allowed-tools:
  - mcp__notebooklm__nlm_create_notebook
  - mcp__notebooklm__nlm_add_source
  - mcp__notebooklm__nlm_research
  - mcp__notebooklm__nlm_generate
  - mcp__notebooklm__nlm_download
  - mcp__notebooklm__nlm_list_artifacts
  - mcp__cf-browser__browser_markdown
  - WebSearch
  - WebFetch
  - Read
  - Write
  - Bash
model: sonnet
user-invocable: true
when_to_use: >
  When user wants to create audio content, a podcast, or multimedia
  about a topic. Requires NotebookLM setup (uvx notebooklm login).
argument-hint: "<topic or URL(s)> [lang: zh-TW|en|ja] [with-video]"
---

# Podcast Maker

You are the podcast creation skill for Claude-Agent. Generate AI-powered podcasts from any topic.

## Input
`$ARGUMENTS` — topic or URL(s), optional language (default: infer from user profile), optional `with-video` flag.

## Prerequisites Check
If notebooklm MCP is unavailable, respond with setup instructions and stop:
```
Podcast creation requires NotebookLM. One-time setup:
1. Run: uvx notebooklm login
2. Sign in with your Google account in the browser
3. Try again after login succeeds
```

## Steps

### 1. Parse Input
- Extract topic or list of URLs
- Extract language (default: infer from user profile, fallback to `en`)
- Check for `with-video` flag

### 2. Collect Sources
Gather 2-5 authoritative sources on the topic:

- If URLs provided: use them directly
- If topic keyword: WebSearch for 3-5 relevant articles
- For each source URL: optionally `browser_markdown(url)` to verify content quality

### 3. Create Notebook
Call `nlm_create_notebook(title="Podcast: [topic]")` — returns notebook ID.

### 4. Add Sources
For each source:
- If URL: `nlm_add_source(notebook_id, url=<url>)`
- If text content: `nlm_add_source(notebook_id, text=<content>)`

Add 2-5 sources for a well-rounded discussion.

### 5. Deep Research (Optional)
Call `nlm_research(notebook_id, query="comprehensive overview of [topic]")` to enrich the notebook's knowledge base with web sources.

### 6. Generate Audio
Call `nlm_generate(notebook_id, type="audio", lang=<lang>)`.

This generates a natural-sounding two-host podcast discussion. The generation may take 1-3 minutes.

### 7. Download Audio
Call `nlm_download(notebook_id, type="audio", path="workspace/podcast-[slug].m4a")`.

Note: The output is M4A format (not MP3), despite what the filename might suggest.

### 8. Generate Video (if requested)
If `with-video` flag is set:

1. `nlm_generate(notebook_id, type="slides", lang=<lang>)` — generate presentation slides
   **IMPORTANT**: Generate slides AFTER audio, not in parallel (NotebookLM constraint).
2. `nlm_download(notebook_id, type="slides", path="workspace/slides-[slug].pdf")` — save PDF
3. Convert to video using Bash:
   ```bash
   pdftoppm -png -r 300 workspace/slides-[slug].pdf workspace/slide-[slug]
   ffmpeg -framerate 1/5 -pattern_type glob -i 'workspace/slide-[slug]-*.png' \
     -i workspace/podcast-[slug].m4a -c:v libx264 -pix_fmt yuv420p -c:a aac \
     -shortest workspace/video-[slug].mp4
   ```
4. If ffmpeg or pdftoppm are not installed, note this and provide the PDF + M4A separately.

### 9. Save Notes
Write to `workspace/podcast-[slug]-notes.md`:
```markdown
# Podcast: [Topic]
Date: YYYY-MM-DD
Language: [lang]
Sources: [N]

## Files
- Audio: workspace/podcast-[slug].m4a
- Slides: workspace/slides-[slug].pdf (if generated)
- Video: workspace/video-[slug].mp4 (if generated)

## Sources Used
1. [Title](URL)
2. [Title](URL)
...

## Notebook
ID: [notebook_id] (can be used for follow-up questions via nlm_ask)
```

### 10. Present to User
Show:
- Audio file path and estimated duration (typically 5-15 minutes)
- Video file path (if generated)
- Source list
- Offer: "Want me to ask the notebook follow-up questions, or create a different artifact (quiz, study guide, slides)?"

## Other Artifact Types
NotebookLM can also generate: `slides`, `report`, `quiz`, `flashcards`, `mind-map`, `data-table`, `study-guide`. If the user asks for any of these instead of a podcast, adapt steps 6-7 accordingly.
> ⚠️ `infographic` download is unreliable. Use `slides` instead for visual content.

## Rules
- Always add at least 2 sources for quality discussion
- Generate audio and slides SEQUENTIALLY, not in parallel
- M4A is the actual audio format (not MP3)
- If Bash tools (pdftoppm, ffmpeg) are unavailable for video, provide files separately
- Keep the reply concise — full details go to the workspace notes file
