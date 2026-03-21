---
name: places
description: >
  Search nearby places, get details, and read reviews via the goplaces CLI and
  Google Places API. Use when user asks "find a restaurant near me", "what coffee
  shops are nearby", "get details for a place", or "show reviews".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to find nearby locations, get place details, or read reviews.
  Triggers: "find restaurants near", "coffee shops nearby", "what's open near me",
  "place details for", "reviews for", "search places".
argument-hint: "<action: search|details|reviews> <query> [location]"
---

# Places

Search places and get details using `goplaces` CLI backed by the Google Places API.
Requires a `GOOGLE_PLACES_API_KEY` environment variable.

## Prerequisites

```bash
brew install steipete/tap/goplaces
```

**Set up your API key:**
```bash
export GOOGLE_PLACES_API_KEY="AIza..."
# Or add to ~/.zshrc / ~/.bashrc for persistence
```

Get a key: https://console.cloud.google.com → APIs & Services → Enable "Places API" →
Create Credentials → API Key.

## Commands

| Command | Description |
|---------|-------------|
| `goplaces search "<query>" --near "<location>"` | Search places by type/name near a location |
| `goplaces search "<query>" --lat 25.0478 --lng 121.5319` | Search by coordinates |
| `goplaces details "<place_id>"` | Get full details for a place (hours, phone, address) |
| `goplaces reviews "<place_id>"` | List top reviews for a place |
| `goplaces search "<query>" --open-now` | Filter to currently open places |
| `goplaces search "<query>" --radius 500` | Limit search radius in meters |

## Usage Examples

**Find coffee shops nearby:**
```bash
goplaces search "coffee shop" --near "Taipei 101" --open-now
```

**Get full details for a place:**
```bash
goplaces details "ChIJN1t_tDeuEmsRUsoyG83frY4"
```

**Read reviews:**
```bash
goplaces reviews "ChIJN1t_tDeuEmsRUsoyG83frY4"
```

**Search with coordinates:**
```bash
goplaces search "ramen" --lat 25.0478 --lng 121.5319 --radius 1000
```

## Rules

- Always check if CLI is installed first: `which goplaces`
- If not installed, show the install command and stop
- Always check that `GOOGLE_PLACES_API_KEY` is set: `[[ -z "$GOOGLE_PLACES_API_KEY" ]] && echo "API key not set"`
- Never print the API key value in output
- When listing results, show: name, rating, address, open status — limit to top 5 results by default
- For details, summarize: address, phone, hours, website, rating
- For reviews, show top 3 reviews (author, rating, snippet) — save full reviews to workspace/ if requested
- If location is ambiguous, ask the user to clarify before searching
