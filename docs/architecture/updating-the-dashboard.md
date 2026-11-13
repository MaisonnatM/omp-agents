# Updating the dashboard

`src/server/self-update.ts` is **Update dashboard**.
At startup `SelfUpdate.forServer` reads the checkout the server runs from: its top directory, the branch checked out, and that branch's commit, the running build.
A packaged app, a detached HEAD, a directory outside git, or a system without `process.execve` offers no update, and says why.

`SelfUpdate` runs its status reads, its checks, and its updates one at a time, so a check never fetches under a move.
Once an update starts the restart, a later check answers nothing without fetching, so no fetch outlives `execve` and holds `.git`'s lock when the new server checks.
An update never stashes or merges; it resets only back to the commit it ran, only while HEAD is still the commit it moved to, and `--keep` refuses rather than touch a changed file:

- It refuses when the checkout moved to another branch since the server started, has changes to tracked files (untracked files do not count), or `origin/<branch>` was never fetched, as for a branch never pushed.
- It fetches `origin/<branch>` and refuses when the branch has commits origin lacks.
- It answers `current` when `origin/<branch>` is the running commit.
- It refuses `origin/<branch>`'s commit while the update record says the desktop shell rolled it back, naming the commit, how it ended, the last error line it printed, and the commit omp-agents went back to; once origin has a newer commit, an update goes ahead.
- It reads each git exit code exactly: `diff --quiet` and `merge-base --is-ancestor` answer 0 or 1, and any other code, a timeout's included, refuses with git's `fatal:` or `error:` line rather than reading as an answer.
- Otherwise it writes the update record as `moving`, fast-forwards with `git merge --ff-only`, and runs `bun install --frozen-lockfile` when `bun.lock` differs between the running commit and the new one.
  A merge or install that fails takes the checkout back to the running commit as a rollback does, drops the record, and refuses with the cause, so the server runs on; when even that fails, the refusal says so too.
- Then it writes the record as `starting`, the point after which the new build's first start decides, and answers `restarting`.
- 300 ms after answering, so the answer reaches the page or agent that asked, the server restarts: `restart` in `src/server.ts` stops as a shutdown does, letting go of the sessions it started, which run on in their keepers, and writing its stores, prints `omp-agents restarting on <origin>`, and calls `process.execve` with its own command and environment.
  The new server attaches to those sessions again as any start does.
  It keeps the owner lock, which names its pid and port, so no other server takes over the routines while it starts again; a signal or the desktop shell's pipe ending during a restart makes it exit instead.
  The new server keeps the pid, the port, and the standard streams, so a terminal keeps its job and the desktop shell its child, and it builds the page of the checkout as it now is.
- Every later update until then answers the same `restarting`.
- Once the new build listens, `SelfUpdate.started` drops the record and, at an update's first start, runs the checkout's `templates/omp/install.ts --files` on the server's omp agent directory in the background, which replaces each starter kit file you never edited since the recorded install with the kit's version; it logs what it did, and a failure is logged without stopping the server.
  A build that never listens never updates the kit, so a rollback leaves the kit's files as the build that runs left them.

## The update record

`src/server/update-journal.ts` keeps one JSON file per server in the checkout's git directory, `omp-agents/update-<port>.json` under `git rev-parse --git-path`, which git never tracks or cleans and each worktree keeps apart.
It names the branch, the commit that ran, the commit the update moved to, and whether `bun.lock` changed between them, in one of four states:

- `moving`: the update is moving the checkout.
  A stop that finds it was cut short mid-move, and goes back.
- `starting`: the checkout holds the new commit, and the server restarts into it.
  The new build drops the record once it listens.
- `reverting`: the new build stopped before it listened, and the checkout goes back; it keeps `failure`, how the build ended in plain words such as `exited with code 1` or `did not answer within 60 s`, as the error page words it, and `error`, the last error line it printed or `null`, so a rollback cut short resumes from the checkout as it is.
- `rolled-back`: the checkout is back on the commit that ran, with the same `failure` and `error`.
  The bell's omp-agents notice, **omp-agents update undone**, and the command menu say so with `failure` alone, **Update dashboard** refuses that commit until origin moves past it, and the source-control auto-pull skips the checkout while origin points at it.
  The first start on any other commit drops it.

Going back takes `git reset --keep` to the commit that ran, only while HEAD is still the new commit on the branch, then `bun install --frozen-lockfile` when `bun.lock` changed.
`--keep` refuses rather than overwrite a file changed since the update, and the window then says so instead of starting a server; a checkout moved by hand meanwhile drops the record and runs as it is.
Only the desktop shell rolls back, since it alone sees the new build stop; a server from `bun start` that does not start leaves the record `starting`, and its next start, or a desktop shell's, goes on from there.
A rollback restores the code and its packages, not the files the server keeps under `~/.config/omp-agents` and `~/.local/share/omp-agents`, and a build that does not listen may have written them already.
So a change to a store's format either stays readable by the build before it, or writes the new format only after the commit point, once the new build listens.

Known gaps:

- A server that listens and then hangs is neither restarted nor rolled back.
- A checkout that moved without **Update dashboard**, such as by the source-control auto-pull or by hand, has no record, so a build of it that keeps stopping goes through the restarts and gives up instead of going back.
- A server from `bun start` in a terminal gets neither the rollback nor the restarts.
- The desktop shell's code is the one it launched with, so both take effect after the app is opened again once.

The desktop shell's own code in `desktop/` loads only when the app starts again.
Every socket's first message is `{ t: "build", id }`, a hash of the served `index.html`, which names each chunk by its content's hash; the page keeps the first id it heard and reloads when a later socket brings another, so the desktop window follows a restart to the new page.

`GET /api/dashboard/update` answers `DashboardUpdateStatus` from `src/shared/dashboard-update.ts` without asking origin: `unavailable` with its reason, or the branch, the running commit, `behind`, the commits `origin/<branch>` held past it at the last fetch, and `failed`, the rolled-back commit origin still points at and how its build ended, or `null`.
`PUT /api/dashboard/update` with any JSON body runs `SelfUpdate.update` and answers `{ kind: "current" }` or `{ kind: "restarting", from, to, installed }`, or 409 with the refusal.
`GET /api/dashboard/changelog` runs `SelfUpdate.changelog` for the header's **What's new**, which answers `DashboardChangelog` without asking origin: the `- ` lines under each `## YYYY-MM-DD` heading of `CHANGELOG.md`, read with `git show` at the running commit and at `origin/<branch>` as last fetched, a commit without the file counting as empty.
Each line on origin is marked `installed: false` unless the running build's file holds the same line under the same day, and lines only the running build's file holds follow as installed; a day whose heading appears twice, as the union merge `.gitattributes` sets can leave, reads as one, and the newest day comes first.
An agent reaches these routes with `curl`, with the token as `Authorization: Bearer` and, for the `PUT`, an `Origin` that matches the host; the starter kit's `AGENTS.md` tells agents to load new commits this way, never by killing its processes.
`GET /api/dashboard/build` answers what the server serves, `ServedBuild` from `src/served-build.ts`: its checkout, branch, commit, and working tree as the server read them before it built the page, the page's build, its pid, and when it started, or no checkout for a prebuilt page.
It changes nothing, and the server prints the same at startup as `Serving ...`; `scripts/smoke-proof.ts` and `scripts/pr-parity.ts` compare it with the checkout they run from, so a smoke check refuses a server started before the last edit or from another checkout.
