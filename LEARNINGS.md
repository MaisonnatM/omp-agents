# Learnings

Pitfalls agents have hit in this repository, with the fix.
Add one when a mistake cost a retry and the docs did not prevent it.

## GitHub rate limit

- Agents' `gh` calls and the dashboard share your token's GraphQL budget of 5000 points an hour; once `GraphQL: API rate limit already exceeded`, or the kit's `GitHub GraphQL quota exhausted; next request after <time>`, shows, every `gh pr` command fails until the reset, so retrying them sooner only fails again.
- Run `gh api rate_limit --jq '.resources.graphql | {remaining, reset: (.reset | todate)}'` for the reset time; it costs no points, and the `reset` it prints is UTC.
- REST has its own budget, so `gh api -X POST repos/<owner>/<repo>/pulls -f head=<branch> -f base=main -f title=<title> -f body=<body> -F draft=true` opens a draft, and `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f body=<body>` edits its title, body, or base meanwhile.
- Marking a pull request ready or back to draft has no REST endpoint: wait for the reset, or report the exact `gh pr ready <n>` left to run.

## Kit extensions

- omp hands an extension its own zod-compatible `pi.zod`, which refuses an object or array passed to `.default()` and then fails to load the whole extension; `templates/omp/extensions.test.ts` builds schemas with that same zod, so such a schema fails there.
- Pass a factory, `.default(() => ({ ... }))`, and after changing an extension's schemas load it for real with `omp -p --no-extensions -e <path to the extension> "<prompt that calls its tool>"`; a load failure prints `Failed to load extension`.

## Landing

- `land` lands the checkout it runs in; a session on `main` with its work in a worktree gets "Nothing to land" until it passes that worktree as `path`. Never branch in the shared main checkout to work around it.
- In a final reply, name only the checks the `land` output lists as passed.

## Searching and browser evals

- Search for the exact text you see on screen, such as `xd://:` rather than `mounted`; a common word across `src`, `web`, and omp's source returns hundreds of unrelated lines.
- End a browser eval with an explicit `print` of the fields you need; a bare trailing `globalThis.tab = tab` prints the whole tab object, about 120 lines.
- For a smoke check of something that should disappear, use `scripts/smoke-proof.ts --expect-absent`, which also proves the server serves your checkout; see [docs/agent-smoke.md](docs/agent-smoke.md).
- In the headless desktop app, `Input.dispatchMouseEvent` on the page's DevTools port can hang and a hidden window stops painting; click through the main process's `webContents.sendInputEvent` and nudge painting with a page `Emulation.setDeviceMetricsOverride` then `clearDeviceMetricsOverride`, but that override's pixel density reaches the Browser's guest too, so read a guest's `devicePixelRatio` without it.
- Never send `Page.reload` through a Browser guest's `debugger`: it reloads the dashboard that embeds the guest, which here looped forever; call the guest's `reload()`.

## Shortcuts in dialogs

- A Base UI dialog's popup stops the arrows, Home, and End from bubbling, so a `useShortcuts` binding on one of them never fires while the dialog has focus, and no test catches it; bind it with `usePopupShortcuts` on the popup and press the key in a browser smoke.
