---
status: accepted
date: 2026-11-13
decision-makers: Maxence Maisonnat
supersedes: 2026-10-23-keep-notes-page-entries-in-one-server-owned-json-file
---

# Remove the Notes page and the user_note tool

In the context of the dashboard's Notes page and the starter kit's `user_note` tool, facing a feature the user asked to remove, we chose to delete both outright over hiding the tab or keeping the tool without its page, to drop a page, a socket message, a settings sync item, and a starter-kit tool from every session's prompt, accepting that notes already saved stay unread in `notes.json` and `note-inbox/` on disk.
A todo's own notes field stays; it is a separate feature.
