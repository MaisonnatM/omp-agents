# Desktop shell

`desktop/` is the desktop app: an Electron main process, `desktop/main.ts`, in its own package, so the root `bun install` never fetches Electron.
Electron's main process runs on Node, which cannot load omp's TypeScript modules or the server's `Bun.*` calls, so the shell runs the server as a child process on Bun and never imports it: `bun src/server.ts` from a checkout, and in the packaged app the Bun binary it ships in `Contents/Resources/server/bin/bun` on the bundled `server.js`, with `OMP_AGENTS_RESOURCES` naming that directory (`src/server/resources.ts`) so the server reads its prebuilt page and the starter kit from it.
omp's sessions run on that same Bun, through `process.execPath`.
It imports only `src/paths.ts`, `src/json.ts`, `src/server/auth.ts`, `src/server/address.ts`, and `src/shared/desktop-bridge.ts`, which use Node's modules alone; `bun build` bundles them into `desktop/dist/main.cjs`, and `desktop/preload.ts` into `desktop/dist/preload.cjs`.
Its global quick-capture shortcut dispatches `QUICK_TODO_EVENT`, from `src/server/address.ts`, in the page, which `web/app.tsx` answers by opening the command palette on its **Create todo** view.
`src/server/address.ts` holds what the two processes must agree on: the port from `PORT`, the host names the server answers to, and the line it prints once it listens.

- At launch it calls `loadToken`, as the server does, so whichever runs first creates the token file, and asks `GET /api/hello?nonce=<nonce>` on the port with a fresh random nonce.
  Only an omp-agents server that holds this token can answer with `helloProof`, the HMAC of the token, the port, and the nonce, so the shell sends the token nowhere else.
  A refused connection starts a server.
  Any other answer means the port is taken, and the window says so.
- The shell takes the server as started once it prints `listeningLine` (`omp-agents (omp v…) on http://127.0.0.1:<port>`), not once the port answers: another server that took the port while this one built its page would answer too, and the shell would then own a server that is about to fail.
- It spawns the server with `OMP_AGENTS_PARENT=stdin` and an open stdin pipe that it never writes to.
  The server calls its `shutdown()` when that pipe ends, which it does however the shell exits, `SIGKILL` included, so no server outlives the app and holds the port.
  On a normal quit, the shell sends `SIGTERM` and waits up to 10 seconds for the server to write its stores and let go of its sessions.
  Quitting leaves the sessions the server started running, as a restart or a crash does: the server cannot tell a quit from a restart, **Restart to Install** quits too, and the next launch shows them live again, while **End session** stays the one way to stop a session.
- **Update dashboard** runs the server again inside the same process ([Updating the dashboard](updating-the-dashboard.md)), so the shell keeps its child, its pipes, and the window; the page in the window reloads itself once its socket hears a new build.
- The window loads `http://127.0.0.1:<port>/`, a navigation that sends `Sec-Fetch-Site: none`, so `servePage` answers it with the page, and the socket's `Origin` matches its `Host`.
  A custom scheme for the page would fail that check.
- No address carries the token.
  The preload, before the page's scripts run, asks the main process over the synchronous `ACCESS_CHANNEL`, and writes each entry of the answer into the page's `localStorage`.
  The main process answers `pageAccess(token)`, the token and the media key, only when the message comes from the window's own dashboard frame, and `null` otherwise, so the shell's own notice pages get nothing.
- `setWindowOpenHandler` denies every new window: it loads the dashboard's own page, with the address's hash, in the window itself, and hands other `http:` and `https:` addresses, `/api/` media links included, to `shell.openExternal`; `will-navigate` hands any address outside the dashboard's origin to `shell.openExternal` too.
  An empty `window.open`, which a page opens before it knows the address, returns `null`, so the MCP sign-ins in `web/use-sign-in.ts` then open the address themselves once the server names it.
- The page runs with context isolation and the sandbox on, and gets no Node or Electron API.
  Its preload, `desktop/preload.ts`, hands it only `window.ompDesktop`, the `DesktopBridge` of `src/shared/desktop-bridge.ts`, whose `badge` and `alert` send one IPC message each; see [Session notifications](notifications.md#session-notifications).
  Its `onTargetURL`, absent in an app built before it, receives the address of the link under the pointer or keyboard focus from the window's `update-target-url` event, and an empty string when the window blurs or navigates.
  Its `signIn`, which the page calls when it holds no token, asks the shell to load the dashboard again with the page's hash, so the preload writes the current token.
  The main process reloads only when the token file now holds a token other than the one it last handed out, as after a rotation; otherwise a reload would loop, and the page stays on its notice that the server holds another token.
  The main process takes each one only from the window's own dashboard frame.
- The session's permission handlers grant only clipboard writes and full screen, and only to the dashboard's own page; every other request is refused.
  Session notifications come from the main process, so the page needs no notification permission.
- The app keeps its data, its localStorage, window bounds, and single-instance lock, in `port-<port>` under Electron's `userData`, so a smoke run on another port is an instance of its own beside your app.
- A main-frame load of the dashboard that fails (`did-fail-load`), for example after the server the window used stopped, shows the shell's error page with **Retry** instead of Chromium's.
- The packaged app, launched by Finder or at login, gets no shell environment, so `desktop/shell-env.ts` runs the login shell (`$SHELL -ilc`) once at startup and merges its environment into `process.env` before the server starts; omp, `gh`, and `git` are then found as in a terminal.
- **Open at Login** is the packaged app's own login item (`setLoginItemSettings`); a checkout has none, and the app removes the LaunchAgents that `bun run desktop` once wrote.
- `desktop/updates.ts` updates the packaged app through electron-updater from GitHub Releases: a check 15 seconds after launch and then every 30 minutes, a download in the background, a notification, and **Restart to Install** in the app menu, which stops the server first; an update left waiting installs when the app quits.
  Squirrel.Mac installs only an update signed by the same Developer ID as the running app, so ad hoc builds check and download but never install.

## Packaging and releases

`scripts/build-desktop-artifact.ts`, modeled on T3 Code's script of the same name, builds `desktop/dist/resources` (the server bundled into `server.js` with Tailwind left out, the page prebuilt by `buildPage`, the keeper and the session visuals extension bundled into `keeper.js` and `session-visuals-extension.js`, and the starter kit with its installer bundled into `install.js`), downloads the Bun of the build's own version for each architecture into `desktop/dist/bun-<arch>`, and runs electron-builder with a config it generates, which writes a DMG, a zip, their blockmaps, and `latest-mac.yml` to `desktop/release`.
It signs and notarizes when `CSC_LINK` and the `APPLE_API_KEY*` variables are set, with the hardened runtime and `desktop/entitlements.mac.plist`, which lets Bun JIT; otherwise it signs ad hoc.
`--mock-update-port <port>` points the update feed at `scripts/mock-update-server.ts`, which serves `desktop/release`, to try an update without publishing.
`.github/workflows/release.yml` runs on every push to `main`, one run at a time with a newer push cancelling an older run, in three jobs.
`test` runs the checks with a read-only token and no secret.
`build` sets `desktop/package.json`'s patch version to the run number, keeping its major and minor, and builds arm64 and x64 on an Apple silicon runner; the signing secrets reach only its signing step, and its token only reads.
`publish`, the one job whose token can write, downloads the artifacts and creates a GitHub Release tagged `vX.Y.Z` with every one, running no code from the checkout.
Every action is pinned to a commit, with its tag in a comment, and no checkout keeps its token in `.git/config`.
