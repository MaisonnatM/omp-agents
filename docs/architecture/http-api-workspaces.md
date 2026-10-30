# HTTP API: source control, sync, worktrees, and workspaces

`GET /api/source-control` answers a `SourceControlAnswer` from `SourceControl` in `src/source-control.ts`: whether `gh` and `gt` are installed and signed in, the automatic pull setting, whether the cleanup after a merge is on (`cleanUp`), and each repository the visible workspaces are in, keyed by its main checkout with `pathDisplay` naming it with `~`, with its own choice and its last pull since the server started.
A repository whose main checkout is in a temp directory, as `inTempDir` in `src/shared/workspaces.ts` reads it, is left out of the answer and of the pulls.
`gh` is signed in when `gh api user` answers a login, and `gt` when Graphite's `user_config` holds an `authToken`.
`PUT /api/source-control/graphite-sign-in` takes `{ token }`, checked by `parseGraphiteToken`, runs `gt auth --no-interactive --token` with it as an argument, never through a shell, and answers the same as the `GET`; an error it answers has the token replaced, and activity records the path alone.
`PUT /api/source-control` takes a `SourceControlChange`, `{ op: "default", on }`, `{ op: "repo", repo, on }` with `on: null` dropping a repository's own choice, or `{ op: "clean-up", on }`, checked by `parseSourceControlChange` in `src/server/wire.ts`, and answers the same as the `GET`.
A change that changes the settings saves `source-control.json` beside the access token and, for a change of the pulls on the server that holds the owner lock, pulls at once; a file from before `cleanUp` reads with it on.
A pull, from that change or from the pull loop every five minutes, waits for the one under way, then runs `pullDefaultBranch` on each repository whose pulls are on.
It reads the default branch from `origin/HEAD`, fetches it, and moves the local branch only when it is behind `origin`'s with no commits of its own: through `merge --ff-only` in the worktree that has it checked out, skipped when that worktree has changes to tracked files, else through `update-ref`.

`GET /api/sync` answers a `SyncAnswer` from `src/shared/settings-sync.ts`: the `SyncSettings`, `{ remote, branch, excluded }`, and the last `SyncOutcome` or `null`.
`PUT /api/sync` takes `SyncSettings`, checked by `parseSyncSettings`, which refuses an address that starts with `-`, holds whitespace, or carries a password, a branch name Git would refuse, and an unknown item, and answers the same as the `GET`.
`PUT /api/sync/run` takes `{ choices }`, each conflicting path mapped to `local` or `remote`, checked by `parseSyncRun` in `src/server/wire.ts`, runs one sync, and answers the same as the `GET`, with a conflict or a failure as the last outcome rather than an error status.
A failure keeps Git's `Repository not found` or `does not appear to be a git repository` line over the advice after it, so the Sync tab can offer to create a missing GitHub repository.
`PUT /api/sync/create-repo` takes `{ name }`, a GitHub repository name or `owner/name`, checked by `parseSyncRepoName`.
It refuses when `gh` is missing or signed out, takes the repository when it exists, belongs to the signed-in account, and is private, refuses one that is public or another account's, and otherwise runs `gh repo create --private`.
It saves the repository's clone URL as the remote, SSH when `gh config get git_protocol` says `ssh` and HTTPS otherwise, drops the last outcome, and answers the same as the `GET`.

`GET /api/worktrees` lists the worktrees of every repository a session ran in, or of `?cwd=` when that directory is in a repository.
Each row names the registered path, branch, lock, whether the directory is missing, the newest session file there, why removal is refused, and `merged`: `{ by: "pull-request", number }`, `{ by: "default-branch", branch }`, or `null`.
A linked checkout is merged when `origin`'s default branch contains its commit, or when its branch's newest pull request merged no earlier than the branch's last commit; the pull requests come from one `gh api graphql` call per repository, and a failed call becomes an entry in `errors`.
`GET /api/worktrees/metrics?repository=&path=` reads approximate allocated disk use, the last commit time, and the modified and untracked counts for one registered checkout.
`PUT /api/worktrees/removal` previews a removal or performs one whose confirmation still matches that preview, up to `MAX_WORKTREE_BATCH` (100) worktrees per request.
A preview with `merged: true`, which **Remove merged** sends, adds the `unmerged` blocker to every target the same check cannot show merged, so the page removes only the merged ones nothing else blocks.
Removal uses `git worktree remove` without `--force`, so Git keeps the branch and still refuses a dirty or locked checkout.
The preview reads the status with executable-mode detection forced on, and refuses a checkout whose index hides changes with assume-unchanged or skip-worktree flags.
A missing directory is removed the same way, which drops only that registration.
`Worktrees.remove` logs each checkout it removes as `omp-agents: removed the worktree <path> for <who asked>`: `Settings › Worktrees`, `ended session <id>`, or `releasing branch <branch>`.
A start that creates a branch's worktree and registers its session excludes a removal, and so does a removal that has begun: a removal waits for the starts under way, reads the live and saved sessions once, then checks and removes each confirmed checkout in turn.
Starts that create no worktree, such as a resume or a Bot's session, stay parallel and wait only while a removal runs.

`WorktreeOccupants` supplies named, located directories and unresolved repository scopes to `Worktrees`.
It protects each live session's default directory and reported worktree, plus each resident subagent's native default directory.
It also protects every path the tool calls of a live session or a resident subagent name in its transcript: a Bash `cwd`, a `path` argument, and the files an `edit` patch heads.
For a shell command it takes the worktree guard's walk, `located` in `templates/omp/agent/extensions/shell/commands.ts`: each directory a command runs in, such as the target of a `cd`, and each word rooted at `/` or the home directory.
So a session that works in another repository's checkout keeps that checkout while it runs, though its own directory is elsewhere.
Terminal idle and parked subagents remain resident. Dashboard subagents remain resident while running, including descendants whose parent already completed.
A subagent's missing or unreadable transcript, incomplete write, or malformed working-directory record adds an unresolved scope without dropping earlier known directories.
A live session's own transcript only adds paths: its default directory already protects it, so a missing or partial transcript widens nothing.
Changed transcripts are fingerprinted to distinguish appends from rewritten prefixes. A rewrite rereads the native header and working-directory records while retaining earlier protected paths.
A disconnected roster or surviving child's parent session switch retains earlier child evidence until a live roster confirms departure or the parent process leaves.
Known paths protect only their containing canonical checkout, including another repository. Unresolved scopes protect their repository, or every checkout when that repository cannot be identified.
A path under a folder the server cannot read, such as one macOS guards, counts where it is written, with its readable folders resolved.
The `occupied` blocker names the session and the shallowest path it uses in the checkout, and counts the others.

`PUT /api/worktree/release` takes `{ cwd, branch }`, an absolute directory in a repository and a branch name, checked by `parseBranchRelease` in `src/server/wire.ts`, and answers 404 when `cwd` is not a directory.
`Worktrees.releaseBranch` lists the repository's worktrees, picks the linked one that has `branch` checked out, never the main, a bare, or a prunable registration, and removes it through `removeCheckout` without waiting for a session to leave.
It answers a `BranchRelease` from `src/shared/git.ts`: `{ kind: "none" }` when no linked worktree has the branch, `{ kind: "removed", path }`, or `{ kind: "kept", path, why }` with the blockers' messages or Git's error.
The page sends it when you copy a session header's branch or a pull request details' branch.

`PUT /api/workspaces` takes a `WorkspaceChange`, `{ op, cwd }` with `op` one of `add`, `hide`, and `show`, checked by `parseWorkspaceChange` in `src/server/wire.ts`.
`add` resolves `cwd` through `directoryOf` in `src/paths.ts`, which expands `~`, and answers 400 when it is not a directory; `hide` and `show` take an absolute path.
`applyWorkspace` in `src/shared/workspaces.ts` applies one change: adding also shows a hidden directory, and a directory in both lists is hidden, so **Show** offers an added one again.
A change that changes the list saves `workspaces.json` and sends every socket a `workspaces` message, its `list` of added and hidden directories, each with its `cwdDisplay`, also sent when a socket opens.
A request's `?cwd=` may name an added directory, as the settings under **This workspace** and a workspace's pull request list do; the every-workspace pull request list and the worktrees inventory read only the directories sessions ran in.
The page lists added directories after those sessions ran in, and drops a hidden directory, not the directories inside it, from its pickers, session lists, counts, and search, as it does `/tmp`.
