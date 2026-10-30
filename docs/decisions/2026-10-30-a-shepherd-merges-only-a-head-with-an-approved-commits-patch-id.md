---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# A shepherd merges only a head with an approved commit's patch id

In the context of a PR shepherd that pushes fixes after a reviewer approved, facing code that GitHub still reports approved when the repository keeps stale approvals, we chose to queue a shepherd's merge only when the head's stable `git patch-id`, from where it leaves its base, equals that of a commit an approving review names, over trusting GitHub's review decision and over requiring the head to be the approved commit itself.
A rebase keeps its patch id, so the shepherd still merges a pull request it only rebased, and any change to the code needs a fresh review.
`unapprovedChange` in `src/pull-request-approval.ts` fetches the base, the head, and the approved commits in the pull request's workspace, and `patchId` diffs each from its merge base with the base.
We accept a fetch on every merge request, and that a conflict resolution during a rebase changes the patch id and so needs a fresh review.
