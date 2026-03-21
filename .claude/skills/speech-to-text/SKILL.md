---
name: speech-to-text
description: >
  Transcribe audio files to text using local Whisper (no API key needed) or
  OpenAI Whisper API. Supports MP3, WAV, M4A, MP4, and more. Use when user
  says "transcribe this audio", "convert speech to text", "transcribe meeting",
  "what was said in audio.mp3", or any speech transcription request.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to transcribe audio or video to text. Triggers on: transcribe,
  speech to text, convert audio to text, what's in this recording, meeting notes
  from audio, subtitle generation, transcription.
argument-hint: "<audio-file> [--language en|zh|ja|auto] [--model tiny|base|small|medium|large]"
---

# Speech to Text

Transcribe audio files locally using OpenAI Whisper — no API key required.

## Prerequisites

Install local Whisper:
```bash
pip install openai-whisper
# Requires Python 3.8+
```

Also install ffmpeg (required by Whisper for audio processing):
```bash
brew install ffmpeg
```

First run downloads the model automatically to `~/.cache/whisper/`.

Model sizes (speed vs accuracy tradeoff):
| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny | 39MB | Very fast | Basic |
| base | 74MB | Fast | Good |
| small | 244MB | Moderate | Better |
| medium | 769MB | Slow | High |
| large | 1.5GB | Very slow | Best |

Default recommendation: `base` for speed, `small` for quality.

## Commands

### Basic Transcription
```bash
whisper audio.mp3                          # Auto-detect language, base model
whisper audio.mp3 --model small            # Better accuracy
whisper audio.mp3 --language en            # Force English
whisper audio.mp3 --language zh            # Force Chinese
whisper audio.mp3 --language ja            # Force Japanese
```

### Output Formats
```bash
whisper audio.mp3 --output_format txt      # Plain text
whisper audio.mp3 --output_format srt      # Subtitles with timestamps
whisper audio.mp3 --output_format vtt      # WebVTT subtitles
whisper audio.mp3 --output_format json     # Full JSON with timestamps
whisper audio.mp3 --output_format all      # All formats at once
```

### Output Directory
```bash
whisper audio.mp3 --output_dir ~/transcripts/
```

### Transcribe from Video
```bash
whisper meeting.mp4 --model small --output_format txt
```

### Batch Transcription
```bash
whisper *.mp3 --model base --output_dir ./transcripts/
```

## Usage Examples

**"Transcribe meeting.m4a"**
```bash
whisper meeting.m4a --model small --output_format txt --output_dir ./
cat meeting.txt
```

**"Transcribe in Chinese"**
```bash
whisper recording.mp3 --language zh --model small
```

**"Generate subtitles for video.mp4"**
```bash
whisper video.mp4 --model medium --output_format srt --output_dir ./
```

**"Quick transcription (fast)"**
```bash
whisper audio.mp3 --model tiny
```

## OpenAI API Alternative
If local Whisper is too slow and you have an API key:
```bash
# Set key: export OPENAI_API_KEY=sk-...
curl https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file="@audio.mp3" \
  -F model="whisper-1"
```

## Rules
- Check if whisper is installed: `which whisper || python3 -m whisper --help 2>/dev/null`
- If not installed, show `pip install openai-whisper` and stop
- Check if ffmpeg is also installed: `which ffmpeg`
- Default to `base` model for files under 30 minutes, `small` for longer
- Warn user if using `medium` or `large` — processing may take several minutes
- Supported input formats: mp3, mp4, m4a, wav, ogg, flac, webm, mov
- Output transcript file path in the response
- For very long files (>1 hour), suggest splitting with ffmpeg first
- Never display raw JSON output — summarize and show the transcript text
