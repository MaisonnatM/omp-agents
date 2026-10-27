---
status: accepted
date: 2026-10-22
decision-makers: Maxence Maisonnat
---

# Pull request Summary uses T3's sections without changing transcript Markdown

Summary folds conversation cards into its Comments section and moves stack and linked-session navigation into the header.
The stack menu also holds the session's other pull requests, the closest T3 navigation slot, and retains the existing queue-backed merge flow.
PR Markdown opts into alerts, repository autolinks, code chips, attachments, and authenticated media; session transcripts retain the shared renderer's defaults.
The media proxy fails closed on every redirect outside the four named GitHub hosts, except GitHub's own signed upload bucket after a `github.com` hop, which is where GitHub sends a token's request for an upload; T3 follows any HTTPS redirect there, and this keeps the one bucket.
See [Pull request details](../usage/pull-request-details.md) and [HTTP API: pull requests](../architecture/http-api-pull-requests.md).
