---
status: accepted
date: 2026-10-28
decision-makers: Maxence
supersedes: 2026-10-28-browser-sends-a-sign-in-back-to-the-session-port
---

# Browser leaves a sign-in on other servers

In the context of the Browser showing a session's dev server on a free port, facing apps whose sign-in goes through their own API on another local port before it names the port the app usually runs on, such as yampa's WorkOS callback on its API at `localhost:8000` that then sends you to `localhost:3000`, we chose to map a loopback address to the session's port only when no other server listens there, or another checkout of the same app does, over mapping every port the session runs nothing on, so the API gets its callback and the app still opens on the session's server, accepting a `lsof` and `git` read per listening server when the process list is read.

## Context

[Browser sends a sign-in back to the session's port](2026-10-28-browser-sends-a-sign-in-back-to-the-session-port.md) mapped every loopback port the session runs nothing on.
yampa's callback is its API's `localhost:8000/v1/auth/workos/callback`, which the old rule sent to the front's port, where it answers 404.
Where a redirect comes from cannot tell the two hops apart: both the hop to the API and the API's hop to `:3000` leave the provider's page, since Electron reports the last page it showed.
Whether a port is live cannot either: your own server of the same app often runs on `:3000`.

## Options considered

- Map only ports nothing listens on: breaks whenever you run the app yourself on its usual port.
- Keep a per-app list of ports to leave alone: every app needs setup.
- Leave a port alone when a server that is not the session's and not another checkout of its app listens there: chosen.
  The server finds each listener's working directory with `lsof` and its app with `git rev-parse --git-common-dir --show-prefix`, the same for every worktree of one repository.

## Consequences

- `GET /api/session-processes` adds `otherPorts` to each session, which the page reports with the session's ports through `browserPorts`.
- `appAddress` in `src/shared/desktop-bridge.ts` leaves a target on one of those ports as is.
- A server outside git, such as one in Docker, always counts as another server; a session's server whose working directory is outside git never makes another one count as its app.

## Confirmation

`src/shared/desktop-bridge.test.ts` and `src/server/session-processes.test.ts` cover the rule; an Electron smoke run through a provider page, an API callback on a listening port, and its redirect to the app's usual port ended on the session's port, and the live read put yampa's `:3000` in its app and Docker's `:8000` outside it.

## Revisit when

An app's API runs from the same directory as its front, or the Browser needs a port before the process list is first read.
