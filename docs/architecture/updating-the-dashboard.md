# Updating the dashboard

`src/server/self-update.ts` is **Update dashboard**.
At startup `SelfUpdate.forServer` reads the checkout the server runs from: its top directory, the branch checked out, and that branch's commit, the running build.
A packaged app, a detached HEAD, a directory outside git, or a system without `process.execve` offers no update, and says why.

`SelfUpdate` runs its status reads, its checks, and its updates one at a time, so a check never fetches under a fast-forward.
Once an update starts the restart, a later check answers nothing without fetching, so no fetch outlives `execve` and holds `.git`'s lock when the new server checks.
An update never stashes, resets, or merges:

- It refuses when the checkout moved to another branch since the server started, has changes to tracked files (untracked files do not count), or `origin/<branch>` was never fetched, as for a branch never pushed.
- It fetches `origin/<branch>`, refuses when the branch has commits origin lacks, and otherwise fast-forwards with `git merge --ff-only`, its only write.
- It answers `current` when the checkout then holds the running commit.
- It reads each git exit code exactly: `diff --quiet` and `merge-base --is-ancestor` answer 0 or 1, and any other code, a timeout's included, refuses with git's `fatal:` or `error:` line rather than reading as an answer.
- Otherwise it runs `bun install --frozen-lockfile` when `bun.lock` differs between the running commit and the new one, and answers `restarting`; a failed install leaves the server running and says so.
- 300 ms after answering, so the answer reaches the page or agent that asked, the server restarts: `restart` in `src/server.ts` stops as a shutdown does, letting go of the sessions it started, which run on in their keepers, and writing its stores, and calls `process.execve` with its own command and environment.
  The new server attaches to those sessions again as any start does.
  It keeps the owner lock, which names its pid and port, so no other server takes over the routines while it starts again; a signal or the desktop shell's pipe ending during a restart makes it exit instead.
  The new server keeps the pid, the port, and the standard streams, so a terminal keeps its job and the desktop shell its child, and it builds the page of the checkout as it now is.
- Every later update until then answers the same `restarting`.

The desktop shell's own code in `desktop/` loads only when the app starts again.
Every socket's first message is `{ t: "build", id }`, a hash of the served `index.html`, which names each chunk by its content's hash; the page keeps the first id it heard and reloads when a later socket brings another, so the desktop window follows a restart to the new page.

`GET /api/dashboard/update` answers `DashboardUpdateStatus` from `src/shared/dashboard-update.ts` without asking origin: `unavailable` with its reason, or the branch, the running commit, and `behind`, the commits `origin/<branch>` held past it at the last fetch.
`PUT /api/dashboard/update` with any JSON body runs `SelfUpdate.update` and answers `{ kind: "current" }` or `{ kind: "restarting", from, to, installed }`, or 409 with the refusal.
An agent reaches both with `curl`, with the token as `Authorization: Bearer` and, for the `PUT`, an `Origin` that matches the host; the starter kit's `AGENTS.md` tells agents to load new commits this way, never by killing its processes.
`GET /api/dashboard/build` answers what the server serves, `ServedBuild` from `src/served-build.ts`: its checkout, branch, commit, and working tree as the server read them before it built the page, the page's build, its pid, and when it started, or no checkout for a prebuilt page.
It changes nothing, and the server prints the same at startup as `Serving ...`; `scripts/smoke-proof.ts` and `scripts/pr-parity.ts` compare it with the checkout they run from, so a smoke check refuses a server started before the last edit or from another checkout.
