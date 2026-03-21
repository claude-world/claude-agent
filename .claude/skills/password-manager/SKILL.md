---
name: password-manager
description: >
  Access 1Password secrets and inject environment variables via the op CLI.
  Use when user needs to retrieve credentials, inject secrets into commands,
  or look up stored items. Never stores or logs secrets.
allowed-tools:
  - Bash
model: haiku
user-invocable: true
when_to_use: >
  When user needs to retrieve a secret, credential, or API key from 1Password,
  or inject env vars from 1Password into a command.
  Triggers: "get password for...", "fetch secret from 1password", "inject env vars",
  "what's the API key for...", "op read".
argument-hint: "<action: get|list|inject|whoami> <vault/item/field>"
---

# Password Manager (1Password)

Read secrets and inject environment variables from 1Password using the `op` CLI.

## Prerequisites

```bash
brew install 1password-cli
```

Sign in:
```bash
op signin
```

Or for biometric unlock (recommended):
1. Open 1Password app → Settings → Developer → enable "Integrate with 1Password CLI"
2. Then `op` commands will use Touch ID automatically

Verify:
```bash
op whoami
```

## Commands

| Command | Description |
|---------|-------------|
| `op whoami` | Show current signed-in account |
| `op vault list` | List all vaults |
| `op item list` | List all items |
| `op item list --vault "<Vault>"` | List items in a vault |
| `op item get "<Item Name>"` | Get full item details |
| `op item get "<Item Name>" --fields password` | Get just the password field |
| `op read "op://<vault>/<item>/<field>"` | Read a specific field by URI |
| `op run --env-file=.env.1p -- <command>` | Inject secrets as env vars and run command |
| `op inject -i .env.tpl -o .env` | Render a secrets template to a file |

## Usage Examples

**Get an API key:**
```bash
op read "op://Personal/OpenAI/api_key"
```

**Get a database password:**
```bash
op item get "Production DB" --fields password
```

**Inject secrets and run a script:**
```bash
# .env.1p file contains: API_KEY=op://Work/MyService/api_key
op run --env-file=.env.1p -- python3 script.py
```

**List all items in Work vault:**
```bash
op item list --vault "Work" --format json | jq '.[].title'
```

## Rules

- Always check if CLI is installed and signed in: `op whoami`
- If not installed, show `brew install 1password-cli` and stop
- If not signed in, show `op signin` and stop
- NEVER print secret values in assistant responses — only confirm "retrieved" or use them directly in commands
- NEVER write secrets to files that might be committed (e.g., `.env` in a git repo) without warning the user
- NEVER log, store, or repeat credential values in memory or workspace files
- Use `op read` URI format for precise field access; use `op item get` when unsure of field names
- For injecting into commands, prefer `op run` over reading the secret and passing it as an argument
- If the user asks "what's my password for X", retrieve it and only show the value in the terminal — do not include it in any saved file
