# HTTP API: pull requests

`GET /api/pull-request/title?owner=<o>&repo=<r>&number=<n>` answers `{ title }` for a bare GitHub or Graphite PR link.
It reads only the title through `gh api graphql`, using the same validated pull request query as the details routes, and keeps each answer for 30 seconds, sharing in-flight reads.
The page's existing `useRead` drops answers for a previous link and aborts the read when the link unmounts; explicit Markdown labels do not request a title.
`GET /api/pull-request/files?owner=<o>&repo=<r>&number=<n>` answers `PullRequestChanges`: title and branches from REST, the files from the paginated REST files endpoint, and each file's `viewerViewedState` from paginated GraphQL.
Files are ordered by source dependencies, tests in source order, and generated files last.
The optional `commit=<full oid>` scopes both `/files` and `/file` to a commit belonging to that pull request, with a separate cache entry and the blobs from that commit.
Each list call reads GitHub again and keeps patches and blob ids for following file reads for 30 seconds.
`GET /api/pull-request/file?owner=<o>&repo=<r>&number=<n>&path=<path>` answers one file of that list in full, `ChangedFileText`, and 404 for a path the list does not hold.
GitHub's patch keeps three unchanged lines around each change, so `patchRows` in `src/shared/changes.ts` fills the lines before, between, and after its hunks from the file's text at the head, which one `gh api graphql` call reads by the blob id the list names.
Both file readers answer through `fileText(path, rows, note)` in `src/shared/changes.ts`, so a file's rows and the note on why it has none take one shape.
A removed file's patch holds every line, so it reads no blob; a file GitHub sends no patch for, a binary file, and one over `MAX_CHANGED_FILE_BYTES` answer a note.
`GET /api/pull-request/stack?owner=<o>&repo=<r>&number=<n>` answers the pull requests of the header's **N/M** stack menu, `StackedPullRequest[]` top first, from one `gh api graphql --paginate --slurp` read of the repository's open pull requests, forks left out, which it keeps for 30 seconds.
`stackOf` in `src/pull-request-stack.ts` follows the base branches down from the pull request and the pull requests based on its branch up, so the stack holds those that the Pull requests page does not list.
`GET /api/pull-request/options?owner=<o>&repo=<r>` answers `PullRequestOptions` for the pickers of a pull request's **Summary**: the repository's labels, from `gh api --paginate --slurp` on REST, and the people its issues can be assigned to, whom a review can be asked of, from GraphQL `assignableUsers` with their login, profile name, and avatar, each sorted by name or login and kept five minutes per repository.
`PUT /api/pull-request` takes a `PullRequestEdit`, a pull request and one `change`, checked by `parsePullRequestEdit` in `src/server/wire.ts`: a label or a review request added or removed through REST, or a state of `open`, `draft`, or `closed` through the GraphQL mutations `stateSteps` orders, a closed pull request reopening before its draft flag changes.
A `title` change carries a nonblank title of at most 256 characters and patches `repos/<owner>/<repo>/pulls/<number>`.
A `body` change carries the description and its `original` text, each up to `MAX_PULL_REQUEST_BODY` (65536 characters), and `allowEmpty: true` when clearing the description is intentional.
It refuses a failed read, a description that no longer matches `original`, or a blank replacement without that explicit permission, and preserves the checked original before writing.
The description remains a literal `-f body=…` REST field, preserving whitespace.
These preflight comparisons detect edits observed before the write; GitHub does not provide an atomic description compare-and-swap through this path.
Comment and review authors carry `isBot` from GitHub's `__typename` `Bot`, which the **Bot comments** filter reads along with a `[bot]` login suffix, since some GitHub Apps comment under a login without one.
An `update` change selects `merge` or `rebase` and calls `GITHUB_MERGES.update` with the node id and head read fresh from GitHub.
`PUT /api/pull-request/viewed` takes a `PullRequestViewedEdit`, a pull request with `{ path, on }`, reads the pull request node id, calls `markFileAsViewed` or `unmarkFileAsViewed` through GraphQL, and answers `{}`, since the **Code** tab keeps its own viewed states.
The queue uses the same update function with the merge method.
`PUT /api/pull-request/checkout` takes a `PullRequestCheckout` from `src/shared/github.ts`, a pull request with `{ cwd, place, skill }`, checked by `parsePullRequestCheckout`, and answers 404 when `cwd` is not a directory.
`checkOutPullRequest` in `src/pull-request-checkout.ts` refuses a `cwd` whose `origin` is another repository, reads the head branch and commit from REST, both through `src/pull-request-head.ts`, and answers a `CheckedOutPullRequest`: its `place`, the branch, whether it is at that commit, and at `worktree` the `instanceId` of the session it started; any refusal answers 409 with why.
Place `here` refuses uncommitted changes to tracked files and runs `gh pr checkout <number> -R <owner>/<repo>` in `cwd`.
Place `worktree` fetches `refs/pull/<number>/head` without tags or forcing into the head branch's name, or `pr-<number>/<name>` for a fork; a non-fast-forward rejection is explained as a local branch with commits of its own.
It gives a branch from the same repository the upstream `origin/<name>`, unless a linked worktree already has the branch, which it reuses as it is.
It refuses the branch while the main checkout has it, then starts a `new` session through the same start a socket `start` runs, with `branch: { kind: "existing" }`, the pinned `skill`, a prompt asking for a summary, and the pull request as its subject, so `checkoutDir` reuses or adds the worktree.
`PUT /api/pull-request/rebase` takes a `PullRequestRebase` from `src/shared/github.ts`, a pull request with `{ cwd }`, checked by `parsePullRequestRebase`, and answers 404 when `cwd` is not a directory.
`rebasePullRequest` in `src/pull-request-rebase.ts` refuses a `cwd` whose `origin` is another repository and a pull request whose branch is in a fork, reads its head and base branches from REST, both through `src/pull-request-head.ts` as the checkout does, and answers a `RebasedPullRequest`: `rebased`, `current`, or `conflict` with the conflicted files, each with the branch and the base it went `onto`.
It runs one rebase per repository at a time, in a `SerialLane` keyed by the repository's common git directory and dropped once no rebase runs or waits there, so a bulk run or two clicks never rebase the same repository at once.
It fetches both branches from `origin` without tags into their remote-tracking refs and answers `current` when `origin/<base>` is already in `origin/<head>`.
A worktree that has the branch checked out must have no changes to tracked files; it fast-forwards to `origin/<head>`, which git refuses during a merge, cherry-pick, or revert, and the rebase runs there.
Otherwise the rebase runs in a detached worktree of its own under the temporary directory, which it removes after.
Either way a local branch with commits `origin/<head>` lacks is refused, so the push never drops work.
The rebase is `git rebase --fork-point origin/<base>`, so a branch stacked on one that was just rebased replays only its own commits, without update-refs, autostash, an editor, or a prompt.
A rebase that stops on conflicts lists the unmerged files and aborts, so no branch moves; one that fails otherwise aborts and answers 409 with git's error.
The push is `git push --force-with-lease=refs/heads/<head>:<fetched commit> origin HEAD:refs/heads/<head>` with hooks on, so the repository's pre-push hook runs its checks, through `run` with `child: true`, which leaves out the `PORT` and `OMP_AGENTS_PARENT` that `childEnv` keeps from the server's children.
A failed hook or a branch that moved on `origin` since the fetch answers 409 with the last lines git wrote, the hook's output among them, and puts the worktree that has the branch back where it was; after a push from a worktree of its own, a local branch moves to the pushed commit.
Each refusal, a worktree with changes, local commits, a fork, or another repository, is also a 409 with why.
Fetching, adding the worktree, and rebasing each stop after two minutes, and the push after 20; the route lifts Bun's 10-second idle timeout for the request with `server.timeout(req, 0)`, so the page's `putJson` waits for the answer.
Each open pull request detail adds one REST comparison of its base against its head commit.
`behindBy` is the comparison's `behind_by` count, or `null` for an unavailable comparison or a finished pull request.
A merge is no change of its own: it goes through `PUT /api/merge-queue`, whose `MergeQueue` runs GraphQL's `mergePullRequest` with `expectedHeadOid` the commit the confirmation showed, so GitHub refuses the merge once the branch moved past it.
The pull request's answer carries that commit as `headOid` and the methods its repository allows as `mergeMethods`.
A `thread` change, `{ id, resolved }`, runs GraphQL's `resolveReviewThread` or `unresolveReviewThread` on the review thread with that node id, which `parsePullRequestEdit` takes only as letters, digits, `_`, `-`, and the `=` an older base64 id ends with, at most 100.
A `reply` change, `{ thread, body }`, runs `addPullRequestReviewThreadReply` on that thread.
A `comment` change, `{ body }`, posts to REST's `repos/<o>/<r>/issues/<n>/comments`, the pull request's number naming it, with the body as a `-f` field, which `gh` sends as written, never as a number, a file, or a placeholder.
A reply's or comment's body is not blank and at most 65536 characters, GitHub's limit.
The pull request's answer lists every review thread among the first 100, resolved ones too, each with its node id and whether the viewer may reply, resolve, and unresolve it, from `viewerCanReply`, `viewerCanResolve`, and `viewerCanUnresolve`, so the button a resolve or unresolve shows at once stays right.
The same detail GraphQL request reads `mergedAt`, `closedAt`, comment and review `reactionGroups`, each thread's `isOutdated`, its total comment count, and its root comment's review state for dismissal.
Each thread still loads its first 20 comments, with the total count letting the Timeline link to replies beyond that limit on GitHub.
Reaction groups carry their content, user count, and viewer participation for read-only display; lifecycle times remain separate from `updatedAt`.
The Timeline adds no activity request and does not invent draft, ready, reopen, force-push, or base-change history from the pull request's current state.
Its `unresolved` counts the open threads among those it lists, with `exact` false when GitHub has more than it listed, and `bots`, how many of them a bot started, so the details' counts agree with their threads.
GitHub's GraphQL has no `viewerCanComment` on a pull request, so its `canComment` is true unless the repository is archived, or the conversation is locked and the viewer's `viewerPermission` is below `WRITE`, as GitHub lets only people who can write comment on a locked conversation.
Its `byViewer` is `viewerDidAuthor`, since GitHub refuses an approval or a change request from the pull request's author.
A `review` change posts `{ event, body }` to `pulls/<n>/reviews`, leaving out a blank body; `canSubmitReview` in `src/shared/review-drafts.ts` decides whether one may post, for the composer and the server alike.
Every mutation goes through `ghMutation` in `src/github.ts`, which throws GitHub's errors even when its answer carries `data`, since a refused mutation answers its field as `null` beside them.
`PUT /api/pull-request` answers the pull request as `GET /api/pull-request` reads it after the change, read again from GitHub, and the details then refresh the pull request list.
One change goes per call, so two changes made at once each keep the other.
The details send their changes one at a time through `useEditableRead` in `web/editable-read.ts`, which the issue detail's fields share.
Each answer carries how many writes had answered when it was asked, so an answer to an earlier change, or a read sent before a write answered, never hides a later change.

The reads the dashboard makes on its own go through `ghPolledGraphql` in `src/github.ts`: the pull request list of `GET /api/pull-requests`, which the page polls every minute and the notices check, the stack of `GET /api/pull-request/stack`, every open pull request of the repository, which a session's header and **PRs** sidebar read again as the session works, and the merge cleanup's look at the live sessions' pull requests.
They share the user's `gh` token, and its 5000 GraphQL points an hour, with every agent's `gh` and `gt`, so `githubQuota`, a `GithubQuota` from `src/github-quota.ts`, reads `gh api rate_limit`, which costs no points, at most every 30 seconds, before `GitHubAccess` sees the call.
While fewer than `GRAPHQL_RESERVE` (1000) points are left, those reads ask GitHub nothing until the quota's `reset`, and throw `GithubQuotaPaused` with `GitHub quota low until HH:MM` in the server's local time.
`GitHubAccess` still pauses every GraphQL call, these and the user's, once GitHub reports the budget spent, and a refusal leaves `remaining` under the reserve, so the gate needs no refusal handling of its own.
`loadPullRequests` throws either error for the whole list rather than answering a repository with an error, so the page keeps the list it has and shows it as **Cannot refresh pull requests:**, as for any failed refresh, and the merge cleanup skips a look either error stops without logging it.
Everything a click asks for, a pull request's details, files, pickers, and title, each change and its mutations, and the merge queue's reads for a merge the user queued, runs through `ghGraphql`, below the reserve too, until `GitHubAccess` finds the budget spent.
GitHub bills a nested connection for every node its parents may return, so the list's query costs 5 points a call: asking each of a search's 100 threads for its first comment made it 125, which at one poll a minute spent the hour's budget down to the reserve on its own.
The list reads a thread's starter once instead, at a point for each 100 new open threads; check a query's cost with `rateLimit(dryRun: true) { cost }` before polling it.

`GET /api/github-media?url=<HTTPS URL>` reads GitHub images and videos through `src/github-media.ts`.
The allowlist is `github.com/user-attachments/`, `private-user-images.githubusercontent.com`, `user-images.githubusercontent.com`, and `camo.githubusercontent.com`; credentials, alternate ports, and every other host or scheme are rejected.
`githubMediaUrl` in `src/shared/github.ts` holds it, and the page loads every such image or video written on GitHub through this route, so the page's CSP allows only GitHub's avatars directly.
It reads `gh auth token --hostname github.com` only for a `github.com` hop, at most once a minute, checks each of at most five redirects before fetching it, and never sends that token to a CDN.
Only image and video content types pass, up to 20 MiB streamed under one 15-second deadline, with a five-minute private cache bounded to 32 entries and 40 MiB.
Upstream cookies and headers do not pass through; responses have `nosniff` and a sandbox CSP.
A `github.com` upload may redirect once into GitHub's signed upload bucket, `github-production-user-asset-6210df.s3.amazonaws.com`, which gets no token and which no other hop or request may reach.

`GET /api/favicon?host=<host name>` reads a site's icon through `src/favicon.ts` for the changes card's Sources section, so the page's CSP keeps refusing outside images.
It asks `https://<host>/favicon.ico`, then the first icon the home page's `<link rel="icon">` names, over HTTPS without ports or credentials.
It refuses IP literals, single-label and local names, and any host or redirect hop whose DNS answers hold a loopback, private, link-local, or multicast address, so a page cannot steer it at this computer or its network.
Only image types up to 256 KiB pass, and a home page up to 512 KiB, under one 8-second deadline; each host's answer, an icon or none, is cached for a day, up to 256 hosts.
Responses have `nosniff` and a sandbox CSP; a host with no icon answers 404 and the page shows a globe.

`PUT /api/merge-queue` takes a `MergeQueueChange` from `src/shared/merge-queue.ts`, checked by `parseMergeQueueChange` in `src/server/wire.ts`: `{ op: "add", method, prs }`, one to `MAX_QUEUED_STACK` (20) pull requests in any order, each with the head commit the confirmation showed or `null`, or `{ op: "cancel", id }`.
It answers a `MergeQueueAnswer`, the queued merges after it, which every socket also hears as a `merges` message, and the pull requests it merged on the way, which `writeMergeQueue` in `web/reads.ts` marks merged in the list at once; a refusal, such as a branch that moved or a pull request already queued, is a 409 with the reason.
The details' answer carries GitHub's `mergeStateStatus` as `mergeState`, which `mergesNow` in `src/shared/github.ts` reads to word the confirmation as a merge now or once it is ready.

`GET /api/review-draft/preview?owner=<o>&repo=<r>&number=<n>` answers a `ReviewPreview` from `src/shared/review-drafts.ts`: the `payload` posting would send, the pull request's `head` now, and the `refusal`, or `null`; see [Review drafts](review-drafts.md).
`PUT /api/review-draft/post` takes `{ owner, repo, number }`, and optionally the composer's `submit: { verdict, summary }`, which the server checks the post against and writes into the draft, accepting its pending findings, once the post is not refused, so a refusal leaves the draft as it was; it posts that pull request's draft as one review, and answers the draft marked posted, which every socket also hears; a refusal, or GitHub's own, is a 409 with the reason.
