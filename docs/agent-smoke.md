# Agent smoke checks

Every check starts with [Server lifecycle and authentication](#server-lifecycle-and-authentication); add [Browser smoke](#browser-smoke) or [Desktop smoke](#desktop-smoke) for the surface you verify.

## Server lifecycle and authentication

`bun start` serves `http://127.0.0.1:4317`, where the user's own dashboard usually runs.
Other agent sessions run smoke servers at the same time, so pick a random smoke port between 20000 and 39999 for the whole session, and check it is free with `lsof -nP -iTCP:<port> -sTCP:LISTEN`, which prints nothing for a free port.
Start the server with `bash` as a named service: `command: "PORT=<port> bun src/server.ts"`, `name: "<unique-name>"`, and `ready: {log: "Sign in at"}`.
Service calls omit `async` and `timeout`; a readiness deadline belongs in `ready.timeout`.
Finite checks use `async: true` when needed, without `name` or `ready`.
Stop only your service with `write({path: "proc://<name>/kill"})`, omitting `content`; reading that path does not stop it.
`kill $(lsof -ti tcp:<port>)` also kills every process connected to the port, such as another session's desktop window.
The user's own dashboard runs routines and takes the todos agents add, so a smoke server logs which port owns them and leaves them alone.
It takes them over only when that dashboard is not running, so a smoke run that must not run routines should not start with the user's dashboard stopped.

Every request needs the access token, stored in `~/.config/omp-agents/token` and printed at startup as `Sign in at http://127.0.0.1:<port>/?token=<token>`.
Open that address rather than `/`; for curl, send `Cookie: omp-agents-token=<token>` and a matching `Host` header.
The server does not reload and serves the page bundle built at startup.
Restart it after editing `src/` or `web/`.

A session started from the smoke dashboard is a real omp session.
Open `#new/%2Ftmp` to start one in `/tmp`, use a prompt such as `Reply with just the word ok. Use no tools.`, and end it with **End session**.

## Isolated state

A smoke server reads and writes the user's own state: `calendars.json`, `projects.json`, `token`, and the rest under `~/.config/omp-agents`, and project notes under the data directory.
When a check changes that state, such as starting a project or hiding a calendar, start the server with temporary `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME`, each a fresh `mktemp -d`.
Its token is then in `$XDG_CONFIG_HOME/omp-agents/token`, and its project notes are under `$XDG_DATA_HOME`.
The omp sessions it starts still use the user's omp directory, so they still run with the user's models and sign-ins.

A project's sessions load the installed `~/.omp/agent/extensions/projects.ts` whenever it exists, not `templates/omp/agent/extensions/projects.ts` (`projectsExtensionArgs` in `src/server/project-runner.ts`), so to test an edit of the template, install it first or check `bun run omp-template --dry-run`.

The server strips its own `PORT` and `OMP_AGENTS_PARENT` from the sessions, shells, and commands it starts (`childEnv` in `src/proc.ts`), so a smoke server an agent starts takes the port it is given and does not exit when its stdin ends.

## Browser smoke

Open the page in managed headless Chromium.
Without `relay: false`, `browser.open` tries the omp browser relay, then fails with "extension never connected" or times out after 30 seconds.
Without `viewport`, Chromium renders at 800×600, below the layout's desktop breakpoints, so screenshots show the narrow layout.

```js
const tab = await browser.open({
	name: "smoke",
	url: `http://127.0.0.1:${port}/?token=${token}`,
	app: { relay: false, tern: false },
	viewport: { width: 1920, height: 1080 },
	headed: false,
	wait_until: "domcontentloaded",
	timeout: 60000,
});
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
- `#calendar`, `#routines`, `#routines/<id>`, `#projects`, `#projects/new`, `#projects/<id>`;
- `#new`, `#new/<encoded cwd>`, `#new/<encoded cwd>?todo=<todo id>`, `#scheduled/<send id>`;
- `#settings`, `#settings/<section>`, where `<section>` is `analytics`, `preferences`, `providers`, `integrations`, `mcp-servers`, `source-control`, `workspaces`, `models`, `files`, or `worktrees`.

## Desktop smoke

The desktop shell opens a real window on the user's screen.
After `bun run build` in `desktop/`, start a named service on your smoke port with `PORT=<port> bun launch.ts --remote-debugging-port=<page port> --inspect=<main port>`.
Wait for its `Sign in at` line when it starts its own server.
Pick both debugging ports the same way as the smoke port, each free.
Drive the window through the Chrome DevTools Protocol: `osascript` keys go to the user's frontmost app, not the target window.

- Page: `http://127.0.0.1:<page port>/json` lists it; `Runtime.evaluate` runs JS and `Page.captureScreenshot` captures it.
- Main process: `http://127.0.0.1:<main port>/json` lists it; evaluate `process.mainModule.require("electron")` to reach `app`, `BrowserWindow`, and `Menu`.
  `BrowserWindow.getAllWindows()[0].close()` is what Cmd+W does, `app.emit("activate")` a Dock click, and `app.quit()` Cmd+Q.
  Replace `shell.openExternal` with a function recording its address to verify links without opening the user's browser.

The page's `window.close()` destroys the window and quits the app, unlike Cmd+W.
