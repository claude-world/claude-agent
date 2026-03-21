---
name: trello
description: >
  Manage Trello boards, lists, and cards via the Trello REST API using curl.
  Use when user wants to view boards, create/move/archive cards, add checklists,
  or update task status in Trello.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to interact with Trello boards, lists, or cards.
  Triggers: "show my Trello boards", "add card to Trello", "move card to...",
  "create Trello list", "archive card", "add checklist", "assign card".
argument-hint: "<action: boards|lists|cards|create|move|archive|checklist> <details>"
---

# Trello

Manage Trello via the REST API using `curl`. No separate CLI install needed.

## Prerequisites

No install needed beyond `curl` (pre-installed on macOS/Linux).

Set up credentials as environment variables:
```bash
export TRELLO_API_KEY="your_api_key"
export TRELLO_TOKEN="your_token"
```

Get your credentials:
1. API Key: https://trello.com/app-key
2. Token: Click "Token" link on that page and authorize

Store them in your shell profile (`~/.zshrc` or `~/.bashrc`) or in 1Password and inject via `op run`.

## Commands

**Base URL:** `https://api.trello.com/1`
**Auth params:** `key=$TRELLO_API_KEY&token=$TRELLO_TOKEN`

### Boards
```bash
# List all boards
curl -s "https://api.trello.com/1/members/me/boards?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq '.[].name'

# Get board ID by name
curl -s "https://api.trello.com/1/members/me/boards?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq '.[] | select(.name=="My Board") | .id'
```

### Lists
```bash
# Get lists on a board
curl -s "https://api.trello.com/1/boards/<BOARD_ID>/lists?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq '.[] | {id, name}'

# Create a list
curl -s -X POST "https://api.trello.com/1/lists?name=<NAME>&idBoard=<BOARD_ID>&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"
```

### Cards
```bash
# Get cards on a list
curl -s "https://api.trello.com/1/lists/<LIST_ID>/cards?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq '.[] | {id, name, due}'

# Create a card
curl -s -X POST "https://api.trello.com/1/cards?idList=<LIST_ID>&name=<NAME>&desc=<DESC>&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"

# Move card to another list
curl -s -X PUT "https://api.trello.com/1/cards/<CARD_ID>?idList=<NEW_LIST_ID>&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"

# Archive a card
curl -s -X PUT "https://api.trello.com/1/cards/<CARD_ID>?closed=true&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"

# Add due date
curl -s -X PUT "https://api.trello.com/1/cards/<CARD_ID>?due=2026-03-25T10:00:00.000Z&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"
```

### Checklists
```bash
# Add checklist to card
curl -s -X POST "https://api.trello.com/1/checklists?idCard=<CARD_ID>&name=<NAME>&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"

# Add checklist item
curl -s -X POST "https://api.trello.com/1/checklists/<CHECKLIST_ID>/checkItems?name=<ITEM>&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"
```

## Usage Examples

**List all board names:**
```bash
curl -s "https://api.trello.com/1/members/me/boards?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq -r '.[].name'
```

**Create a card in "To Do" list:**
1. Get list ID: find the list named "To Do" on your board
2. Create card:
```bash
curl -s -X POST "https://api.trello.com/1/cards?idList=<LIST_ID>&name=Write+blog+post&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"
```

**Move a card from "In Progress" to "Done":**
```bash
curl -s -X PUT "https://api.trello.com/1/cards/<CARD_ID>?idList=<DONE_LIST_ID>&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"
```

## Rules

- Always check that `TRELLO_API_KEY` and `TRELLO_TOKEN` are set: `[ -z "$TRELLO_API_KEY" ] && echo "Not set"`
- If not set, guide the user to https://trello.com/app-key and stop
- NEVER log or store API keys/tokens in memory or workspace files
- Always pipe curl output through `jq` for readable formatting; install with `brew install jq` if needed
- When looking up board/list/card IDs, do a lookup first and cache the IDs for subsequent calls in the same session
- URL-encode special characters in names and descriptions (spaces → `+`, etc.)
- Keep responses concise: confirm action and show the created/updated item name
