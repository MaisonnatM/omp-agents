# Agent smoke checks

Every check starts with [Server lifecycle and authentication](#server-lifecycle-and-authentication); add [Browser smoke](#browser-smoke) or [Desktop smoke](#desktop-smoke) for the surface you verify.

## Server lifecycle and authentication

`bun start` serves `http://127.0.0.1:4317`, where the user's own dashboard usually runs.
Other agent sessions run smoke servers at the same time, so pick a smoke port between 4400 and 4899 for the whole session.
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

## Browser smoke

Open the page in managed headless Chromium.
Without `relay: false`, `browser.open` tries the omp browser relay, then fails with "extension never connected" or times out after 30 seconds.

```js
const tab = await browser.open({
	name: "smoke",
	url: `http://127.0.0.1:${port}/?token=${token}`,
	app: { relay: false, tern: false },
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
- `#todo`, `#todo/today`, `#todo/agents`, `#todo/archive`, `#todo/<category id>`;
- `#calendar`, `#routines`, `#routines/<id>`;
- `#new`, `#new/<encoded cwd>`, `#new/<encoded cwd>?todo=<todo id>`;
- `#settings`, `#settings/<section>`, `#settings/<section>/<encoded cwd>`, where `<section>` is `analytics`, `preferences`, `integrations`, `workspaces`, `models`, `files`, or `worktrees`.

## Desktop smoke

The desktop shell opens a real window on the user's screen.
After `bun run build` in `desktop/`, start a named service on your smoke port with `PORT=<port> bun launch.ts --remote-debugging-port=<page port> --inspect=<main port>`.
Wait for its `Sign in at` line when it starts its own server.
Pick both debugging ports between 9400 and 9899.
Drive the window through the Chrome DevTools Protocol: `osascript` keys go to the user's frontmost app, not the target window.

- Page: `http://127.0.0.1:<page port>/json` lists it; `Runtime.evaluate` runs JS and `Page.captureScreenshot` captures it.
- Main process: `http://127.0.0.1:<main port>/json` lists it; evaluate `process.mainModule.require("electron")` to reach `app`, `BrowserWindow`, and `Menu`.
  `BrowserWindow.getAllWindows()[0].close()` is what Cmd+W does, `app.emit("activate")` a Dock click, and `app.quit()` Cmd+Q.
  Replace `shell.openExternal` with a function recording its address to verify links without opening the user's browser.

The page's `window.close()` destroys the window and quits the app, unlike Cmd+W.
