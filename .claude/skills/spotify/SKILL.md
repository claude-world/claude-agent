---
name: spotify
description: >
  Control Spotify playback via CLI. Play, pause, skip, search tracks/albums/artists,
  manage the queue, and browse playlists. Use when user says "play", "pause",
  "skip", "queue", "search Spotify", "what's playing", or any music control request.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to control Spotify playback, search for music, manage playlists,
  or queue tracks. Triggers on: play/pause/skip music, search Spotify, what's playing,
  add to queue, show playlist.
argument-hint: "<play|pause|skip|search|queue|playlist|status> [query]"
---

# Spotify Control

Control Spotify playback from the terminal.

## Prerequisites

Install `spotify_player` (TUI client with daemon mode):
```bash
brew install spotify_player
# or cargo install spotify_player
```

Or install `spogo` (simpler CLI):
```bash
cargo install spogo
```

First-time auth: run `spotify_player` once to complete OAuth login. Credentials are cached after that.

## Commands

### spotify_player (recommended)
```bash
# Status / now playing
spotify_player playback

# Playback controls
spotify_player playback play-pause
spotify_player playback next
spotify_player playback previous
spotify_player playback volume --percent 50

# Search and play
spotify_player search "query"          # interactive search
spotify_player play --name "song" --type track

# Queue
spotify_player queue list
spotify_player queue add "track uri"

# Playlists
spotify_player list --format json
```

### spogo (simpler alternative)
```bash
spogo status          # now playing
spogo play            # resume
spogo pause
spogo next
spogo prev
spogo search "query"
spogo volume 80       # 0-100
```

## Usage Examples

**"What's playing?"**
```bash
spotify_player playback 2>/dev/null || spogo status 2>/dev/null
```

**"Play some jazz"**
```bash
spotify_player search "jazz" || spogo search "jazz"
```

**"Pause"**
```bash
spotify_player playback play-pause || spogo pause
```

**"Volume to 40%"**
```bash
spotify_player playback volume --percent 40 || spogo volume 40
```

**"Skip"**
```bash
spotify_player playback next || spogo next
```

## Rules
- Check if CLI is installed first: `which spotify_player || which spogo`
- If neither installed, show install instructions and stop
- Try `spotify_player` first, fall back to `spogo`
- If authentication fails, tell user to run `spotify_player` once interactively to log in
- Keep responses concise: one line per track/status
- Never expose OAuth tokens in output
- Volume accepts 0-100 integer values
