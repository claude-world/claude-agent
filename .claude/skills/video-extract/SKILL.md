---
name: video-extract
description: >
  Extract frames, clips, and audio from video files using ffmpeg. Convert between
  formats, trim segments, create thumbnails, extract subtitles, and batch process.
  Use when user says "extract frames from video", "clip this segment", "convert to mp4",
  "get audio from video", "create thumbnail", or any video processing task.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user needs to process a video file: extract frames/clips/audio, convert formats,
  trim/cut, get a thumbnail, or batch process videos. Triggers on: extract frames,
  clip video, convert video, trim, get audio from video, thumbnail, ffmpeg tasks.
argument-hint: "<frames|clip|audio|convert|thumbnail|info> <input-file> [options]"
---

# Video Extract

Process video files with ffmpeg: extract frames, clips, audio, and more.

## Prerequisites

Install `ffmpeg`:
```bash
brew install ffmpeg
```

Verify: `ffmpeg -version`

## Commands

### Video Info
```bash
ffprobe -v quiet -print_format json -show_format -show_streams input.mp4
# Quick summary:
ffprobe -v error -show_entries format=duration,size,bit_rate \
  -show_entries stream=codec_name,width,height,r_frame_rate input.mp4
```

### Extract Frames
```bash
# Single frame at timestamp
ffmpeg -y -i input.mp4 -ss 00:01:30 -vframes 1 frame.jpg

# Frame every N seconds
ffmpeg -y -i input.mp4 -vf fps=1/5 frames/frame_%04d.jpg   # every 5 sec

# All frames (use sparingly on long videos)
ffmpeg -y -i input.mp4 frames/frame_%04d.png
```

### Extract / Trim Clip
```bash
# Clip from start time, duration
ffmpeg -y -ss 00:00:30 -i input.mp4 -t 00:00:15 -c copy clip.mp4

# Clip from start to end time
ffmpeg -y -ss 00:01:00 -to 00:02:30 -i input.mp4 -c copy clip.mp4

# Re-encode for clean cut (slower but frame-accurate)
ffmpeg -y -i input.mp4 -ss 00:00:30 -t 00:00:15 clip.mp4
```

### Extract Audio
```bash
# Extract as MP3
ffmpeg -y -i input.mp4 -vn -acodec mp3 -q:a 2 audio.mp3

# Extract as AAC (smaller)
ffmpeg -y -i input.mp4 -vn -acodec aac -b:a 192k audio.aac

# Extract as WAV (lossless)
ffmpeg -y -i input.mp4 -vn audio.wav
```

### Format Conversion
```bash
# To MP4 (H.264 + AAC, web-compatible)
ffmpeg -y -i input.mov -c:v libx264 -c:a aac -crf 23 output.mp4

# To WebM
ffmpeg -y -i input.mp4 -c:v libvpx-vp9 -c:a libopus output.webm

# To GIF
ffmpeg -y -i input.mp4 -vf "fps=10,scale=640:-1" output.gif

# Compress (reduce size)
ffmpeg -y -i input.mp4 -vcodec libx264 -crf 28 compressed.mp4
```

### Create Thumbnail
```bash
# At specific timestamp
ffmpeg -y -i input.mp4 -ss 00:00:05 -vframes 1 -vf scale=640:-1 thumb.jpg

# Best frame (scene detection)
ffmpeg -y -i input.mp4 -vf "thumbnail,scale=640:-1" -frames:v 1 thumb.jpg
```

### Subtitles
```bash
# Extract embedded subtitles
ffmpeg -y -i input.mkv -map 0:s:0 subtitles.srt

# Burn subtitles into video
ffmpeg -y -i input.mp4 -vf subtitles=subtitles.srt output_with_subs.mp4
```

## Usage Examples

**"Extract a frame every 10 seconds from lecture.mp4"**
```bash
mkdir -p frames
ffmpeg -y -i lecture.mp4 -vf fps=1/10 frames/frame_%04d.jpg
echo "Frames saved to ./frames/"
```

**"Cut from 2:30 to 5:00 in video.mp4"**
```bash
ffmpeg -y -ss 00:02:30 -to 00:05:00 -i video.mp4 -c copy clip_2m30s_to_5m.mp4
```

**"Get the audio from interview.mp4 as MP3"**
```bash
ffmpeg -y -i interview.mp4 -vn -acodec mp3 -q:a 2 interview_audio.mp3
```

**"Convert recording.mov to mp4"**
```bash
ffmpeg -y -i recording.mov -c:v libx264 -c:a aac -crf 23 recording.mp4
```

## Rules
- Check if ffmpeg is installed first: `which ffmpeg`
- If not installed, show `brew install ffmpeg` and stop
- Always use `-y` flag to avoid interactive prompts
- Use `-c copy` for lossless clip extraction when possible (much faster)
- For large files, warn user about processing time before starting long operations
- Default output goes in the same directory as input with a descriptive suffix
- When extracting many frames, create a subdirectory to avoid clutter
- Report output file path and size after completion
