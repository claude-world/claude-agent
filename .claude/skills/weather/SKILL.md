---
name: weather
description: >
  Get current weather and forecasts using wttr.in (no install) and Open-Meteo API.
  No API key required. Use when user asks "what's the weather", "will it rain",
  "forecast for...", or "weather in <city>".
allowed-tools:
  - Bash
model: haiku
user-invocable: true
when_to_use: >
  When user asks about current weather conditions or forecasts.
  Triggers: "what's the weather", "weather in <city>", "will it rain today",
  "forecast for this week", "temperature in...", "should I bring an umbrella".
argument-hint: "<city or location> [today|tomorrow|3-day|week]"
---

# Weather

Get weather data using `curl wttr.in` (no install needed) and the Open-Meteo API (free, no key).

## Prerequisites

No installation required. `curl` is available by default on macOS and Linux.

Optionally install `jq` for cleaner JSON parsing:
```bash
brew install jq
```

## Commands

**Quick current weather (compact):**
```bash
curl -s "wttr.in/<city>?format=3"
```

**Full weather report (ASCII art):**
```bash
curl -s "wttr.in/<city>"
```

**3-day forecast (JSON, for structured output):**
```bash
curl -s "wttr.in/<city>?format=j1" | jq '.weather[0:3]'
```

**Current conditions only:**
```bash
curl -s "wttr.in/<city>?format=%C+%t+feels+like+%f+humidity+%h"
```

**Open-Meteo for precise hourly forecast (by coordinates):**
```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=<LAT>&longitude=<LON>&current_weather=true&hourly=temperature_2m,precipitation_probability&forecast_days=3"
```

## Usage Examples

**Quick weather check:**
```bash
curl -s "wttr.in/Tokyo?format=3"
# → Tokyo: ⛅️  +18°C
```

**3-day forecast for Taipei:**
```bash
curl -s "wttr.in/Taipei?format=j1" | jq '.weather[] | {date: .date, max: .maxtempC, min: .mintempC, description: .hourly[4].weatherDesc[0].value}'
```

**Rain probability today (Open-Meteo):**
```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=25.04&longitude=121.53&hourly=precipitation_probability&forecast_days=1" | jq '.hourly.precipitation_probability'
```

**Current conditions formatted:**
```bash
curl -s "wttr.in/London?format=%l:+%C,+%t+(feels+%f),+humidity+%h,+wind+%w"
```

## Rules

- Always check if `curl` is available: `which curl` (it almost always is)
- No API keys, no accounts — these are free public APIs
- URL-encode city names with spaces: replace spaces with `+` (e.g., `New+York`)
- Default to wttr.in for simplicity; use Open-Meteo when user needs hourly breakdown or precise rain probability
- If the user gives a city name, use it directly with wttr.in; if they give a landmark or neighborhood, geocode first via wttr.in (it handles most names)
- Format output in plain text — no raw JSON dumps to the user
- Keep responses concise: current temp, conditions, and forecast summary in 3-5 lines
- Include "feels like" temperature and precipitation chance when relevant
