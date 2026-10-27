---
status: accepted
date: 2026-10-27
decision-makers: Maxence Maisonnat
---

# The dashboard's own GitHub reads yield the quota to agents

The dashboard reads GitHub on the user's own `gh` token, whose 5000 GraphQL points an hour every agent's `gh` and `gt` also spend, and an agent that runs out cannot submit, edit, or read a pull request until the hour resets.
So the reads the dashboard makes on its own, the polled pull request list, the stack, and the merge cleanup's look, stop while fewer than 1000 points are left, until the quota resets, on top of `GitHubAccess`, which pauses every call only once the budget is spent.
A fifth of the hour carries a busy hour of agents' commands, which cost a point or a few each, while the list, polled every minute for each repository, is what spends the budget unattended.
What the user clicks, opening a pull request, a change, or a merge, still runs, since its one call is the work the user asked for, and a stale list says why it stopped rather than refreshing silently less often.
The gate reads `gh api rate_limit`, which costs no points, rather than a `rateLimit` field in each query, so it can decide before spending any.
See [HTTP API: pull requests](../architecture/http-api-pull-requests.md).
