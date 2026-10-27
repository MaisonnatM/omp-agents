# Agent smoke checks

Every check starts with [Server lifecycle and authentication](#server-lifecycle-and-authentication); add [Browser smoke](#browser-smoke) or [Desktop smoke](#desktop-smoke) for the surface you verify.

## Server lifecycle and authentication

`bun start` serves `http://127.0.0.1:4317` with no window; the user's own desktop app usually runs its server there.
Other agent sessions run smoke servers at the same time, so pick a random smoke port between 20000 and 39999 for the whole session, and check it is free with `lsof -nP -iTCP:<port> -sTCP:LISTEN || echo free`, which prints `free` for a free port instead of failing with `lsof`'s exit code 1.
Start the server with `bash` as a named service: `command: "PORT=<port> bun src/server.ts"`, `name: "<unique-name>"`, and `ready: {log: "The access token is in"}`.
Service calls omit `async` and `timeout`; a readiness deadline belongs in `ready.timeout`.
Finite checks use `async: true` when needed, without `name` or `ready`.
Stop only your service with `write({path: "proc://<name>/kill"})`, omitting `content`; reading that path does not stop it.
`kill $(lsof -ti tcp:<port>)` also kills every process connected to the port, such as another session's desktop window.
The user's own dashboard runs routines and takes the todos agents add, so a smoke server logs which port owns them and leaves them alone.
It takes them over only when that dashboard is not running, so a smoke run that must not run routines should not start with the user's dashboard stopped.

Every request needs the access token, stored in `~/.config/omp-agents/token`, or `$XDG_CONFIG_HOME/omp-agents/token` when that is set; the server prints no sign-in address, and `/?token=` signs nothing in.
The page reads the token from its origin's `localStorage`, which only the desktop window's preload fills, so a browser smoke seeds the same entries itself, `pageAccess(token)` from `src/server/auth.ts`, as [Browser smoke](#browser-smoke) shows.
For curl, send `Authorization: Bearer <token>` and a matching `Host` header.
The server does not reload and serves the page bundle built at startup.
Restart it after editing `src/` or `web/`.

`bun test src/server/application-socket.test.ts` starts the actual application with temporary config and data directories and checks the dashboard socket through its real upgrade route.
It refuses an unauthenticated handshake and a foreign origin, then authenticates with the browser's subprotocols, waits for the initial roster, and checks that the server negotiates only `omp-agents`, never the credential.
This guardrail runs with `bun test` in CI and the pre-push hook; helper-only socket tests do not replace it.

A session started from the smoke dashboard is a real omp session.
Open `#new/%2Ftmp` to start one in `/tmp`, use a prompt such as `Reply with just the word ok. Use no tools.`, and end it with **End session**.

## Isolated state

A smoke server reads and writes the user's own state: `calendars.json`, `token`, and the rest under `~/.config/omp-agents`, and the settings sync's repository under the data directory.
When a check changes that state, such as hiding a calendar, start the server with temporary `XDG_CONFIG_HOME` and `XDG_DATA_HOME` (`src/paths.ts`), each a fresh `mktemp -d`.
Its token is then in `$XDG_CONFIG_HOME/omp-agents/token`.
The omp sessions it starts still use the user's omp directory, so they still run with the user's models and sign-ins.

The server strips its own `PORT` and `OMP_AGENTS_PARENT` from the sessions, shells, and commands it starts (`childEnv` in `src/proc.ts`), so a smoke server an agent starts takes the port it is given and does not exit when its stdin ends.

## Browser smoke

Open the page in managed headless Chromium, or prove a route's texts with [Smoke proof](#smoke-proof), which also checks that the server serves this checkout as it is now.
Without `relay: false`, `browser.open` tries the omp browser relay, then fails with "extension never connected" or times out after 30 seconds.
Without `viewport`, Chromium renders at 800×600, below the layout's desktop breakpoints, so screenshots show the narrow layout.

The page first loads without a token and says to open the omp agents app; seed `localStorage` with `pageAccess(token)` and reload it, from the JS eval kernel:

```js
const { pageAccess } = await import("<worktree>/src/server/auth.ts");
const token = (await Bun.file(`${process.env.HOME}/.config/omp-agents/token`).text()).trim(); // or the smoke server's $XDG_CONFIG_HOME/omp-agents/token
const tab = await browser.open({
	name: "smoke",
	url: `http://127.0.0.1:${port}/`,
	app: { relay: false, tern: false },
	viewport: { width: 1920, height: 1080 },
	headed: false,
	wait_until: "domcontentloaded",
	timeout: 60000,
});
await tab.evaluate(entries => {
	for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
	location.reload();
}, pageAccess(token));
// Page JS goes through tab.evaluate; tab.run runs in Bun, where document is undefined.
const title = await tab.evaluate(() => document.title);
```

The page routes through the URL hash; `web/routing.ts` parses it.
Besides a live session's own hash, the routes are:

- `#past/<session id>`, `#session/<session id>`;
- `#pull-requests`, `#pull-requests/<owner>/<repo>/<number>`, `#pull-requests/<owner>/<repo>/<number>/files`, `#pull-requests/<owner>/<repo>/<number>/files/<encoded path>`;
- `#tickets`, `#tickets/<identifier>`;
- `#inbox`, `#inbox/<thread id>`;
- `#todo`, `#todo/today`, `#todo/needs`, `#todo/agents`, `#todo/archive`, `#todo/<category id>`, each with `?open=<todo id>` to open a todo;
- `#calendar`, `#routines`, `#routines/<id>`;
- `#new`, `#new/<encoded cwd>`, `#new/<encoded cwd>?todo=<todo id>`, `#scheduled/<send id>`;
- `#settings`, `#settings/<section>`, where `<section>` is `analytics`, `activity`, `preferences`, `providers`, `integrations`, `mcp-servers`, `source-control`, `workspaces`, `sync`, `models`, `files`, or `worktrees`.

## Activity reconcile

`scripts/activity-reconcile.ts` checks that Settings › Activity counts exactly what a browser did.
Start a smoke server first; the script starts nothing.

```sh
bun scripts/activity-reconcile.ts --url http://127.0.0.1:<port> [--token <token>] [--agent]
```

It launches Chromium from `playwright-core` without its automation flags, opens six views, presses three shortcuts, runs two palette commands, and starts a session in `/tmp` with one prompt, then waits for the recorder's flush.
It compares `GET /api/activity?range=today` before and after with what it did and prints `reconcile: 0 differences`, or each difference and exits 1.
`--token` defaults to the content of the token file that `src/paths.ts` names, which honors `XDG_CONFIG_HOME`, so against a smoke server on isolated state run the script with the same `XDG_CONFIG_HOME` or pass `--token`.
With `--agent` it keeps the automation flags and passes with `reconcile: 0 rows recorded for automated browser`.
A smoke server records only while it holds `server.lock`, so run it against a server on isolated state.
`scripts/activity-bench.ts --rows <n> --runs <n>` times the store's appends and the 90-day read on a throwaway database.

## Smoke proof

A smoke server serves the code it started with, so a check against a server started before the last edit, or from another worktree, proves nothing about the edit.
The server prints what it serves at startup, as `Serving <checkout> <branch>@<commit>, tree <tree>, page <page>`, and answers it at `GET /api/dashboard/build`.
`scripts/smoke-proof.ts` checks that first, then opens a route and waits for texts to show or go away.

```sh
bun scripts/smoke-proof.ts --omp http://127.0.0.1:<port> [--token <token>] [--route <hash>] [--expect <text>]... [--expect-absent <text>]... [--timeout <seconds, default 15>] [--checkout <dir>] [--run <name>]
```

`--omp` is the server's origin, without a token.
`--token` defaults to the token file's content, as for [Activity reconcile](#activity-reconcile).
It compares the server's checkout and working tree with this checkout's, or with `--checkout`'s, as `git add -A` would stage it now, untracked files included and ignored ones not.

- `match`: the server serves this checkout as it is now, and the run goes on.
- `stale`: the checkout changed since the server started; restart the smoke server and run again.
- `other-checkout`: the server runs from another checkout, which the report names; start a smoke server from this one.
- `unknown`: the server names no git checkout, as a packaged app does; start a smoke server from this checkout.

Anything but `match` exits 1 before a browser opens.
On `match` it seeds the page's `localStorage` with `pageAccess(token)` before the page loads, opens `--omp` with `--route` as its hash in headless Chromium at 1920×1080, and checks that the tab ran the page the server built, hashing the `index.html` it loaded as the server does.
Once the page has drawn the roster, it polls until every `--expect` text is visible and every `--expect-absent` text is not, or `--timeout` passes, then takes a screenshot.
A text counts as visible when an element whose whole text is exactly it, case and all, shows inside the viewport, so a longer title holding it or a row scrolled out of view does not count.
It writes `tmp/smoke/<run>/report.json`, `report.md`, and `screenshot.png`, prints that directory, and exits 0 only when provenance matches, the tab ran the served page, and every expectation held.
The report holds both identities, the verdict, the address, the route, the page check, each expectation's result, and the time; `<run>` defaults to the local commit and the time.

## Pull request header fixture

The session header's pull request moves, such as **Open PR**, depend on what GitHub says of the session's branch, which a smoke check cannot change on a real repository.
`scripts/fake-gh/gh` stands in for `gh` on a smoke server's `PATH`: it answers from the JSON rules in `FAKE_GH_FIXTURE`, read again on every call, exits 1 with one stderr line for any call no rule answers, and appends each call to `FAKE_GH_LOG`.
Sessions that server starts get the fake `gh` too, so nothing reaches GitHub.
`scripts/pr-header-fixture.ts <dir> (--pr <number> | --no-pr)` creates `<dir>/repo`, a checkout of `smoke-fixture/webapp` on branch `feature`, once, and writes the rules that say `feature` heads no pull request or open PR `#<number>`.

1. Run `bun scripts/pr-header-fixture.ts <dir> --no-pr`, which prints the env for the smoke server and the new-session route.
2. Start the smoke server with that env and fresh `XDG_CONFIG_HOME` and `XDG_DATA_HOME` (see [Isolated state](#isolated-state)).
3. Open the printed `#new/<encoded repo>` route as in [Browser smoke](#browser-smoke) and start a session with the prompt `Reply with just the word ok. Use no tools.`.
4. Run `bun scripts/smoke-proof.ts --omp http://127.0.0.1:<port> --token <token> --route <the session's hash> --expect "Open PR"`, with the token from the smoke server's `$XDG_CONFIG_HOME/omp-agents/token`.
5. Run `bun scripts/pr-header-fixture.ts <dir> --pr 7`, which leaves the repository as it is.
6. Run `bun scripts/smoke-proof.ts --omp http://127.0.0.1:<port> --token <token> --route <the session's hash> --expect-absent "Open PR" --expect "#7" --timeout 90`, since the server asks GitHub about a branch with no pull request once a minute.

`<dir>/gh.log` then shows which GitHub reads the server made and which rule answered each.
The rules answer only the reads behind the header, so the pull request panel says it cannot load the pull request.

## Parity harness

`scripts/pr-parity.ts` compares the pull request panel with T3 Code's, so a change to it shows its screenshots before and after.
Start a smoke server from this checkout first; the harness starts nothing, and exits 1 with the reason unless the server serves this checkout as it is now, as [Smoke proof](#smoke-proof) checks.

```sh
bun scripts/pr-parity.ts --omp http://127.0.0.1:<port> [--token <token>] [--t3 <url>] [--pr owner/repo#N] [--draft N] [--merged N] [--closed N] [--theme light|dark|both] [--page <hash>]... [--run <name>]
```

`--omp` is the server's origin and `--token` defaults to the token file's content, as for [Smoke proof](#smoke-proof); the harness seeds the page's `localStorage` with `pageAccess(token)` before it loads.
It opens `#pull-requests/<owner>/<repo>/<number>` in headless Chromium at 1440×900 with the panel pinned to 720 pixels, in light and dark, and captures Summary, Timeline, Code, the checks popover, the `⋯` menu, the Check out menu, the open comment and review composer, and the Summary scrolled down; `--draft`, `--merged`, and `--closed` add the Summary of other pull requests of the same repository.
`--pr` defaults to `yampa-ai/yampa#6833`.
A state whose control the app lacks is reported `absent`.
`--page` adds a whole-window capture of another route of the dashboard, such as `settings` or `past/<session id>`.
`--t3` takes a running T3 Code's address, with any query its pairing needs; without it only the dashboard is captured.
Masks cover avatars, `<time>` elements, and labels such as `updated 8m ago` or `Today`, in magenta; add a region to `MASKS` in the script, not to one capture.
Each run writes `tmp/parity/<run>/<theme>/<number>-<state>.<omp|t3>.png`, a `side-by-side` and `diff` image when both apps ran, and `report.md`, which names the checkout, branch, commit, tree, and page the server serves; `<run>` defaults to the local commit and the time.
Chromium is the `playwright-core` build that `~/Library/Caches/ms-playwright` holds; when it is missing, `bunx playwright-core install chromium-headless-shell` fetches it.

## Desktop smoke

The desktop shell opens a real window on the user's screen.
After `bun run build` in `desktop/`, start a named service on your smoke port with `PORT=<port> bun launch.ts --remote-debugging-port=<page port> --inspect=<main port>`.
Wait for its server's `The access token is in` line, or the listening line `omp-agents (omp v…) on http://127.0.0.1:<port>`, when it starts its own server.
The window signs itself in, so it needs no token from you.
Pick both debugging ports the same way as the smoke port, each free.
Drive the window through the Chrome DevTools Protocol: `osascript` keys go to the user's frontmost app, not the target window.

- Page: `http://127.0.0.1:<page port>/json` lists it; `Runtime.evaluate` runs JS and `Page.captureScreenshot` captures it.
- Main process: `http://127.0.0.1:<main port>/json` lists it; evaluate `process.mainModule.require("electron")` to reach `app`, `BrowserWindow`, and `Menu`.
  `BrowserWindow.getAllWindows()[0].close()` is what Cmd+W does, `app.emit("activate")` a Dock click, and `app.quit()` Cmd+Q.
  Replace `shell.openExternal` with a function recording its address to verify links without opening the user's browser.

The page's `window.close()` destroys the window and quits the app, unlike Cmd+W.
