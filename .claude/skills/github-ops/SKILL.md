---
name: github-ops
description: >
  Manage GitHub via the gh CLI — issues, pull requests, CI/CD runs, code review,
  releases, and raw API queries. Use when user asks about GitHub issues, PRs,
  CI status, merge requests, or GitHub Actions workflows.
allowed-tools:
  - Bash
  - Read
  - Write
model: sonnet
user-invocable: true
when_to_use: >
  When user wants to interact with GitHub repositories, issues, pull requests,
  CI runs, or perform code review actions.
  Triggers: "create issue", "open PR", "check CI", "review PR", "merge PR",
  "list issues", "GitHub Actions status", "close issue", "assign issue".
argument-hint: "<action: issue|pr|run|release|api> <details>"
---

# GitHub Ops

Manage GitHub repositories using the `gh` CLI. Handles issues, PRs, CI runs, releases, and API queries.

## Prerequisites

```bash
brew install gh
gh auth login
```

Choose GitHub.com, HTTPS, and authenticate via browser. Confirm with:
```bash
gh auth status
```

## Commands

### Issues
| Command | Description |
|---------|-------------|
| `gh issue list` | List open issues in current repo |
| `gh issue list --repo <owner/repo>` | List issues in a specific repo |
| `gh issue view <number>` | View issue details |
| `gh issue create --title "..." --body "..."` | Create an issue |
| `gh issue close <number>` | Close an issue |
| `gh issue comment <number> --body "..."` | Comment on an issue |
| `gh issue edit <number> --assignee "@me"` | Assign to yourself |

### Pull Requests
| Command | Description |
|---------|-------------|
| `gh pr list` | List open PRs |
| `gh pr view <number>` | View PR details and diff |
| `gh pr create --title "..." --body "..."` | Create a PR |
| `gh pr merge <number> --squash` | Merge a PR (squash) |
| `gh pr review <number> --approve` | Approve a PR |
| `gh pr review <number> --request-changes --body "..."` | Request changes |
| `gh pr comment <number> --body "..."` | Comment on a PR |
| `gh pr checks <number>` | Show CI check status for a PR |

### CI / Actions
| Command | Description |
|---------|-------------|
| `gh run list` | List recent workflow runs |
| `gh run view <run-id>` | View run details and logs |
| `gh run rerun <run-id>` | Re-trigger a failed run |
| `gh workflow run <workflow.yml>` | Manually trigger a workflow |

### Releases
| Command | Description |
|---------|-------------|
| `gh release list` | List releases |
| `gh release create v1.0.0 --notes "..."` | Create a release |
| `gh release view v1.0.0` | View release details |

### Raw API
```bash
gh api repos/<owner>/<repo>/issues      # List issues via API
gh api graphql -f query='...'           # GraphQL queries
```

## Usage Examples

**Create a bug report issue:**
```bash
gh issue create \
  --title "Fix: null pointer in auth flow" \
  --body "Steps to reproduce: ..." \
  --label "bug" \
  --assignee "@me"
```

**Check CI status for latest PR:**
```bash
gh pr list --limit 1
gh pr checks <number>
```

**Review a PR and request changes:**
```bash
gh pr view 42
gh pr review 42 --request-changes --body "Please add tests for the edge case on line 87."
```

**Trigger a manual workflow dispatch:**
```bash
gh workflow run deploy.yml --field environment=staging
```

## Rules

- Always check if CLI is installed and authenticated: `gh auth status`
- If not installed, show `brew install gh && gh auth login` and stop
- If not authenticated, show `gh auth login` and stop
- Default to the current repo (detected from git remote) unless user specifies `<owner/repo>`
- When listing issues/PRs, show number, title, author, and date — limit to 10 by default
- When viewing PR diffs, truncate at 100 lines and save full diff to `workspace/pr-<number>.diff`
- NEVER approve or merge a PR without the user explicitly confirming
- For code review, summarize the diff first, then provide specific line-level feedback
- Keep responses concise: action confirmation in 1-2 lines, details in collapsible sections when possible
