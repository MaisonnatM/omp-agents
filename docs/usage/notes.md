# Notes

The **Notes** tab, G then N, or `#notes` opens your Markdown notes across workspaces.
The sidebar lists **All** and **From agents**, each with its note count.
Notes appear most recently updated first.
Each row shows the title, the first line of content, and the update day, with marks for a linked todo and an agent's note.

**New note**, or C outside a text field, creates an empty note, opens it, and focuses its title.
A note without a title reads **Untitled**.
Edit its title in place, then press Enter or click away to save.
Esc discards a title edit.
The content uses the same formatted Markdown editor as [a todo's notes](todo-list.md).
Content saves after a short pause, when you click away, on Esc, and on Cmd+S.

The search matches every word against the title and content, regardless of case or order.
`/` focuses the search and Esc clears it.
Outside text fields, ↑ and ↓ focus rows or open the neighboring note while a note is open.
Enter opens a focused row, and Esc or **Close the note** closes the detail.
`#notes?open=<id>` addresses one note, and `#notes/agents?open=<id>` addresses it in the list of notes from agents.
The divider resizes the list, and the browser remembers its width.
On narrow pages, the open note replaces the list.

The **Todo** picker links a note to one top-level todo, including an archived todo, or clears the link with **No todo**.
**Open todo** follows that link.
A top-level todo's **Notes** section lists its linked notes and offers **+** to create another.
A deleted todo does not delete its notes.

**Delete note** offers **Undo** for eight seconds.
The footer shows when the note was created and the session whose agent added it, when present.
The command menu searches titles and content and offers **Create note**, including a note titled with the search text.
While the dashboard is disconnected, you can read notes but cannot change them.

## Notes from agents

The starter kit's `~/.omp/agent/extensions/notes.ts` registers `user_note`.
`bun run omp-template` installs it with the other extensions.
The tool's `action` is `list`, `read`, `add`, or `append`.
`read` and `append` require `id`.
`add` accepts `title`, `body`, and an optional `todo_id` naming an existing top-level todo.
`list` accepts an optional `query`.
`append` adds `text` as a new paragraph without replacing the body.
An agent cannot rename, replace, relink, move, or delete an existing note.
An add with the same title from the same session returns the existing note.

Notes live in `notes.json` beside the dashboard's access token.
Agent writes wait in `note-inbox/` until the owning dashboard server applies them, including while the dashboard is stopped.
The tool lists and reads pending adds and appends too.
This Notes page is separate from a todo's own notes field.
