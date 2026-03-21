---
name: skill-creator
description: >
  Create new Claude Code SKILL.md files from user descriptions. Generates
  correct frontmatter, command documentation, usage examples, and rules.
  Validates format and writes to .claude/skills/. Use when user says "create
  a skill for", "add new skill", "make a skill that", or "scaffold a skill".
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
model: sonnet
user-invocable: true
when_to_use: >
  When user wants to create a new skill for Claude Code. Triggers: "create a
  skill", "add skill for", "make a skill that does", "scaffold skill", "new skill
  for", "write a SKILL.md". Use sonnet for this task — it requires structured
  generation and format validation.
argument-hint: "<skill-name> <description of what the skill should do>"
---

# Skill Creator

Generate well-structured `SKILL.md` files for Claude Code skills. Reads existing
skills as reference, generates correct format, validates, and writes to `.claude/skills/`.

## Prerequisites

No external CLI needed. Uses Read, Write, Edit, Grep, and Glob tools.

## SKILL.md Format Reference

Every SKILL.md must follow this structure:

```markdown
---
name: skill-name                    # kebab-case, matches directory name
description: >                      # Single paragraph, mentions trigger phrases
  What the skill does and when to use it.
allowed-tools:                      # Only tools actually needed
  - Bash
  - Read
  - Write
model: haiku|sonnet|opus            # haiku for simple, sonnet for complex
user-invocable: true                # Always true for user-facing skills
when_to_use: >                      # Explicit trigger phrases
  When to invoke. Triggers: "phrase 1", "phrase 2".
argument-hint: "<args>"             # CLI-style hint shown in autocomplete
---

# Title

Brief one-line description.

## Prerequisites

Install command or "No install needed."

## Commands

Key CLI commands in a table or code blocks.

## Usage Examples

Realistic examples with bash code blocks.

## Rules

- Bullet list of behavioral rules
- Check if CLI installed first
- Handle missing env vars gracefully
- Keep responses concise
```

## Workflow

### Step 1: Gather Requirements

From user input, extract:
- **Skill name**: kebab-case identifier (e.g., `my-skill`)
- **CLI tool(s)**: what commands power it
- **Purpose**: what task it accomplishes
- **Trigger phrases**: natural language patterns that should invoke it
- **Model**: haiku (simple/fast) or sonnet (complex/reasoning)

### Step 2: Read Reference Skills

```bash
# Read 2-3 similar existing skills for pattern reference
ls /path/to/.claude/skills/
```

Use Read tool on relevant examples (e.g., `apple-notes/SKILL.md`, `github-ops/SKILL.md`).

### Step 3: Check for Conflicts

```bash
# Check if skill already exists
ls .claude/skills/ | grep "<skill-name>"
```

### Step 4: Generate SKILL.md

Generate the full SKILL.md content following the format reference above. Key rules:
- `name` field must match the directory name exactly
- `description` must include trigger phrases ("Use when user says...")
- `when_to_use` must list explicit trigger phrases after "Triggers:"
- `allowed-tools` must only include tools the skill actually uses
- Prerequisites section must include exact install commands
- Rules section must include: check CLI installed, handle missing env vars, keep output concise

### Step 5: Create and Write

```bash
# Create the skill directory
mkdir -p .claude/skills/<skill-name>
```

Use Write tool to create `.claude/skills/<skill-name>/SKILL.md`.

### Step 6: Validate

After writing, re-read the file and verify:
- [ ] Frontmatter is valid YAML (no syntax errors)
- [ ] `name` matches directory name
- [ ] `description` is non-empty and mentions triggers
- [ ] `when_to_use` has explicit trigger phrases
- [ ] `allowed-tools` list is accurate
- [ ] `model` is one of: haiku, sonnet, opus
- [ ] `argument-hint` is present
- [ ] Has all required sections: Prerequisites, Commands, Usage Examples, Rules
- [ ] Rules include CLI-installed check and concise-output guidance

## Usage Examples

**Create a skill from description:**
```
User: "create a skill for managing Docker containers — list, start, stop, exec"
→ Reads docker-related reference skills
→ Generates skill-name: docker-control
→ Creates .claude/skills/docker-control/SKILL.md
→ Validates format
→ Reports: "Created .claude/skills/docker-control/SKILL.md"
```

**Create a skill with API key:**
```
User: "create a skill for sending SMS via Twilio"
→ skill-name: twilio-sms
→ Includes TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM env vars
→ Creates .claude/skills/twilio-sms/SKILL.md
```

## Rules

- Always read 2+ existing skills as format reference before generating
- Never create a skill that duplicates an existing one — check first with Glob
- Skill directory name must match the `name` frontmatter field exactly
- If user provides a vague description, ask 3 clarifying questions before generating:
  1. What CLI tool(s) power this skill?
  2. What are the 3 most common user requests?
  3. Should it be haiku (fast/simple) or sonnet (reasoning required)?
- After writing, always re-read the file to confirm it was written correctly
- Report the created file path in the final response
- If the skill requires env vars, always include a "Set up" section in Prerequisites
- Keep the Rules section actionable — each rule should be a single clear directive
