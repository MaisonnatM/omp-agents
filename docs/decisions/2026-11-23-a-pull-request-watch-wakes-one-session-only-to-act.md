---
status: accepted
date: 2026-11-23
decision-makers: agent
supersedes: 2026-11-23-a-session-watches-a-pull-request-through-the-activity-checks-list
---

# A pull request watch wakes one session, only when it must act

In the context of `watch_pull_request`, facing 43 "Pull request … changed: … Act on it now" wakes in one day, 20 of them checks passing or an approval that needed nothing, the same pull requests waking two sessions, and a check that failed and passed again within a minute, we chose to wake only on checks failing, more unresolved review threads, changes requested, or a merge or close, over waking on every change, to stop wakes that cost a turn and say nothing to do, accepting that a session waiting for an approval must ask for it with `ready: true`.

- The ship flow never merges and stops when the pull request is merge-ready or waits on human review, so it moves on no passing check or approval; only a session asked to merge once a pull request passes and is approved waits for that, and it says so with `ready: true`, so only that session wakes for it.
- A change that wakes must last a minute, measured from the first list that showed it, and the wake names the net change since the state the session last knew, so a flapping check wakes nothing; the hold lives in the owner's memory, so a restart only holds a change again.
- One session watches a pull request, the latest to call the tool, since a later session on the same pull request, such as a resumed or forked one, is the one doing the work; the tool says when it took the watch over.
- The rest of the superseded record holds: the watch reads the activity check's list, it is a host tool, checks starting again after a push wake nothing, and an unlisted pull request ends its watch after ten minutes.

See [Scheduled sends](../architecture/scheduled-sends.md).
