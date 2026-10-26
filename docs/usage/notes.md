# Notes

The **Notes** tab, G then N, or `#notes` opens your Markdown notes across workspaces.
The sidebar lists **All** and **From agents**, each with its note count.
Under **Projects**, it lists each unarchived [project](projects.md) with the count of notes that belong to it.
`#notes/agents` lists notes added by agent sessions, and `#notes/project/<id>` lists one project's notes under the project's name.
Notes appear most recently updated first.
Each row shows the title, the first line of content, and the update day, with marks for a linked todo, a project outside that project's list, and an agent's note.

**New note**, or C outside a text field, creates an empty note, opens it, and focuses its title.
In a project's list, the new note belongs to that project; in the list of a deleted project, it belongs to none and opens under **All**.
A note without a title reads **Untitled**.
Edit its title in place, then press Enter or click away to save.
Esc discards a title edit.
The content uses the same formatted Markdown editor as [a todo's notes](todo-list.md).
Content saves after a short pause, when you click away, on Esc, and on Cmd+S.

The search matches every word against the title and content, regardless of case or order.
`/` focuses the search and Esc clears it.
Outside text fields, ↑ and ↓ focus rows or open the neighboring note while a note is open.
Enter opens a focused row, and Esc or **Close the note** closes the detail.
`#notes?open=<id>` addresses one note, and `#notes/project/<id>?open=<note id>` addresses it in its project's list.
The divider resizes the list, and the browser remembers its width.
On narrow pages, the open note replaces the list.

The **Todo** picker links a note to one top-level todo, including an archived todo, or clears the link with **No todo**.
**Open todo** follows that link.
A top-level todo's **Notes** section lists its linked notes and offers **+** to create another.
A deleted todo does not delete its notes.

The **Project** picker beside it puts a note in one unarchived project, or takes it out with **No project**.
A note whose project is archived keeps it as a choice, and one whose project is gone reads **Deleted project**.
**Open project** opens the project's page, whose **Notes** section lists the project's Notes page notes.
Moving the open note out of the project whose list shows it follows the note to its new list.

**Delete note** offers **Undo** for eight seconds.
The footer shows when the note was created and the session whose agent added it, when present.
The command menu searches titles and content and offers **Create note**, including a note titled with the search text.
While the dashboard is disconnected, you can read notes but cannot change them.

## Notes from agents

The starter kit's `~/.omp/agent/extensions/notes.ts` registers `user_note`.
`bun run omp-template` installs it with the other extensions.
The tool's `action` is `list`, `read`, `add`, or `append`.
`read` and `append` require `id`.
`add` accepts `title`, `body`, an optional `todo_id` naming an existing top-level todo, and an optional `project_id` naming a project.
Without `project_id`, a note added by a project's coordinator or worker, or by a `task` subagent under one, belongs to that project.
`list` accepts an optional `query` and an optional `project_id` that keeps only that project's notes, and names each note's project.
`append` adds `text` as a new paragraph without replacing the body.
An agent cannot rename, replace, relink, move, or delete an existing note.
An add with the same title from the same session returns the existing note.

Notes live in `notes.json` beside the dashboard's access token.
Agent writes wait in `note-inbox/` until the owning dashboard server applies them, including while the dashboard is stopped.
The tool lists and reads pending adds and appends too.
This Notes page is separate from a todo's own notes field and the project and user Markdown directories shown on the Projects page, even for a note that belongs to a project.
