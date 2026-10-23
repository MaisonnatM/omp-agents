# Desktop shell

`desktop/` is the desktop app: an Electron main process, `desktop/main.ts`, in its own package, so the root `bun install` never fetches Electron.
Electron's main process runs on Node, which cannot load omp's TypeScript modules or the server's `Bun.*` calls, so the shell runs the server as a child process on Bun and never imports it: `bun src/server.ts` from a checkout, and in the packaged app the Bun binary it ships in `Contents/Resources/server/bin/bun` on the bundled `server.js`, with `OMP_AGENTS_RESOURCES` naming that directory (`src/server/resources.ts`) so the server reads its prebuilt page and the starter kit from it.
omp's sessions run on that same Bun, through `process.execPath`.
It imports only `src/paths.ts`, `src/json.ts`, `src/server/auth.ts`, `src/server/address.ts`, and `src/shared/desktop-bridge.ts`, which use Node's modules alone; `bun build` bundles them into `desktop/dist/main.cjs`, and `desktop/preload.ts` into `desktop/dist/preload.cjs`.
Its global quick-capture shortcut dispatches `QUICK_TODO_EVENT`, from `src/server/address.ts`, in the page, which `web/app.tsx` answers by opening the command palette on its **Create todo** view.
`src/server/address.ts` holds what the two processes must agree on: the port from `PORT`, the host names the server answers to, and the line it prints once it listens.

- At launch it calls `loadToken`, as the server does, so whichever runs first creates the token file, and asks `GET /?token=<token>` on the port.
  A 302 that sets the cookie can come only from an omp-agents server that holds this token, and the window uses it.
  A refused connection starts a server.
  Any other answer means the port is taken, and the window says so.
- The shell takes the server as started once it prints `listeningLine` (`omp-agents (omp v…) on http://127.0.0.1:<port>`), not once the port answers: another server that took the port while this one built its page would answer too, and the shell would then own a server that is about to fail.
- It spawns the server with `OMP_AGENTS_PARENT=stdin` and an open stdin pipe that it never writes to.
  The server calls its `shutdown()` when that pipe ends, which it does however the shell exits, `SIGKILL` included, so no server outlives the app and holds the port.
  On a normal quit, the shell sends `SIGTERM` and waits up to 10 seconds for the server to write its stores and let go of its sessions.
  Quitting leaves the sessions the server started running, as a restart or a crash does: the server cannot tell a quit from a restart, **Restart to Install** quits too, and the next launch shows them live again, while **End session** stays the one way to stop a session.
- **Update dashboard** runs the server again inside the same process ([Updating the dashboard](updating-the-dashboard.md)), so the shell keeps its child, its pipes, and the window; the page in the window reloads itself once its socket hears a new build, as a browser tab's does.
- The window loads `http://127.0.0.1:<port>/?token=<token>`, a navigation that sends `Sec-Fetch-Site: none`, so `guardsFor` admits it as it admits the printed address in a browser, and the socket's `Origin` matches its `Host`.
  A custom scheme for the page would fail that check.
- `setWindowOpenHandler` denies every new window and hands `http:` and `https:` addresses to `shell.openExternal`; `will-navigate` does the same for any address outside the dashboard's origin.
  An empty `window.open`, which a browser tab opens before it knows the address, returns `null`, so the MCP sign-ins in `web/use-sign-in.ts` then open the address themselves once the server names it.
- The page runs with context isolation and the sandbox on, and gets no Node or Electron API.
  Its preload, `desktop/preload.ts`, hands it only `window.ompDesktop`, the `DesktopBridge` of `src/shared/desktop-bridge.ts`, whose `badge`, `alert`, and `ownsClose` send one IPC message each; see [Session notifications](notifications.md#session-notifications).
  The main process takes each one only from the window's own dashboard frame.
- The app keeps its data, its cookie, localStorage, window bounds, and single-instance lock, in `port-<port>` under Electron's `userData`, so a smoke run on another port is an instance of its own beside your app.
- A main-frame load of the dashboard that fails (`did-fail-load`), for example after the server the window used stopped, shows the shell's error page with **Retry** instead of Chromium's.
- The packaged app, launched by Finder or at login, gets no shell environment, so `desktop/shell-env.ts` runs the login shell (`$SHELL -ilc`) once at startup and merges its environment into `process.env` before the server starts; omp, `gh`, and `git` are then found as in a terminal.
- **Open at Login** is the packaged app's own login item (`setLoginItemSettings`); a checkout has none, and the app removes the LaunchAgents that `bun run desktop` once wrote.
- `desktop/updates.ts` updates the packaged app through electron-updater from GitHub Releases: a check 15 seconds after launch and then every 30 minutes, a download in the background, a notification, and **Restart to Install** in the app menu, which stops the server first; an update left waiting installs when the app quits.
  Squirrel.Mac installs only an update signed by the same Developer ID as the running app, so ad hoc builds check and download but never install.

## Packaging and releases

`scripts/build-desktop-artifact.ts`, modeled on T3 Code's script of the same name, builds `desktop/dist/resources` (the server bundled into `server.js` with Tailwind left out, the page prebuilt by `buildPage`, the keeper and the session visuals extension bundled into `keeper.js` and `session-visuals-extension.js`, and the starter kit with its installer bundled into `install.js`), downloads the Bun of the build's own version for each architecture into `desktop/dist/bun-<arch>`, and runs electron-builder with a config it generates, which writes a DMG, a zip, their blockmaps, and `latest-mac.yml` to `desktop/release`.
It signs and notarizes when `CSC_LINK` and the `APPLE_API_KEY*` variables are set, with the hardened runtime and `desktop/entitlements.mac.plist`, which lets Bun JIT; otherwise it signs ad hoc.
`--mock-update-port <port>` points the update feed at `scripts/mock-update-server.ts`, which serves `desktop/release`, to try an update without publishing.
`.github/workflows/release.yml` runs on every push to `main`, one run at a time with a newer push cancelling an older run: it sets `desktop/package.json`'s patch version to the run number, keeping its major and minor, then runs the checks, one build for arm64 and x64 on an Apple silicon runner, and a GitHub Release tagged `vX.Y.Z` with every artifact.
