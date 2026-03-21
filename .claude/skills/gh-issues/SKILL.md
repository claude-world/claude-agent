---
name: gh-issues
description: >
  Auto-fix GitHub issues by fetching open issues, spawning agents to implement
  fixes, and opening PRs. Monitors PR review comments. Use when user says
  "fix github issues", "auto-fix bugs", "work through issues on repo X".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
model: sonnet
user-invocable: true
when_to_use: >
  When user wants to automatically fix GitHub issues, create PRs from issues,
  or monitor and address PR review comments on a repository.
argument-hint: "<owner/repo> [--label bug] [--limit 5] [--dry-run]"
---

# GitHub Issues Auto-Fixer

Fetch GitHub issues, implement fixes, and open PRs — all automated.

## Prerequisites

- `gh` CLI installed and authenticated: `brew install gh && gh auth login`
- Or: `GH_TOKEN` environment variable set

## Process

### 1. Fetch Issues
```bash
# List open issues (default: bug label, limit 5)
gh issue list --repo <owner/repo> --label bug --limit 5 --json number,title,body,labels
```

### 2. For Each Issue
1. Read the issue body and comments for reproduction steps
2. Clone/navigate to the repo
3. Create a feature branch: `git checkout -b fix/issue-<number>`
4. Implement the fix (read code, understand context, make changes)
5. Run tests if available
6. Commit with message: `fix: <description> (closes #<number>)`
7. Push and create PR:
```bash
gh pr create --repo <owner/repo> \
  --title "fix: <title>" \
  --body "Closes #<number>\n\n## Changes\n- <description>"
```

### 3. Monitor PRs (optional --watch flag)
```bash
# Check for review comments
gh pr view <number> --repo <owner/repo> --json reviewDecision,reviews,comments
```
Address review feedback and push updates.

## Commands Reference

| Command | Purpose |
|---------|---------|
| `gh issue list --repo R --json number,title,body` | List open issues |
| `gh issue view N --repo R --json body,comments` | Read issue details |
| `gh pr create --repo R --title T --body B` | Create PR |
| `gh pr view N --repo R --json reviews,comments` | Check PR reviews |
| `gh pr merge N --repo R --squash` | Merge PR (with user approval) |

## Usage Examples

- `/gh-issues octocat/hello-world --label bug --limit 3`
- `/gh-issues my-org/api --label "good first issue" --dry-run`
- `/gh-issues owner/repo --watch` (monitor and address PR reviews)

## Rules
- Always check if `gh` is installed first
- Never merge PRs without explicit user approval
- Create one PR per issue (not batch)
- Run existing tests before creating PR
- If fix is unclear, comment on the issue asking for clarification instead of guessing
- Dry-run mode: show what would be done without making changes
