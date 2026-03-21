---
name: gif-search
description: >
  Search and download GIFs from Giphy and Tenor using gifgrep CLI or direct API calls.
  Use when user says "find a gif of", "search for a funny gif", "get me a reaction gif",
  "download a gif", or any GIF search/download request.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to find, preview, or download GIFs. Triggers on: gif, animated image,
  reaction gif, find gif, search gif, send gif, download gif, funny gif for [topic].
argument-hint: "<search-query> [--limit 5] [--output ~/Downloads/] [--source giphy|tenor]"
---

# GIF Search

Search and download GIFs from Giphy or Tenor.

## Prerequisites

Install `gifgrep`:
```bash
brew install steipete/tap/gifgrep
# GitHub: https://github.com/steipete/gifgrep
```

Or use curl with Giphy/Tenor APIs directly (no extra install, requires API key):
```bash
# Giphy free API key: register at https://developers.giphy.com/
# Tenor free API key: register at https://developers.google.com/tenor/guides/quickstart
export GIPHY_API_KEY=your_key_here
export TENOR_API_KEY=your_key_here
```

## Commands

### gifgrep (recommended)
```bash
gifgrep search "dancing cat"              # Search and preview
gifgrep search "excited" --limit 5        # Limit results
gifgrep download "celebration" --out ~/Downloads/  # Search and download
gifgrep trending                           # Show trending GIFs
```

### Giphy API (curl fallback)
```bash
# Search GIFs
curl -s "https://api.giphy.com/v1/gifs/search?api_key=$GIPHY_API_KEY&q=QUERY&limit=5&rating=g" \
  | jq '.data[].url'

# Get direct GIF URL
curl -s "https://api.giphy.com/v1/gifs/search?api_key=$GIPHY_API_KEY&q=QUERY&limit=1&rating=g" \
  | jq -r '.data[0].images.original.url'

# Download first result
GIF_URL=$(curl -s "https://api.giphy.com/v1/gifs/search?api_key=$GIPHY_API_KEY&q=QUERY&limit=1&rating=g" \
  | jq -r '.data[0].images.original.url') && curl -s -L "$GIF_URL" -o ~/Downloads/result.gif
```

### Tenor API (curl fallback)
```bash
# Search
curl -s "https://tenor.googleapis.com/v2/search?q=QUERY&key=$TENOR_API_KEY&limit=5" \
  | jq '.results[].url'

# Get media URL
curl -s "https://tenor.googleapis.com/v2/search?q=QUERY&key=$TENOR_API_KEY&limit=1" \
  | jq -r '.results[0].media_formats.gif.url'
```

## Usage Examples

**"Find a gif of a happy dog"**
```bash
gifgrep search "happy dog" --limit 5 2>/dev/null || \
  curl -s "https://api.giphy.com/v1/gifs/search?api_key=$GIPHY_API_KEY&q=happy+dog&limit=5&rating=g" \
  | jq '.data[] | {title: .title, url: .url}'
```

**"Download a celebration gif"**
```bash
gifgrep download "celebration" --out ~/Downloads/ 2>/dev/null || {
  GIF_URL=$(curl -s "https://api.giphy.com/v1/gifs/search?api_key=$GIPHY_API_KEY&q=celebration&limit=1&rating=g" \
    | jq -r '.data[0].images.original.url')
  curl -s -L "$GIF_URL" -o ~/Downloads/celebration.gif
  echo "Downloaded: ~/Downloads/celebration.gif"
}
```

**"Show trending GIFs"**
```bash
gifgrep trending 2>/dev/null || \
  curl -s "https://api.giphy.com/v1/gifs/trending?api_key=$GIPHY_API_KEY&limit=10&rating=g" \
  | jq '.data[].title'
```

**"Convert gif to mp4 (smaller file)"**
```bash
ffmpeg -y -i input.gif -movflags faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" output.mp4
```

## Rules
- Check if gifgrep is installed first: `which gifgrep`
- If gifgrep not installed, fall back to curl + Giphy API
- If neither gifgrep nor GIPHY_API_KEY/TENOR_API_KEY is set, show install/setup instructions
- Default content rating: `g` (general audiences) unless user explicitly requests otherwise
- Default download directory: `~/Downloads/`
- Show GIF URLs in output so user can preview in browser
- Limit search results to 5 by default to avoid overwhelming output
- When downloading, report the saved file path
- Never cache or store API keys — read from environment only
