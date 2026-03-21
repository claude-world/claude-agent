---
name: sonos
description: >
  Control Sonos speakers via CLI. Discover devices, play/pause, adjust volume,
  group/ungroup speakers, browse favorites, and check status of all rooms.
  Use when user mentions Sonos, wants room-specific audio control, or says
  "play in kitchen", "group all speakers", "pause living room".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to control Sonos speakers: play/pause/volume in specific rooms,
  group or ungroup speakers, discover what's playing where, or manage multi-room audio.
  Triggers on: Sonos, speaker control, room audio, group speakers, play in [room].
argument-hint: "<discover|status|play|pause|volume|group|favorite> [room] [args]"
---

# Sonos Control

Control Sonos speakers on your local network.

## Prerequisites

Install `sonos` CLI:
```bash
brew install sonoscli
# GitHub: https://github.com/ryanolf/sonos-cli
```

Or install the Python `soco` based tool:
```bash
pip install soco-cli
# Provides: sonos command
```

The speaker must be on the same local network as your machine. No account login required — uses local network discovery.

## Commands

### Discovery
```bash
sonos discover                  # Find all Sonos speakers on network
sonos list                      # List all rooms/groups
```

### Playback
```bash
sonos [room] play               # Resume playback
sonos [room] pause
sonos [room] next               # Next track
sonos [room] previous
sonos [room] status             # Current track + state
```

### Volume
```bash
sonos [room] volume             # Get current volume
sonos [room] volume 40          # Set volume 0-100
sonos [room] volume +10         # Relative increase
sonos [room] volume -5          # Relative decrease
sonos [room] mute               # Toggle mute
```

### Groups
```bash
sonos [room1] join [room2]      # Add room1 to room2's group
sonos [room] unjoin             # Remove from group
sonos [room] group              # Show current group members
```

### Favorites / Playlists
```bash
sonos [room] favorites          # List Sonos favorites
sonos [room] play_favorite "Name"  # Play a saved favorite
sonos [room] playlist list      # List playlists
```

## Usage Examples

**"Discover Sonos speakers"**
```bash
sonos discover
```

**"Pause the kitchen"**
```bash
sonos Kitchen pause
```

**"Set living room volume to 50"**
```bash
sonos "Living Room" volume 50
```

**"Group all speakers"**
```bash
# Get rooms from discover, then join all to one coordinator
sonos discover
# Then: sonos Kitchen join "Living Room"
```

**"What's playing everywhere?"**
```bash
sonos list
```

## Rules
- Check if CLI is installed first: `which sonos`
- If not installed, show brew install command and stop
- Room names are case-sensitive and may contain spaces — use quotes around multi-word room names
- If discovery finds no speakers, tell user to check that speakers are on the same WiFi network
- For relative volume changes, confirm the final value in your response
- Keep responses concise: room name + state + track info on one line
