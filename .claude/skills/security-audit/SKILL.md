---
name: security-audit
description: >
  Audit host security using built-in system tools (netstat, lsof, ss, ufw,
  systemctl, ps, who, last). Check open ports, running services, listening
  processes, firewall rules, and recent logins. No external CLI needed. Use
  when user says "security audit", "check open ports", "harden server", or
  "what's listening on my machine".
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to audit host security, check for open ports, review running
  services, inspect firewall rules, or assess overall system risk. Triggers:
  "security audit", "open ports", "what's listening", "check firewall", "harden
  my server", "who's logged in", "suspicious processes", "security check".
argument-hint: "<scope: full|ports|services|firewall|logins|processes>"
---

# Security Audit

Audit host security using built-in system tools. No external tools required —
uses `netstat`, `lsof`, `ss`, `ufw`/`iptables`, `systemctl`, `ps`, `who`, and `last`.

## Prerequisites

No install needed. All tools are standard on macOS and Linux.

For Linux firewall checks, `ufw` or `iptables` must be available. On macOS, `pf` is used.

## Commands

### Open Ports & Listening Processes

```bash
# All listening ports with process names (Linux)
ss -tlnp

# All listening ports (macOS / fallback)
netstat -an | grep LISTEN

# Identify which process owns each port
lsof -i -P -n | grep LISTEN
```

### Running Services (Linux)

```bash
# List all active systemd services
systemctl list-units --type=service --state=running

# Check a specific service status
systemctl status sshd
```

### Firewall Rules

```bash
# UFW status (Linux/Ubuntu)
sudo ufw status verbose

# iptables rules (Linux)
sudo iptables -L -n -v

# macOS pf status
sudo pfctl -s rules
```

### Active Logins & Recent Access

```bash
# Currently logged-in users
who

# Recent login history
last -20

# Failed login attempts (Linux)
sudo grep "Failed password" /var/log/auth.log | tail -20

# Failed login attempts (macOS)
log show --predicate 'eventMessage contains "Failed password"' --last 1h
```

### Running Processes

```bash
# All processes sorted by CPU
ps aux --sort=-%cpu | head -20

# Check for unusual processes (macOS)
ps aux | grep -v grep | awk '{print $1,$11}' | sort -u
```

### File Permissions & SUID Binaries (Linux)

```bash
# Find SUID binaries
find / -perm /4000 -type f 2>/dev/null

# World-writable directories
find /tmp /var /etc -perm -o+w -type d 2>/dev/null
```

## Usage Examples

**Full security snapshot:**
```bash
echo "=== LISTENING PORTS ===" && lsof -i -P -n | grep LISTEN
echo "=== ACTIVE LOGINS ===" && who
echo "=== RECENT LOGINS ===" && last -10
echo "=== RUNNING SERVICES ===" && (systemctl list-units --type=service --state=running 2>/dev/null || echo "systemctl not available")
```

**Quick port exposure check:**
```bash
lsof -i -P -n | grep LISTEN | awk '{print $1, $9}' | sort -u
```

## Rules

- Always run commands as current user; if `sudo` is needed, note it but don't auto-run
- Never modify firewall rules or kill processes without explicit user confirmation
- Summarize findings into risk levels: Critical / High / Medium / Low / Info
- Save full audit output to `workspace/security-audit-<date>.md`
- Flag any port listening on `0.0.0.0` or `::` (all interfaces) as higher risk than localhost-only
- Highlight: unexpected listening ports, unknown processes, recent failed logins, world-writable dirs
- macOS vs Linux: detect with `uname -s` and use appropriate commands
- Keep final report concise: executive summary + categorized findings + recommended actions
