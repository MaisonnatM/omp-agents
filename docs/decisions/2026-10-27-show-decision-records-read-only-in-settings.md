---
status: accepted
date: 2026-10-27
decision-makers: Maxence Maisonnat
---

# Show decision records read-only in Settings › Decisions

In the context of every project keeping its decision records in its repository, facing records that the dashboard could not show, we chose a read-only **Decisions** section among the workspace sections of Settings over a top-level Decisions page and over a group in Settings › Files, to show one workspace's records, with their status and date, through the workspace picker those sections already have, accepting that the records sit one click deeper than a page of their own and that a record cannot be changed from the app.
A record changes in the same commit as the code it covers, so an edit from the dashboard would leave it in the working tree with no change beside it.
The section shows the records as one timeline of their first paragraphs, each opening in place, over a list beside a reading pane and over a table beside a properties panel, after a live preview of all three: it reads like a changelog, and it hides the records no longer in force by default.
