# Settings sync

`SettingsSync` in `src/settings-sync.ts` keeps the portable settings the same on several machines through one branch of a Git remote.
What is portable is data, `SYNC_ITEMS` in `src/shared/settings-sync.ts`: omp's `config.yml`, `AGENTS.md`, and `APPEND_SYSTEM.md`, the `skills`, `rules`, `agents`, and `commands` trees of omp's agent directory, and the dashboard's stores, each under its path in the repository (`omp/…` and `dashboard/…`).
The stores are the source control settings, the notes, the todos with their categories and archive, the preferences, the workspace list, and the hidden calendars, each a `SyncStore` that `syncStores` builds over the server's own file.
The preferences store holds two parts: `page`, the page's portable `localStorage` values that `preferences.json` keeps, and `processes`, the idle stop of `processes.json`.
`NEVER_SYNCED` lists, as patterns on those paths, what never syncs even inside a synced tree: databases such as `agent.db`, `mcp.json`, `secrets.yml`, key and credential files, session files, lock files, the dashboard's token, `interrupted.json`, and `merges.json`, and `.git` and `node_modules` directories.
`readLocal` also leaves a link inside a tree, a file over 1 MB, a file that is not UTF-8 text, and a file or store whose text matches a credential's shape (`CREDENTIAL_SHAPES`: private keys and GitHub, GitLab, Anthropic, OpenAI, Slack, AWS, Google, Linear, and npm tokens) on the machine, and reports each as skipped.
Routines, scheduled sends, pins, notices, Google sign-ins, and the calendar events kept on this computer stay out of the registry: a routine synced to two machines would run on both, and the rest name this machine's sessions, runs, or accounts.
A todo's session links travel with it, but the session they open exists only on the machine that ran it.

The machine keeps a bare repository, `settings-sync.git` in the data directory, and runs every git command with `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, and, unless you set your own, `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`, so git uses the machine's keys and credential helper and fails rather than prompt.
`SyncRepo` in `src/sync-repo.ts` wraps those commands: it points `origin` at the remote, fetches the branch with `fetch.fsckObjects` on, so git refuses a tree that names `..` or `.git`, reads a commit's text files, builds a commit from a parent and a set of changes with `git fast-import`, and pushes without force.
`plainPath` leaves out any path that fast-import would need quoted, or that has an empty, `.`, or `..` segment, so the plan never names a file outside its item's directory.
`applyLocal` checks again where each file of a tree lands, and fails the sync on a path that resolves outside the tree, since a remote is someone else's to write.
A ref under `refs/omp-agents/base/`, keyed by a hash of the remote and the branch, holds the commit this machine last applied, so changing either starts again from no base.

A sync runs one at a time, in these steps.
1. Fetch the branch; a branch the remote does not have yet, or no longer has, counts as an empty remote with no base.
2. Read the base commit's files, the remote's, and this machine's, the stores through their `SyncStore` objects and the files from disk.
3. `planSync` merges each path of a synced item three ways with `mergeFile`: one side's change wins, an equal change stays, and two different changes, or two different files with no base, conflict unless the request chose a side.
   A JSON store merges key by key, recursively, and conflicts only on a key both sides changed differently.
   A list both sides changed merges entry by entry when each entry has its own identity, a string itself and an object its `id`, with none repeated; any other list is one value.
   An entry both sides hold merges the same way, an entry one side added stays, and an entry one side deleted goes, unless the other side changed it, which conflicts.
   The order follows the side that reordered the entries all three versions hold, with each entry the other side added placed after the entry before it there; two different reorders conflict.
   A chosen side settles every conflict inside the file in its favor.
4. Any conflict ends the sync with a `conflict` outcome, before anything is written on either side.
5. Each store's planned value goes through its store's `parse`, which fails the sync on one it does not take, again before anything is written, and otherwise gives the form the store keeps, such as todos to do before done; that form goes to whichever side lacks it, so one sync leaves both sides equal.
6. When this machine has changes, commit them on top of the remote's head and push as a fast-forward; a push that loses a race fails the sync, and the next one merges again.
7. Write the remote's changes here: files through `atomicWriteText`, executable or not as the remote has them, with deleted files' emptied directories removed up to the tree, and stores through their `write`, which tells the pages that show a list it changed.
   A store edited here after step 2 merges with the incoming value against what step 2 read, keeping this machine's side of any conflict, so the edit survives the sync and goes out with the next one.
8. Move the base ref to the commit now on both sides.

Pushing before writing here means a sync that stops after the push leaves this machine's files as the next sync's merge expects, so it converges.
A path the plan did not consider, one of an item that is off, a skipped file, or a path a newer version syncs, keeps its remote version, since the commit changes only the paths the plan names.
A sync with nothing changed on either side writes nothing and makes no commit.

Paths under the home directory travel as `~`: `portableText` rewrites the home directory in text files on their way to the remote, and the source control and workspace stores map each directory with `portablePath` and `localPath`.
Notes travel as an object keyed by id rather than the list the file keeps, since each edit moves its note first, and two machines editing two notes would otherwise disagree on the order.
A text file arrives with its `~` form as written, so the comparison on the next sync, which normalizes this machine's text again, sees no change.

`settings-sync.json`, beside the access token with mode `0600`, holds the remote, the branch, the items turned off, and the last `SyncOutcome`: `synced` with the paths received, sent, and skipped, `conflict` with each conflict's path, item, and the first 20,000 characters of both versions, or `failed` with git's message.
Changing the remote or the branch forgets the last outcome.
