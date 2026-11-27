# Keep rebased

`KeepRebased` in `src/server/keep-rebased.ts` rebases your pull requests onto their base whenever they fall behind, in each repository whose **Keep rebased** switch is on, with no click and no page open.
It keeps the switch and each rebase that stopped in `keep-rebased.json` beside the access token, a `ReducerFile` shared under an interprocess lock, so the servers beside each other see one state; `KeepRebasedState` in `src/shared/keep-rebased.ts` holds `repos`, each a `repoKey`, and `stops` by `prKey`.

## When it rebases

It rebases after each read of the pull request list for the notices, the activity check every two minutes in `src/server/dashboard.ts`: `noticeSources().pullRequests` in `src/server/notice-sources.ts` hands the list to `KeepRebased.read`.
That check reads the list while a page listens, and on the server that holds the owner lock also without one while any repository has **Keep rebased** on, as it does for the pull request watches.
So a switch turned on rebases within one tick of the check, and the list's 90-second cache may hold the commits one tick longer.

Only the server that holds the owner lock rebases, so only one server pushes; every server forgets the stops a read ends.
A read while a pass still runs starts no other, since one rebase can run a repository's pre-push hook for minutes.
Before each rebase it reads `keep-rebased.json` again and checks the owner lock, so a switch turned off meanwhile, on any server, stops the pass.

## What it rebases

`keepRebasedRuns` in `src/shared/keep-rebased.ts` chooses, in each repository with the switch on and a workspace, the pull requests `rebaseApplies` to, in `rebaseOrder`, the bottom of each stack first: both in `src/shared/rebase-order.ts`, which the page's **Rebase N behind** uses too, so both mean the same by behind.
A pull request stacked on one that is not yet behind waits, since it falls behind only once the one below is pushed, and the next read shows that.
Each rebase is `rebasePullRequest` in `src/pull-request-rebase.ts`, the same as `PUT /api/pull-request/rebase`, run in the repository's first workspace, one at a time.
It never starts a session: a conflict stops the rebase, and **Resolve conflicts** stays the user's move.

## Stops

A rebase that stops at a conflict, or fails, such as a refused push or a pre-push hook that failed, is a `RebaseStop`, kept by the pull request's head commit and its base branch's commit, `headOid` and `baseOid`, which the list query in `src/pull-requests.ts` reads as `headRefOid` and `baseRef.target.oid`.
It is not tried again while both commits stay; a push to the branch or to its base moves one, and the next read forgets the stop and tries again.
A read also forgets a stop whose pull request a rebase no longer applies to, such as one merged, closed, or no longer behind, and a repository GitHub did not answer for keeps its stops.
A pull request stacked above one that stopped waits, in the same pass and in later ones while the stop holds.
Turning a repository's switch off forgets its stops.

Each stop is a notice of kind `rebase-stopped`, with the id `rebase-stopped:<owner>/<repo>#<number>:<head>:<base>`, so a stop on new commits is a new notice; see [Notifications](notifications.md).
The file is the record of what happened, so a restart neither forgets a stop nor tries it again, and a pass a restart cut short is taken up by the next read.

## Route

`GET /api/keep-rebased` answers a `KeepRebasedAnswer`, `{ repos }`, and `PUT /api/keep-rebased` takes a `KeepRebasedChange`, `{ repo, on }`, and answers the same; see [HTTP API: pull requests](http-api-pull-requests.md).
