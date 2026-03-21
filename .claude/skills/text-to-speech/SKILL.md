---
name: text-to-speech
description: >
  Convert text to audio using macOS built-in `say` command (offline, instant),
  sherpa-onnx-tts (local neural TTS), or ElevenLabs API (high quality). Use when
  user says "read this out loud", "generate audio from text", "text to speech",
  "create voiceover", "speak this", or any TTS request.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to convert text to audio. Triggers on: text to speech, read aloud,
  generate voiceover, speak this, TTS, audio from text, create narration,
  read this message out loud.
argument-hint: "<text|file> [--voice <name>] [--output <file.aiff>] [--engine say|sherpa|elevenlabs]"
---

# Text to Speech

Convert text to audio. Three engine options from instant offline to high-quality cloud.

## Engines Overview

| Engine | Quality | Speed | Cost | Install |
|--------|---------|-------|------|---------|
| `say` (macOS) | Decent | Instant | Free | Built-in |
| `sherpa-onnx-tts` | Good | Fast | Free | pip install |
| ElevenLabs API | Excellent | ~2s | Paid | API key |

Default: use `say` for quick playback, save to file with `-o`.

## Engine 1: macOS `say` (Built-in, No Install)

```bash
# Speak immediately
say "Hello, world!"

# Save to audio file
say "Your message here" -o output.aiff

# Convert to MP3 (requires ffmpeg)
say "Your message here" -o /tmp/tts.aiff && ffmpeg -y -i /tmp/tts.aiff output.mp3

# List available voices
say -v ?

# Use specific voice
say -v Samantha "Hello from Samantha"
say -v Daniel "Hello from Daniel"
say -v Mei-Jia "你好，這是中文語音"
say -v Kyoko "こんにちは、日本語です"

# Control speed (default 200 wpm)
say -r 150 "Slower speech"
say -r 250 "Faster speech"

# Read from file
say -f input.txt -o output.aiff
```

### Popular macOS Voices
| Language | Voice | Note |
|----------|-------|------|
| English | Samantha | Default US |
| English | Daniel | UK accent |
| Chinese | Mei-Jia | Traditional Chinese |
| Chinese | Ting-Ting | Simplified Chinese |
| Japanese | Kyoko | Japanese |

## Engine 2: sherpa-onnx-tts (Local Neural TTS)

```bash
# Install
pip install sherpa-onnx

# Download a model (example: VITS English)
# See: https://k2-fsa.github.io/sherpa/onnx/tts/index.html
sherpa-onnx-tts --help

# Generate audio
sherpa-onnx-tts \
  --vits-model=./model.onnx \
  --vits-lexicon=./lexicon.txt \
  --vits-tokens=./tokens.txt \
  --output-filename=output.wav \
  "Text to convert to speech"
```

## Engine 3: ElevenLabs API (Highest Quality)

```bash
# Requires: export ELEVENLABS_API_KEY=your_key_here

# List voices
curl -s https://api.elevenlabs.io/v1/voices \
  -H "xi-api-key: $ELEVENLABS_API_KEY" | jq '.voices[].name'

# Generate audio (Rachel voice)
curl -s -X POST \
  "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Your text here", "model_id": "eleven_monolingual_v1"}' \
  -o output.mp3
```

## Usage Examples

**"Read this out loud: Good morning"** (immediate playback)
```bash
say "Good morning"
```

**"Save 'Meeting starts in 5 minutes' to audio"**
```bash
say "Meeting starts in 5 minutes" -o ~/Desktop/reminder.aiff
```

**"Generate MP3 from this text"**
```bash
say "Your text here" -o /tmp/tts_out.aiff
ffmpeg -y -i /tmp/tts_out.aiff ~/Desktop/output.mp3 2>/dev/null
echo "Saved: ~/Desktop/output.mp3"
```

**"What voices are available?"**
```bash
say -v ? | head -20
```

**"Read this in Chinese"**
```bash
say -v Mei-Jia "你好，歡迎使用語音服務"
```

## Rules
- `say` is always available on macOS — use it as default, no install check needed
- For file output: default save to `~/Desktop/tts_output_<timestamp>.aiff`
- Convert to MP3 only if user requests it and ffmpeg is available
- If user wants higher quality, suggest sherpa-onnx or ElevenLabs
- For ElevenLabs, check ELEVENLABS_API_KEY is set before attempting API call
- Never hardcode API keys — always read from environment variable
- Long text (>500 words): warn user it may take a moment, especially for sherpa/ElevenLabs
- For non-English, default to the appropriate system voice (Mei-Jia for ZH, Kyoko for JA)
