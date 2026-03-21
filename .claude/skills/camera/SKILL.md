---
name: camera
description: >
  Capture frames or short clips from RTSP/ONVIF network cameras or local webcams
  using ffmpeg or camsnap. Use when user says "take a snapshot from camera",
  "capture front door", "grab a frame from the security cam", or any camera
  capture request involving IP cameras or webcams.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to capture a photo or short clip from a camera. Triggers on:
  snapshot, grab frame, capture camera, security cam photo, webcam picture,
  RTSP capture, ONVIF camera.
argument-hint: "<snapshot|clip> [camera-url|device] [output-file]"
---

# Camera Capture

Capture snapshots and clips from IP cameras (RTSP/ONVIF) and webcams.

## Prerequisites

Install `ffmpeg` (required):
```bash
brew install ffmpeg
```

For ONVIF device discovery:
```bash
pip install onvif-zeep
# or: brew install gst-plugins-bad  (includes ONVIF support)
```

Camera stream URLs are typically in these formats:
- RTSP: `rtsp://user:pass@192.168.1.x:554/stream`
- HTTP MJPEG: `http://192.168.1.x:8080/video`
- Local webcam (macOS): `/dev/video0` or device index `0`

## Commands

### Snapshot — single frame to image
```bash
# From RTSP stream
ffmpeg -y -rtsp_transport tcp -i "rtsp://user:pass@IP:554/stream1" \
  -vframes 1 -q:v 2 snapshot.jpg 2>/dev/null

# From HTTP MJPEG
ffmpeg -y -i "http://IP:8080/video" -vframes 1 snapshot.jpg 2>/dev/null

# From local webcam (macOS AVFoundation)
ffmpeg -y -f avfoundation -i "0" -vframes 1 webcam.jpg 2>/dev/null
```

### Clip — short video segment
```bash
# 10-second clip from RTSP
ffmpeg -y -rtsp_transport tcp -i "rtsp://user:pass@IP:554/stream1" \
  -t 10 -c copy clip.mp4 2>/dev/null

# 5-second clip from webcam
ffmpeg -y -f avfoundation -i "0" -t 5 webcam_clip.mp4 2>/dev/null
```

### List Available Webcams (macOS)
```bash
ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -E "^\[AVFoundation"
```

### Thumbnail from saved video
```bash
ffmpeg -y -i input.mp4 -ss 00:00:02 -vframes 1 thumbnail.jpg 2>/dev/null
```

## Usage Examples

**"Snapshot from front door camera at 192.168.1.10"**
```bash
ffmpeg -y -rtsp_transport tcp -i "rtsp://admin:admin@192.168.1.10:554/stream1" \
  -vframes 1 -q:v 2 ~/Pictures/front_door_$(date +%Y%m%d_%H%M%S).jpg 2>/dev/null
echo "Saved to ~/Pictures/"
```

**"Take a photo from my webcam"**
```bash
ffmpeg -y -f avfoundation -i "0" -vframes 1 ~/Pictures/webcam_$(date +%Y%m%d_%H%M%S).jpg 2>/dev/null
```

**"Record 15 seconds from backyard camera"**
```bash
ffmpeg -y -rtsp_transport tcp -i "rtsp://user:pass@192.168.1.20:554/stream" \
  -t 15 -c copy ~/Movies/backyard_$(date +%Y%m%d_%H%M%S).mp4 2>/dev/null
```

## Rules
- Check if ffmpeg is installed first: `which ffmpeg`
- If not installed, show `brew install ffmpeg` and stop
- Always use `-y` flag to overwrite without prompting
- Suppress verbose ffmpeg output with `2>/dev/null` — only show the result path
- Default output directory: `~/Pictures/` for snapshots, `~/Movies/` for clips
- Auto-append timestamp to filenames to avoid collisions
- If RTSP connection times out, suggest using `-rtsp_transport tcp` (already included above)
- If user doesn't provide camera URL, ask for it or list available webcams
- Never log camera credentials in output or memory
