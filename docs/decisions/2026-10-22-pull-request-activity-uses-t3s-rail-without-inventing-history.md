---
status: accepted
date: 2026-10-22
decision-makers: Maxence Maisonnat
---

# Pull request activity uses T3's rail without inventing history

The Timeline interleaves commits, comments, reviews, threads, and known lifecycle times before grouping, so a conversation cannot swallow a commit or cross the unread boundary.
Resolved and dismissed threads collapse initially but remain on the rail, and replies reveal locally rather than requiring a write to GitHub.
Reactions are read-only, and replies beyond the detail query's first 20 comments open on GitHub instead of adding pagination requests.
Commit rows open the commit on GitHub.
The detail query reads merge and close times alongside existing data in one GraphQL request; absent historical events stay absent rather than being inferred from current branch or draft state.
