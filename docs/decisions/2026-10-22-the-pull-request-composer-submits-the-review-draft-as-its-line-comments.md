---
status: accepted
date: 2026-10-22
decision-makers: Maxence Maisonnat
---

# The pull request composer submits the Review draft as its line comments

T3's composer submits a review with its pending line comments; here those are the Review draft's pending findings, so the badge and **Review (N)** count them.
Submitting sends the verdict and summary with the post, and the server accepts the pending findings and posts in one step, so no socket edit can race the post.
Without an open draft the composer posts a plain review through a `review` change.
**Request changes** keeps the Review draft's rule that it needs a summary, and an approval needs nothing, as GitHub allows.
The forms' text lives in the composer rather than in a force-mounted popover, so closing it keeps a draft without patching the shared popover.
See [Pull request details](../usage/pull-request-details.md) and [HTTP API: pull requests](../architecture/http-api-pull-requests.md).
