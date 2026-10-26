# User notes

`UserNoteList` holds notes with a title, Markdown body, optional top-level todo id, optional source session id, and creation and update timestamps.
`applyUserNote` is the pure reducer shared by the browser's optimistic state and the server's file.
Title and body edits move a note first and update its timestamp.
Linking a todo with `set-todo` does not change content order or timestamps.
Removal and indexed restore support the page's Undo toast.

`UserNotesFile` uses `ReducerFile` to keep `notes.json` beside the access token.
`parseUserNoteList` tolerates missing optional fields and drops fields it does not know, so a note an older version saved with a `projectId` loads without it, and orders loaded notes by update time.
`parseNoteChange` validates changes at the socket and inbox boundaries.
An unreadable file moves aside rather than being overwritten.
The `ListRegistry` connects `user-note` client changes to `user-notes` snapshots on the roster topic.
Every browser receives the same persisted list.

The `user_note` extension reads the file but never writes it.
It atomically renames each add or append request into `note-inbox/`.
`NoteInbox` uses `JsonInboxDir` to apply those requests in filename order.
Only the server holding `OwnerLock` drains the inbox, and it reloads the notes file before taking ownership.
Invalid requests move aside with the inbox's logged reason.
The extension also reads pending adds and appends, so agents see their own changes while the dashboard is stopped.

The Notes page reuses `PageFrame`, `ListSplit`, `DetailBar`, `FieldPicker`, and `NotesEditor`.
The editor keeps its document under the note id and receives external body updates through the existing Markdown synchronization.
The optional todo link resolves against both live and archived top-level todos.
A missing todo leaves the note intact.
