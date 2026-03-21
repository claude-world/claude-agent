---
name: google-workspace
description: >
  Interact with Google Workspace (Gmail, Calendar, Drive, Contacts, Sheets, Docs)
  via the gogcli CLI. Use when user needs to read/send Gmail, check calendar,
  manage Drive files, look up contacts, or work with Sheets/Docs.
allowed-tools:
  - Bash
  - Read
  - Write
model: sonnet
user-invocable: true
when_to_use: >
  When user needs to interact with any Google Workspace product.
  Triggers: "check Gmail", "send email via Google", "what's on my calendar",
  "find file in Drive", "create Google Doc", "update spreadsheet",
  "search contacts", "schedule meeting", "next calendar event".
argument-hint: "<product: gmail|calendar|drive|contacts|sheets|docs> <action> <details>"
---

# Google Workspace

Access Gmail, Calendar, Drive, Contacts, Sheets, and Docs via the `gogcli` CLI.

## Prerequisites

```bash
brew install steipete/tap/gogcli
```

Authenticate:
```bash
gogcli auth login
```

This opens a browser for Google OAuth. Grant the requested scopes.
Confirm with:
```bash
gogcli auth status
```

## Commands

### Gmail
| Command | Description |
|---------|-------------|
| `gogcli gmail list` | List inbox messages |
| `gogcli gmail read <id>` | Read a message |
| `gogcli gmail send --to "..." --subject "..." --body "..."` | Send an email |
| `gogcli gmail reply <id> --body "..."` | Reply to a message |
| `gogcli gmail search "<query>"` | Search emails (Gmail syntax) |
| `gogcli gmail archive <id>` | Archive a message |
| `gogcli gmail trash <id>` | Move to trash |

### Calendar
| Command | Description |
|---------|-------------|
| `gogcli calendar list` | List upcoming events |
| `gogcli calendar list --days 7` | Events in next 7 days |
| `gogcli calendar create --title "..." --start "..." --end "..."` | Create an event |
| `gogcli calendar delete <id>` | Delete an event |
| `gogcli calendar search "<query>"` | Search events |

### Drive
| Command | Description |
|---------|-------------|
| `gogcli drive list` | List files in Drive root |
| `gogcli drive search "<query>"` | Search files |
| `gogcli drive download <id>` | Download a file |
| `gogcli drive upload <path>` | Upload a file |
| `gogcli drive share <id> --email "..." --role reader` | Share a file |

### Contacts
| Command | Description |
|---------|-------------|
| `gogcli contacts list` | List contacts |
| `gogcli contacts search "<name or email>"` | Search contacts |
| `gogcli contacts get <id>` | Get contact details |

### Sheets
| Command | Description |
|---------|-------------|
| `gogcli sheets read <id>` | Read spreadsheet data |
| `gogcli sheets update <id> --range "A1" --value "..."` | Update a cell |
| `gogcli sheets append <id> --range "A1" --values "[...]"` | Append rows |

### Docs
| Command | Description |
|---------|-------------|
| `gogcli docs read <id>` | Read a document |
| `gogcli docs create --title "..."` | Create a new document |
| `gogcli docs append <id> --text "..."` | Append text to a document |

## Usage Examples

**Check today's calendar:**
```bash
gogcli calendar list --days 1
```

**Search Gmail for an invoice:**
```bash
gogcli gmail search "from:billing subject:invoice has:attachment"
```

**Find a file in Drive:**
```bash
gogcli drive search "Q1 report filetype:pdf"
```

**Create a calendar event:**
```bash
gogcli calendar create \
  --title "Team standup" \
  --start "2026-03-22T10:00:00" \
  --end "2026-03-22T10:30:00" \
  --attendees "alice@co.com,bob@co.com"
```

**Look up a contact's email:**
```bash
gogcli contacts search "Alice Chen"
```

## Rules

- Always check if CLI is installed and authenticated: `gogcli auth status`
- If not installed, show `brew install steipete/tap/gogcli` and stop
- If not authenticated, show `gogcli auth login` and stop
- NEVER expose OAuth tokens or credentials in responses
- When reading long emails or documents, truncate at 1000 chars and save full content to `workspace/gws-<type>-<id>.md`
- When listing calendar events, format as: date/time | title | location (if any)
- When sending emails, draft the content and confirm with the user before executing
- For Sheets operations, always confirm the spreadsheet ID and range before writing
- Keep responses concise: action confirmation in 1-2 lines
