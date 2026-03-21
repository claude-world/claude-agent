---
name: x-twitter
description: >
  Post, reply, quote, search, and manage content on X (Twitter) using the xurl CLI
  for X API v2. Use when user wants to tweet, reply to a post, search X, check
  mentions, upload media, or send DMs.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user wants to interact with X (formerly Twitter) — posting tweets, replying,
  quoting, searching, checking mentions, uploading media, or sending DMs.
  Triggers: "tweet this", "post to X", "reply to tweet", "quote tweet",
  "search X for...", "check my mentions", "send DM on X", "post with image".
argument-hint: "<action: post|reply|quote|search|mentions|dm|media|like|retweet> <details>"
---

# X (Twitter)

Interact with X (Twitter) using `xurl`, a CLI for the X API v2.

## Prerequisites

```bash
# Install xurl
brew install xurl
# or
npm install -g xurl-cli
```

Configure credentials (X API v2 keys):
```bash
export X_API_KEY="your_api_key"
export X_API_SECRET="your_api_secret"
export X_ACCESS_TOKEN="your_access_token"
export X_ACCESS_SECRET="your_access_token_secret"
export X_BEARER_TOKEN="your_bearer_token"
```

Get credentials from https://developer.twitter.com/en/portal/dashboard
(requires a developer account and an app with OAuth 1.0a + Read/Write permissions)

Verify:
```bash
xurl users/me
```

## Commands

### Posting
```bash
# Post a tweet
xurl -X POST tweets -d '{"text": "Hello world!"}'

# Reply to a tweet
xurl -X POST tweets -d '{"text": "Great point!", "reply": {"in_reply_to_tweet_id": "<TWEET_ID>"}}'

# Quote tweet
xurl -X POST tweets -d '{"text": "Interesting take:", "quote_tweet_id": "<TWEET_ID>"}'

# Post with media (upload image first, then attach media_id)
xurl -X POST tweets -d '{"text": "Check this out!", "media": {"media_ids": ["<MEDIA_ID>"]}}'
```

### Search
```bash
# Search recent tweets (last 7 days, free tier)
xurl "tweets/search/recent?query=<query>&max_results=10"

# Search with expansions
xurl "tweets/search/recent?query=<query>&tweet.fields=created_at,author_id&max_results=20"
```

### Timelines & Mentions
```bash
# Get own user ID
xurl "users/me"

# Get mentions timeline
xurl "users/<USER_ID>/mentions?max_results=20"

# Get home timeline
xurl "users/<USER_ID>/timelines/reverse_chronological?max_results=20"
```

### Media Upload
```bash
# Upload media (uses v1.1 endpoint)
xurl -X POST "https://upload.twitter.com/1.1/media/upload.json" \
  --form media=@image.png \
  --form media_category=tweet_image
```

### DMs (Direct Messages)
```bash
# Send a DM
xurl -X POST dm_conversations/with/<USER_ID>/messages \
  -d '{"text": "Hey, wanted to reach out!"}'

# List DM conversations
xurl dm_conversations
```

### Engagement
```bash
# Like a tweet
xurl -X POST "users/<MY_USER_ID>/likes" -d '{"tweet_id": "<TWEET_ID>"}'

# Retweet
xurl -X POST "users/<MY_USER_ID>/retweets" -d '{"tweet_id": "<TWEET_ID>"}'

# Delete a tweet
xurl -X DELETE "tweets/<TWEET_ID>"
```

## Usage Examples

**Post a simple tweet:**
```bash
xurl -X POST tweets -d '{"text": "Just shipped a new feature! 🚀 Check it out at example.com"}'
```

**Search for mentions of a topic:**
```bash
xurl "tweets/search/recent?query=%23ClaudeCode&tweet.fields=created_at&max_results=10"
```

**Reply to a specific tweet:**
```bash
xurl -X POST tweets -d '{"text": "Thanks for sharing! Here is more context...", "reply": {"in_reply_to_tweet_id": "1234567890"}}'
```

**Check recent mentions:**
```bash
MY_ID=$(xurl "users/me" | jq -r '.data.id')
xurl "users/$MY_ID/mentions?max_results=10&tweet.fields=created_at"
```

## Rules

- Always check that `xurl` is installed and credentials are configured: `which xurl && xurl users/me`
- If not installed, show install instructions and stop
- If credentials are missing, guide user to https://developer.twitter.com and stop
- NEVER log or store API keys/tokens in memory or workspace files
- Tweet character limit is 280 characters — count and warn if the user's text exceeds it
- URL-encode query parameters for search; use `jq -r '@uri'` if needed
- When drafting tweets, show the text to the user and confirm before posting
- For media posts, upload the media first, extract the media_id, then attach to the tweet
- Keep responses concise: confirm post with "Posted: <first 50 chars of tweet>..." and the tweet URL
- Note: X API free tier limits search to last 7 days and 500k reads/month; warn if user is likely to hit limits
