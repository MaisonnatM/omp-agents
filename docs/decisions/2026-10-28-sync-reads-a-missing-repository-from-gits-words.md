---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# Sync reads a missing repository from Git's words

In the context of Settings › Sync offering to create a GitHub repository after a sync failed because the remote does not exist, facing a failed outcome that keeps only Git's error text, we chose to keep Git's `Repository not found` or `does not appear to be a git repository` line in that text and match it in `missingGithubRepo` over adding a `missing` flag to the stored `SyncOutcome`.
This adds no field to the saved sync state and needs no migration, accepting that a Git release that rewords those lines hides the offer until `MISSING_REPOSITORY` in `src/shared/settings-sync.ts` learns the new words.
