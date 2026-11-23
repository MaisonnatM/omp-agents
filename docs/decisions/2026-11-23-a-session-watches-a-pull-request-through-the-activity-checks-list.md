---
status: superseded
date: 2026-11-23
decision-makers: agent
superseded-by: 2026-11-23-a-pull-request-watch-wakes-one-session-only-to-act
---

# A session watches a pull request through the activity check's list

An agent that waits on a pull request's checks or reviews used to sleep, poll `gh`, or schedule follow-ups to itself, each poll spending the GraphQL budget agents and the dashboard share.
A dashboard session now calls the host tool `watch_pull_request`, as it calls `schedule_follow_up`, and ends its turn; `PullRequestWatches` (`src/server/pull-request-watches.ts`) wakes it with one follow-up, through the same resume path as scheduled sends and the Board, when the pull request's checks finish, its review decision or unresolved thread count changes, or it merges or closes.

- The watch reads the pull request list the activity check already loads for the Pull requests page and the bell, so it adds no GitHub read and stops with the list while the quota is low, rather than polling once per session.
- It is a host tool rather than an HTTP route the ship extension calls, since the host tools already know their caller's session, which a route would need a token and a session id for; terminal sessions, which get no host tools, keep polling.
- Checks that start running again after a push wake nothing, so a push wakes the agent once, when they finish.
- Only the user's open pull requests and those asking for their review, in a workspace's repository, are in that list, so a watch on another pull request ends with a message after ten minutes instead of waiting forever.

See [Scheduled sends](../architecture/scheduled-sends.md).
