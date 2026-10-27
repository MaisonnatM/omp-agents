---
status: accepted
date: 2026-10-23
decision-makers: Maxence Maisonnat
---

# Keep Notes page entries in one server-owned JSON file

Notes live in `notes.json`, not individual Markdown files.
The server remains the only writer, while agents submit adds and appends through `note-inbox/`.
This follows the todo list's reducer, optimistic socket updates, and owner-lock model.
The tradeoff is that each note is not a greppable Markdown file.
