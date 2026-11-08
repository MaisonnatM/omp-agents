---
status: accepted
date: 2026-11-08
decision-makers: agent
---

# Keep the five-minute conversation cache

In the context of `cache-tail.ts`, which marks the conversation for Anthropic's five-minute cache while tools and the system head keep the one-hour cache, facing $48 per 14 days of rewrites after a pause between 5 minutes and an hour, we chose to keep the five-minute tail over a one-hour tail for main sessions or for all sessions.
A one-hour tail bills every tail write at twice the input price instead of 1.25 times, about $200 more per 14 days on $342 of tail writes, and about $40 more against $30 saved for main sessions alone, accepting the pause rewrites.

## Confirmation

`bun scripts/token-audit/report.ts --days 14` prints the "Cache writes by cause" rows these figures come from; rerun it before revisiting the choice.
