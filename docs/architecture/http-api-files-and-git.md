# HTTP API: files, git, and conversations

`GET /api/git?cwd=<directory>` answers the git checkout that the directory is in, or `null` outside one: the checked-out branch, every local branch with the worktree that has it checked out, and the main worktree.

`GET /api/system` answers the status bar's machine load: `{ cpuPercent, memoryAvailable, memoryTotal, diskAvailable, diskTotal }`.
`cpuPercent` is the busy share of every core's time since the previous read, from `os.cpus()`, and `null` when no time passed; the first read measures from the server's start.
`memoryAvailable` is `kern.memorystatus_level`, the free percentage `memory_pressure` reports, of the physical memory on macOS, since `os.freemem()` counts only never-used pages there, and `os.freemem()` elsewhere.
`diskAvailable` and `diskTotal` come from `statfs` on the home directory: the blocks free to an unprivileged user and all the volume's blocks; on macOS the free figure leaves out purgeable space, which Finder counts.

`GET /api/file?path=<absolute path>` answers a text file for the page's file dialog: `{ path, text, size, truncated }`.
The path is absolute or starts with `~`, which `expandHome` in `src/paths.ts` reads as the home directory; the page resolves a relative one against the session's worktree or directory first.
The file's real path, after symlinks, must end in one of `TEXT_FILE_EXTENSIONS`, so a link named `notes.md` cannot reach a key file.
It must also lie outside the directories that hold sign-ins and config, `DENIED_DIRS` in `src/local-file.ts`, compared by their real paths, or the route answers 403: omp-agents' own directory, which holds the access token, omp's agent directory, but for its Markdown, such as `AGENTS.md` and skills, and its images and videos, and the sign-in directories of the CLIs agents run, `~/.config/gh`, `~/.config/gcloud`, `~/.aws`, `~/.docker`, `~/.kube`, `~/.ssh`, and `~/.gnupg`.
It reads the first `MAX_TEXT_FILE_BYTES` (1 MB) and answers 415 when those bytes are not UTF-8.
`GET /api/media?path=<absolute path>` serves an image or video that agent text names, as the type `MEDIA_FILE_TYPES` in `src/shared/transcript.ts` gives its extension, with the same path, real-path extension, and `DENIED_DIRS` checks as `GET /api/file`.
Bun answers a `Range` request with a 206 and that part, so a video seeks.
It sends `Cache-Control: private, no-cache`, since a file can change under the same path, and `Content-Security-Policy: sandbox; default-src 'none'`, so an SVG opened at that address runs no script on the page's origin.
It runs `git worktree list --porcelain -z`, `git for-each-ref`, and `git symbolic-ref` on each call, and reads `origin` through the pull request list's cached lookup.
Like a new session's `start`, `cwd` may name any directory.
The new-session draft reads it for its branch picker, and a live session's header reads it when it opens and when a turn starts or ends.
`GET /api/changes?session=<session id>` answers a session's [changes dialog](../usage/session-changes.md) list, `SessionChanges` in `src/shared/changes.ts`, or 404 for a session it does not know.
It reads the session's checkout from its worktree, else its directory: `git diff --name-status` and `--numstat` against the merge base of `HEAD` with `origin/HEAD`, else against `HEAD`, else against the empty tree before the first commit, and `git ls-files --others --exclude-standard` for untracked files.
It folds the session's transcript with `Work` for the files its own `edit` and `write` calls changed, keeping each transcript's fold and parsing only the lines it gained since the last list, or folding it again from its first line once it shrinks, and lists those git does not name after git's.
`GET /api/changes/file?session=<session id>&path=<path>` answers one file of that list in full, `ChangedFileText`, with every line of `git diff --histogram` as numbered rows, or a note for a binary file or one over `MAX_CHANGED_FILE_BYTES` (1 MB).
It computes the list again and answers 404 for a path the list does not hold, so it reads no file the session and its checkout did not change, and passes the path with `--literal-pathspecs`, so a name such as `app/[id]/page.tsx` is not a glob.
The dialog reads both routes again whenever the session's own changes grow and when a turn starts or ends.
`GET /api/project-notes?id=<project id>` answers a project's notes and the user's, `ProjectNotesAnswer` (`{ dir, notes, userDir, userNotes }`), each note a `ProjectNote` (`{ name, path, modifiedAt }`) for a Markdown file at any depth in its directory, named by its path from it with `/`, by name, or 404 for a project the server does not know.
The page lays each list out as a tree through `noteRows` in `web/notes-model.ts` and opens a note through `GET /api/file`, which opens both directories, since they lie outside `DENIED_DIRS`.
`GET /api/conversations?q=<words>` answers `ConversationSearchAnswer` from `src/shared/sessions.ts`: every saved conversation whose prompts or replies hold every word, the file changed last first, each by its latest such message, with that message's transcript item id, a snippet, and how many messages match; a blank `q` is a 400.
It waits for the transcript reads asked for so far, then reads nothing itself; the page leaves out the sessions the sidebar hides and lists the first 30.
