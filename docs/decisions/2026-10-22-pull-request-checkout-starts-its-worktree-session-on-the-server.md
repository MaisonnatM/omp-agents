---
status: accepted
date: 2026-10-22
decision-makers: Maxence Maisonnat
---

# Pull request checkout starts its worktree session on the server

**Check out** › **In a separate worktree** starts its session inside `PUT /api/pull-request/checkout`, through the same start a socket `start` runs, so one answer carries the checkout, the session to open, or why either failed, and the new-session draft stays as it was.
omp writes a session file only after its first reply, so the session starts with a prompt that asks for a summary of the pull request, where T3 opens an empty thread.
The fetched head can only fast-forward the local branch, so a branch with commits of its own is refused rather than overwritten, and a linked worktree that already has the branch is reused without moving it; the toast says when that leaves it off the pull request's head.
**In this repository** runs `gh pr checkout`, as T3 does, so gh owns fork remotes and upstreams there.
See [Pull request details](../usage/pull-request-details.md) and [HTTP API: pull requests](../architecture/http-api-pull-requests.md).
