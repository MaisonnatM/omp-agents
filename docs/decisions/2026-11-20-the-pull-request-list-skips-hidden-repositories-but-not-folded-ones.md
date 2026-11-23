---
status: accepted
date: 2026-11-20
decision-makers: user, agent
---

# The pull request list skips hidden repositories but not folded ones

In the context of the pull request list, facing slow GitHub reads, we chose to never read repositories hidden under Display › Repositories (the `skip=` parameter), over also skipping folded ones, to cut reads the user never sees, accepting that folded repositories still cost a read so they open instantly.

## Consequences

Hiding a repository stops its pull requests from loading; folding only collapses its group.

## Revisit when

Folded repositories make the list noticeably slow.
