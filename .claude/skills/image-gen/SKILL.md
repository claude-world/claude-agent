---
name: image-gen
description: >
  Generate images from text prompts using the OpenAI Images API (DALL-E 3) via
  curl. Supports single and batch generation with configurable size and quality.
  Use when user says "generate an image", "create a picture of", "make an image
  of", or "batch generate images".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to generate images from text descriptions. Triggers: "generate
  image of", "create a picture", "make an image", "draw", "visualize", "batch
  generate", "DALL-E".
argument-hint: "<prompt> [--size 1024x1024|1792x1024|1024x1792] [--quality standard|hd] [--n 1-4] [--out <filename>]"
---

# Image Gen

Generate images from text prompts using the OpenAI Images API (DALL-E 3) via `curl`.
Requires an `OPENAI_API_KEY` environment variable.

## Prerequisites

No CLI install needed — uses `curl` and `jq` (pre-installed on macOS/Linux).

**Set up your API key:**
```bash
export OPENAI_API_KEY="sk-..."
# Or add to ~/.zshrc / ~/.bashrc for persistence
```

Get a key: https://platform.openai.com/api-keys

## Commands

**Generate a single image (returns URL):**
```bash
curl -s https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A serene mountain lake at sunset, photorealistic",
    "n": 1,
    "size": "1024x1024",
    "quality": "standard"
  }' | jq -r '.data[0].url'
```

**Generate HD image:**
```bash
curl -s https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"dall-e-3","prompt":"<prompt>","n":1,"size":"1024x1024","quality":"hd"}' \
  | jq -r '.data[0].url'
```

**Download generated image to file:**
```bash
URL=$(curl -s https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"dall-e-3","prompt":"<prompt>","n":1,"size":"1024x1024","quality":"standard"}' \
  | jq -r '.data[0].url')
curl -s "$URL" -o workspace/image-output.png
```

**Batch generate (loop):**
```bash
PROMPTS=("prompt one" "prompt two" "prompt three")
for i in "${!PROMPTS[@]}"; do
  URL=$(curl -s https://api.openai.com/v1/images/generations \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"dall-e-3\",\"prompt\":\"${PROMPTS[$i]}\",\"n\":1,\"size\":\"1024x1024\",\"quality\":\"standard\"}" \
    | jq -r '.data[0].url')
  curl -s "$URL" -o "workspace/image-$i.png"
  echo "Saved workspace/image-$i.png"
done
```

## Size Options

| Size | Use Case |
|------|----------|
| `1024x1024` | Square (default, social media) |
| `1792x1024` | Landscape (banners, thumbnails) |
| `1024x1792` | Portrait (stories, posters) |

## Usage Examples

**Generate a social media card image:**
```bash
# Prompt + download to workspace
URL=$(curl -s https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"dall-e-3","prompt":"Minimalist tech blog cover, dark background, glowing circuit pattern, 1080x1080","n":1,"size":"1024x1024","quality":"hd"}' \
  | jq -r '.data[0].url')
curl -s "$URL" -o workspace/social-card.png
```

## Rules

- Always check that `OPENAI_API_KEY` is set: `[[ -z "$OPENAI_API_KEY" ]] && echo "OPENAI_API_KEY not set"`
- Never print the API key value in output
- Default to `dall-e-3`, size `1024x1024`, quality `standard` unless specified
- Always download images to `workspace/` directory; never just return raw URLs
- Name output files descriptively: `workspace/image-<slug>.png`
- For batch jobs, generate one at a time sequentially to avoid rate limits
- Check API response for errors: `jq '.error'` before using the URL
- Confirm completion with: "Generated <N> image(s) → workspace/<filename>"
- DALL-E 3 limit is n=1 per request; for multiple images, loop the request
