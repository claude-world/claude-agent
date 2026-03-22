---
description: Content quality gate and patent-based scoring rules for social media content creation
globs:
  - "workspace/content-*"
alwaysApply: false
---

# Content Quality Gate

These rules apply when creating social media content via `/content-creator` or the `content-publisher` agent.

Source: https://creators.instagram.com/threads + Meta patent analysis

## Patent-Based Scoring (5 Dimensions)

| Dimension | Weight | What It Measures |
|-----------|--------|------------------|
| Hook Power | 25% | First line: has number or contrast, 10-45 chars (EdgeRank + Andromeda) |
| Engagement Trigger | 25% | CTA anyone can answer, direct "you" address (Dear Algo) |
| Conversation Durability | 20% | Both sides presented, invites debate (72hr Threads window) |
| Velocity Potential | 15% | Timely, 50-300 chars, shareable (Andromeda Real-time) |
| Format Score | 15% | Mobile-scannable, line breaks, emoji sparingly (Multi-modal Indexing) |

## Quality Gate

- **Minimum score**: 70 out of 100
- **Conversation Durability**: must be >= 55 individually
- If draft scores below threshold, revise before presenting to user

## Algorithm Penalty Checks (Official Threads Guidelines)

Content that triggers reduced distribution — **must reject if any apply**:

| Penalty | What It Means | How to Detect |
|---------|---------------|---------------|
| **Clickbait** | Misleading hook that overpromises | Hook makes a claim the body doesn't deliver |
| **Engagement bait** | Explicitly asks for likes/reposts/follows | "Like if you agree", "Repost this", "Follow for more" |
| **Contest/Giveaway violation** | Runs contest outside recommendation guidelines | Giveaway contingent on engagement actions |
| **Unoriginal content** | Reposts or cross-posts without original value | Copy-pasted from other platforms, no original angle |

**Auto-reject rule**: If any penalty flag is triggered, rewrite before scoring. No exceptions.

## Content Rules

1. **Read original sources** — Never write from titles or metadata alone. Always read >= 1 primary source.
2. **Timeline verification** — Check dates. Discard content > 48 hours old for "breaking news" framing.
   - "today" = within last 6 hours
   - "recently" = 1-3 days
   - Older content → use evergreen framing, not news framing
3. **No AI filler** — Remove phrases like "in today's rapidly evolving landscape", "it's worth noting that", "dive deep into".
4. **Platform-aware** — Threads: 500 chars, text-first. Instagram: visual-first. Respect each platform's constraints.
5. **Link Comment (CRITICAL)** — Threads/IG reduce distribution for posts with URLs in the body. Always:
   - Remove URLs from the post body
   - Collect all source URLs into a separate "link comment"
   - Post the link comment as the first reply to the main post
   - Format: `Sources:\n- [Title] URL\n- [Title] URL`
5. **Original content only** — Create Threads-specific content. Never cross-post identical text from IG/FB. Reposts get reduced reach vs original creators.
6. **Text + visuals** — Posts combining text with images/video significantly outperform text-only. Always prefer visual-enriched posts.
7. **Humor & authenticity** — Humor performs exceptionally well on Threads. Write in authentic voice with personality. Relatable > polished.
8. **Niche consistency** — Stay within established niches (AI, dev tools, tech) to build authority. Random off-topic posts dilute algorithmic identity.

## Tone Guidelines (Official)

| Do | Don't |
|-----|-------|
| Share genuine opinions on topics you care about | Post generic takes with no personal angle |
| Connect posts to personal experience | Write detached, impersonal observations |
| Use humor and wit naturally | Force humor or use sarcasm that doesn't land |
| Let personality show through | Sound like a corporate account or a bot |

## Reply & Engagement Strategy (Official: replies = ~50% of Threads views)

Replies are not optional — they are a core distribution mechanism.

| Action | Why | Cadence |
|--------|-----|---------|
| Reply to other creators' posts | "Just as important as posting original content" | Daily, alongside posting |
| Ask follow-up questions in own posts | Provokes conversation → more recommendations | Every post should invite reply |
| Engage with trending topics | Jump on trends, reference pop culture/events | When relevant to niche |

## Posting Cadence (Official)

- **Minimum**: 2-5 posts per week
- **Insight**: "Higher post frequency is linked to higher views per post"
- **Tip**: Analyze post performance data to identify peak engagement days; weekends often perform better

## Topic Tags (Official)

- Use relevant topic tags on every post for discoverability
- Tags support multiple words and emojis (unlike traditional hashtags)
- Help users interested in specific subjects find your content

## Cross-Platform Distribution (Official)

- Share Threads content to IG Stories/Feed via airplane icon
- Audiences may receive IG notifications about Threads activity
- Use this for extra reach, but keep original content Threads-first
