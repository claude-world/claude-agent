---
name: rss-monitor
description: >
  Monitor RSS and Atom feeds for new articles and updates. Fetch feeds, list new items,
  filter by keyword, and save feed lists. Use when user says "check RSS feeds",
  "any new posts from", "monitor this blog", "add feed", "latest from feed",
  or any RSS/Atom feed monitoring request.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to check RSS/Atom feeds for updates, add new feeds to monitor,
  list recent articles, or filter feed content by keyword. Triggers on: RSS, feed,
  check updates from, latest articles, blog updates, new posts, subscribe to feed,
  monitor website updates.
argument-hint: "<check|add|list|search> [feed-url|keyword] [--since 24h|7d]"
---

# RSS Monitor

Monitor RSS and Atom feeds for new content. Uses curl + XML parsing (no extra install).

## Prerequisites

No extra install required — uses built-in tools:
```bash
# Required (macOS built-in):
curl --version    # HTTP fetching
python3 --version # XML parsing

# Optional for better output:
brew install jq   # JSON formatting
```

Feed list is stored at: `~/.config/rss-monitor/feeds.txt` (one URL per line).

## Commands

### Fetch and Parse a Feed
```bash
# Fetch RSS/Atom feed and list titles + links
curl -s "https://example.com/feed.xml" | python3 -c "
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.stdin)
root = tree.getroot()
ns = {'atom': 'http://www.w3.org/2005/Atom'}
# Try RSS first, then Atom
items = root.findall('.//item') or root.findall('.//atom:entry', ns)
for item in items[:10]:
    title = item.findtext('title') or item.findtext('atom:title', namespaces=ns) or 'No title'
    link = item.findtext('link') or item.findtext('atom:link', namespaces=ns) or ''
    pubdate = item.findtext('pubDate') or item.findtext('atom:updated', namespaces=ns) or ''
    print(f'- {title.strip()}\n  {pubdate.strip()}\n  {link.strip()}')
"
```

### Add a Feed to Monitor
```bash
# Create config dir if needed
mkdir -p ~/.config/rss-monitor

# Add feed URL
echo "https://example.com/feed.xml" >> ~/.config/rss-monitor/feeds.txt
echo "Feed added."

# List saved feeds
cat ~/.config/rss-monitor/feeds.txt
```

### Check All Saved Feeds
```bash
# Check all feeds in list
while IFS= read -r url; do
  echo "\n=== $url ==="
  curl -s "$url" | python3 -c "
import sys, xml.etree.ElementTree as ET
try:
    tree = ET.parse(sys.stdin)
    root = tree.getroot()
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    items = root.findall('.//item') or root.findall('.//atom:entry', ns)
    for item in items[:5]:
        title = item.findtext('title') or item.findtext('atom:title', namespaces=ns) or 'No title'
        print(f'  - {title.strip()}')
except: print('  [Parse error]')
"
done < ~/.config/rss-monitor/feeds.txt
```

### Search Feed by Keyword
```bash
curl -s "https://example.com/feed.xml" | python3 -c "
import sys, xml.etree.ElementTree as ET
keyword = 'KEYWORD'.lower()
tree = ET.parse(sys.stdin)
root = tree.getroot()
ns = {'atom': 'http://www.w3.org/2005/Atom'}
items = root.findall('.//item') or root.findall('.//atom:entry', ns)
for item in items:
    title = item.findtext('title') or item.findtext('atom:title', namespaces=ns) or ''
    if keyword in title.lower():
        link = item.findtext('link') or ''
        print(f'- {title.strip()}\n  {link.strip()}')
"
```

### Remove a Feed
```bash
# Remove a URL from the feed list
grep -v "url_to_remove" ~/.config/rss-monitor/feeds.txt > /tmp/feeds_tmp.txt
mv /tmp/feeds_tmp.txt ~/.config/rss-monitor/feeds.txt
echo "Feed removed."
```

## Usage Examples

**"Check for new posts from Hacker News"**
```bash
curl -s "https://news.ycombinator.com/rss" | python3 -c "
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.stdin)
for item in tree.findall('.//item')[:10]:
    title = item.findtext('title') or ''
    link = item.findtext('link') or ''
    print(f'- {title.strip()}\n  {link.strip()}')
"
```

**"Add this feed: https://blog.example.com/rss"**
```bash
mkdir -p ~/.config/rss-monitor
echo "https://blog.example.com/rss" >> ~/.config/rss-monitor/feeds.txt
echo "Added. Currently monitoring $(wc -l < ~/.config/rss-monitor/feeds.txt) feeds."
```

**"Check all my feeds"**
```bash
# Run the check-all-saved-feeds command above
```

**"Search for 'AI' in this feed"**
```bash
# Replace KEYWORD with 'AI' in the search command above
```

## Common Feed URLs
| Source | RSS URL |
|--------|---------|
| Hacker News | `https://news.ycombinator.com/rss` |
| GitHub releases (repo) | `https://github.com/USER/REPO/releases.atom` |
| Reddit subreddit | `https://www.reddit.com/r/SUBREDDIT/.rss` |
| YouTube channel | `https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID` |

## Rules
- curl and python3 are always available on macOS — no install check needed
- Feed list location: `~/.config/rss-monitor/feeds.txt`
- Always create config directory before writing: `mkdir -p ~/.config/rss-monitor`
- Default to showing last 10 items per feed; 5 items when checking all feeds
- If XML parsing fails, report the URL and error, continue with other feeds
- Filter out duplicate entries if the same URL appears multiple times in feeds.txt
- For date filtering (since 24h/7d), parse pubDate fields and compare to current time
- Keep output concise: title + link only by default, add dates only if requested
