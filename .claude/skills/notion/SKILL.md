---
name: notion
description: >
  Manage Notion pages, databases, and blocks via the Notion API using curl.
  Use when user wants to create/read/update Notion pages, query databases,
  add content blocks, or search the Notion workspace.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to interact with Notion workspace content.
  Triggers: "create Notion page", "add to Notion", "query Notion database",
  "search Notion", "update Notion page", "read Notion page", "list Notion pages".
argument-hint: "<action: search|create|read|update|query|append> <details>"
---

# Notion

Interact with Notion via the REST API using `curl`. No separate CLI install needed.

## Prerequisites

No install needed beyond `curl` (pre-installed on macOS/Linux).

Set up credentials:
```bash
export NOTION_API_KEY="secret_xxxxxxxxxxxx"
```

Get your key:
1. Go to https://www.notion.so/my-integrations
2. Create a new integration → copy the "Internal Integration Token"
3. Share target pages/databases with the integration (open in Notion → Share → invite integration)

Store in shell profile or in 1Password and inject via `op run`.

## Commands

**Base URL:** `https://api.notion.com/v1`
**Headers:**
```
Authorization: Bearer $NOTION_API_KEY
Notion-Version: 2022-06-28
Content-Type: application/json
```

### Search
```bash
curl -s -X POST "https://api.notion.com/v1/search" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"query": "<search term>"}' | jq '.results[] | {id: .id, title: .properties.title.title[0].plain_text}'
```

### Pages
```bash
# Read a page
curl -s "https://api.notion.com/v1/pages/<PAGE_ID>" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28"

# Create a page
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"page_id": "<PARENT_PAGE_ID>"},
    "properties": {
      "title": {"title": [{"text": {"content": "<Page Title>"}}]}
    }
  }'

# Update page title
curl -s -X PATCH "https://api.notion.com/v1/pages/<PAGE_ID>" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"properties": {"title": {"title": [{"text": {"content": "<New Title>"}}]}}}'
```

### Blocks (Page Content)
```bash
# Read page blocks
curl -s "https://api.notion.com/v1/blocks/<PAGE_ID>/children" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" | jq '.results[] | {type: .type, text: .paragraph.rich_text[0].plain_text}'

# Append a paragraph block
curl -s -X PATCH "https://api.notion.com/v1/blocks/<PAGE_ID>/children" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "children": [{
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": "<Your text here>"}}]
      }
    }]
  }'
```

### Databases
```bash
# Query a database
curl -s -X POST "https://api.notion.com/v1/databases/<DB_ID>/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.results[] | .properties'

# Query with filter
curl -s -X POST "https://api.notion.com/v1/databases/<DB_ID>/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"property": "Status", "select": {"equals": "In Progress"}}}'
```

## Usage Examples

**Search for a page:**
```bash
curl -s -X POST "https://api.notion.com/v1/search" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"query": "meeting notes march"}' | jq '.results[0] | {id, url}'
```

**Create a new note under a parent page:**
Set PARENT_ID to your workspace page ID, then:
```bash
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"parent": {"page_id": "'$PARENT_ID'"}, "properties": {"title": {"title": [{"text": {"content": "My New Note"}}]}}}'
```

## Rules

- Always check that `NOTION_API_KEY` is set: `[ -z "$NOTION_API_KEY" ] && echo "Not set"`
- If not set, guide the user to https://www.notion.so/my-integrations and stop
- NEVER log or store the API key in memory or workspace files
- Always pipe curl output through `jq`; install with `brew install jq` if needed
- Page IDs are 32-char hex strings (with or without dashes) — extract from Notion URLs
- Remind the user to share the page/database with the integration if getting 404 errors
- When reading page content, save long content to `workspace/notion-<page-id>.md` rather than displaying raw
- Keep responses concise: confirm action in 1-2 lines and show the page title/URL
