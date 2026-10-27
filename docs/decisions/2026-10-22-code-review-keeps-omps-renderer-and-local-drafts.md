---
status: accepted
date: 2026-10-22
decision-makers: Maxence Maisonnat
---

# Code review keeps omp's renderer and local drafts

The pull request Code tab uses T3's toolbar and reading order around omp's lazy diff renderer, rather than adding a second diff library.
Viewed checkboxes belong to GitHub and follow the viewer across clients.
Line comments instead append pending findings to the dashboard's Review draft, preserving its accept, edit, preview, and explicit-post workflow.
Commit-scoped diffs disable new comments because a review is pinned to the whole pull request's head.
See [Pull request details](../usage/pull-request-details.md) and [Review drafts](../architecture/review-drafts.md).
