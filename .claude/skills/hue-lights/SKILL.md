---
name: hue-lights
description: >
  Control Philips Hue smart lights via CLI. Turn lights on/off, adjust brightness
  and color, activate scenes, control rooms and zones. Use when user says
  "turn off bedroom lights", "set lights to warm", "activate movie scene",
  "dim the office", or any Philips Hue light control request.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to control Philips Hue lights: on/off, brightness, color,
  scenes, rooms, or groups. Triggers on: lights on/off, dim, brighten, color,
  scene, Hue, smart lights, bedroom/kitchen/office lights.
argument-hint: "<on|off|scene|color|bright|list> [room|light] [args]"
---

# Hue Lights Control

Control Philips Hue lights via the local network API.

## Prerequisites

Install `openhue`:
```bash
brew install openhue/tap/openhue-cli
# Docs: https://www.openhue.io/
```

First-time setup — register with your Hue Bridge:
```bash
openhue setup
# Press the physical button on your Hue Bridge when prompted
# Credentials saved to ~/.config/openhue/
```

The Hue Bridge must be on your local network. No cloud account needed after initial setup.

## Commands

### Discovery
```bash
openhue get lights              # List all lights (id, name, state)
openhue get rooms               # List all rooms
openhue get zones               # List all zones
openhue get scenes              # List all scenes
```

### Light Control
```bash
openhue set light "Name" --on            # Turn on
openhue set light "Name" --off           # Turn off
openhue set light "Name" --brightness 80 # 1-100
openhue set light "Name" --color-temp 4000 # Kelvin (2000-6500)
openhue set light "Name" --hue 120 --sat 100  # Color (hue 0-360, sat 0-100)
```

### Room / Group Control
```bash
openhue set room "Living Room" --on
openhue set room "Bedroom" --off
openhue set room "Office" --brightness 50
```

### Scenes
```bash
openhue set scene "Relax"       # Activate scene by name
openhue set scene "Movie"
openhue set scene "Energize"
```

## Usage Examples

**"Turn off bedroom lights"**
```bash
openhue set room "Bedroom" --off
```

**"Set living room to warm and dim (30%)"**
```bash
openhue set room "Living Room" --on --brightness 30 --color-temp 2700
```

**"Activate movie scene"**
```bash
openhue set scene "Movie"
```

**"List all available scenes"**
```bash
openhue get scenes
```

**"Bright white in office"**
```bash
openhue set room "Office" --on --brightness 100 --color-temp 6500
```

## Common Color Temperatures
| Mode | Kelvin |
|------|--------|
| Candle / Very warm | 2000 |
| Warm white | 2700 |
| Neutral white | 4000 |
| Cool white / Daylight | 6500 |

## Rules
- Check if CLI is installed first: `which openhue`
- If not installed, show brew install command and stop
- If setup not done (no config), instruct user to run `openhue setup` first
- Room and light names are case-sensitive — use `openhue get rooms` to confirm exact names
- Brightness is 1-100 (not 0-255)
- If a command fails, check if the Bridge IP is still reachable on the local network
- Keep responses concise: list changes made, not raw API output
