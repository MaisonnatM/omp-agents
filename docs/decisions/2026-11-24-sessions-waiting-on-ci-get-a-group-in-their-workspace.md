---
status: accepted
date: 2026-11-24
decision-makers: user, agent
---

# Sessions waiting on CI get a group in their workspace

In the context of the sessions sidebar, facing rows of sessions waiting on their pull requests' checks that showed only a calendar clock, the same as a scheduled send, we chose a **Waiting on CI** group last in each workspace folder, with one line per watched pull request under the session's row, over a separate watcher session per pull request and over a single row that ends on `#7514 +1`, so the user sees each pull request's checks and a session leaves the group by itself when CI goes green, accepting taller rows for a session watching several pull requests.

- A watcher session would lack the original session's branch, worktree, and choices to fix a failure, add a row per pull request, and keep an omp process alive only to wait; `watch_pull_request` already wakes the session doing the work.
- `ScheduledCheck`'s pull-request case lists every watch of the session, each with the checks the watch last saw, and the server pushes the roster after each pull request list, so a row follows its checks.
- A session whose watched pull requests all pass, or have no checks, stops waiting: it shows the blue dot and counts as waiting on you, since a passing check wakes no session; a failing check wakes it, so its row goes back to running.
- The keys that walk the sessions follow the folder's order: its other live rows, its interrupted ones, then the group.
