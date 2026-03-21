---
name: obsidian
description: >
  Create, search, read, and link notes in an Obsidian vault using direct markdown
  file access and the obsidian-cli. Use when user says "add to Obsidian",
  "find note in vault", "create Obsidian note", or "link notes".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to interact with an Obsidian vault — creating notes, searching,
  reading, adding tags, linking notes, or managing daily notes.
  Triggers: "add to Obsidian", "create note in vault", "find note about...",
  "search Obsidian", "link this to...", "open daily note", "add tag".
argument-hint: "<action: create|read|search|link|daily|list|append> <vault> <details>"
---

# Obsidian

Manage Obsidian vaults via direct markdown file access and the `obsidian-cli` tool.
Obsidian vaults are plain markdown files — most operations work without any special CLI.

## Prerequisites

**Option 1: Direct file access (no install needed)**
Obsidian vaults are directories of `.md` files. Read/write them directly with Bash.

**Option 2: obsidian-cli for richer operations:**
```bash
npm install -g obsidian-cli
```

Or using the community `obsidian-export` tool:
```bash
cargo install obsidian-export
```

**Configure vault path:**
```bash
export OBSIDIAN_VAULT="$HOME/Documents/ObsidianVault"
```

Add to `~/.zshrc` or `~/.bashrc` for persistence.

## Commands

### Direct File Operations (no CLI needed)

| Operation | Command |
|-----------|---------|
| List all notes | `find "$OBSIDIAN_VAULT" -name "*.md" -type f` |
| Search note content | `grep -r "<query>" "$OBSIDIAN_VAULT" --include="*.md" -l` |
| Read a note | `cat "$OBSIDIAN_VAULT/<Note Name>.md"` |
| Create a note | Write to `"$OBSIDIAN_VAULT/<Note Name>.md"` |
| Append to note | `echo "\n<content>" >> "$OBSIDIAN_VAULT/<Note Name>.md"` |
| List by folder | `ls "$OBSIDIAN_VAULT/<Folder>/"` |

### Wikilinks (Obsidian's link format)
```
[[Note Name]]                  ← Link to another note
[[Note Name|Display Text]]     ← Link with custom text
[[Note Name#Heading]]          ← Link to a heading
```

### Frontmatter (YAML metadata)
```yaml
---
tags: [project, meeting]
date: 2026-03-21
aliases: [alternative name]
---
```

### Daily Notes
```bash
# Create or open today's daily note
TODAY=$(date +%Y-%m-%d)
NOTE_PATH="$OBSIDIAN_VAULT/Daily Notes/$TODAY.md"
```

## Usage Examples

**Create a new note with frontmatter:**
```bash
cat > "$OBSIDIAN_VAULT/Projects/New Idea.md" << 'EOF'
---
tags: [idea, project]
date: 2026-03-21
---

# New Idea

## Summary
Brief description here.

## Links
- [[Related Note]]
EOF
```

**Search vault for a topic:**
```bash
grep -r "machine learning" "$OBSIDIAN_VAULT" --include="*.md" -l
```

**Append to an existing note:**
```bash
echo "\n\n## Update 2026-03-21\nNew information here." >> "$OBSIDIAN_VAULT/Projects/New Idea.md"
```

**Find all notes tagged with "meeting":**
```bash
grep -r "tags:.*meeting" "$OBSIDIAN_VAULT" --include="*.md" -l
```

**List all notes in a folder:**
```bash
ls "$OBSIDIAN_VAULT/Projects/"
```

## Rules

- Always check that `OBSIDIAN_VAULT` is set: `[ -z "$OBSIDIAN_VAULT" ] && echo "Not configured"`
- If not set, ask the user for their vault path and suggest adding it to `~/.zshrc`
- Prefer direct file access over CLI tools for simple read/write operations
- When creating notes, always use proper Markdown formatting with YAML frontmatter for tags/metadata
- When reading long notes (> 100 lines), display only the first 50 lines and save full content to `workspace/`
- Use Obsidian wikilink syntax `[[Note Name]]` for internal links, not regular markdown links
- Preserve existing frontmatter when appending to notes — read the file first
- File names should match Obsidian conventions: avoid special characters except `-` and `_`
- Keep responses concise: confirm file path and action in 1-2 lines
