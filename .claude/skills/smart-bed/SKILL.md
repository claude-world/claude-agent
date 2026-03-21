---
name: smart-bed
description: >
  Control Eight Sleep Pod smart bed via CLI. Check bed status, set mattress
  temperature for each side, manage alarm schedules, and view sleep data.
  Use when user says "set bed temperature", "turn on bed heating",
  "check sleep score", "set alarm", or any Eight Sleep control request.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to control an Eight Sleep Pod: temperature for left/right side,
  alarm schedules, sleep data, or bed on/off. Triggers on: Eight Sleep, bed temp,
  heating/cooling, sleep score, pod temperature, set alarm on bed.
argument-hint: "<status|temp|alarm|schedule|off> [left|right|both] [value]"
---

# Smart Bed Control (Eight Sleep)

Control your Eight Sleep Pod mattress temperature and schedules.

## Prerequisites

Install `eightctl`:
```bash
pip install eightctl
# GitHub: https://github.com/mezz64/pyeight (Python library)
# CLI wrapper: pip install eightctl
```

Or use the Python library directly:
```bash
pip install pyeight
```

First-time setup — set credentials:
```bash
export EIGHT_USER="your@email.com"
export EIGHT_PASS="yourpassword"
# Or create ~/.config/eightctl/config.yml
```

Requires an Eight Sleep account and active Pod subscription.

## Commands

### Status
```bash
eightctl status                 # Full device status
eightctl status --side left     # Left side only
eightctl status --side right    # Right side only
eightctl sleep-data             # Last night's sleep summary
```

### Temperature Control
Temperature level: -100 (coldest) to +100 (hottest). Zero = neutral.

```bash
eightctl set-temp --side left --level 20    # Warm left side
eightctl set-temp --side right --level -30  # Cool right side
eightctl set-temp --side both --level 0     # Neutral both sides
eightctl off --side both                    # Turn off heating/cooling
```

### Alarms
```bash
eightctl alarms                             # List all alarms
eightctl set-alarm --side left --time 07:00 # Set alarm (24h format)
eightctl delete-alarm --id [alarm_id]
```

### Schedules
```bash
eightctl schedules              # List active schedules
eightctl schedule-status        # Show tonight's scheduled settings
```

## Usage Examples

**"Check bed status"**
```bash
eightctl status
```

**"Set my side (left) to level 30 for warmth"**
```bash
eightctl set-temp --side left --level 30
```

**"Cool down the right side to -20"**
```bash
eightctl set-temp --side right --level -20
```

**"Turn off the bed"**
```bash
eightctl off --side both
```

**"Set my alarm to 7am"**
```bash
eightctl set-alarm --side left --time 07:00
```

**"How did I sleep last night?"**
```bash
eightctl sleep-data
```

## Temperature Level Guide
| Level | Feel |
|-------|------|
| -100 to -50 | Very cold |
| -50 to -20 | Cool |
| -20 to 0 | Slightly cool / neutral |
| 0 to 20 | Slightly warm |
| 20 to 50 | Warm |
| 50 to 100 | Hot |

## Rules
- Check if CLI is installed first: `which eightctl || python3 -c "import pyeight" 2>/dev/null`
- If not installed, show pip install command and stop
- If credentials not set, instruct user to set EIGHT_USER and EIGHT_PASS environment variables
- Temperature level is -100 to +100, NOT degrees Celsius/Fahrenheit — clarify if user asks "set to 25 degrees"
- Side values: `left`, `right`, or `both`
- If device is not online, suggest checking WiFi connection of the Pod
- Keep responses concise: report what was set and current status
