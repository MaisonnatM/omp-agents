# Learnings

Pitfalls agents have hit in this repository, with the fix.
Add one when a mistake cost a retry and the docs did not prevent it.
The second time a lesson recurs, it becomes a check: a test, a lint rule as [Tests and lint](CODING_STANDARDS.md#tests-and-lint) says, a hook, or a `land` check; its line here then goes or points at the check.

## GitHub rate limit

- Agents' `gh` calls and the dashboard share your token's GraphQL budget of 5000 points an hour; once `GraphQL: API rate limit already exceeded`, or the kit's `GitHub GraphQL quota exhausted; next request after <time>`, shows, every `gh pr` command fails until the reset, so retrying them sooner only fails again.
- Run `gh api rate_limit --jq '.resources.graphql | {remaining, reset: (.reset | todate)}'` for the reset time; it costs no points, and the `reset` it prints is UTC.
- REST has its own budget, so `gh api -X POST repos/<owner>/<repo>/pulls -f head=<branch> -f base=main -f title=<title> -f body=<body> -F draft=true` opens a draft, and `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f body=<body>` edits its title, body, or base meanwhile.
- Marking a pull request ready or back to draft has no REST endpoint: wait for the reset, or report the exact `gh pr ready <n>` left to run.

## Kit extensions

- `src/extension-zod-defaults.test.ts` checks that a kit extension passes `.default()` a factory, never a literal, which omp's `pi.zod` refuses at load.
- After changing an extension's schemas, load it for real with `omp -p --no-extensions -e <path to the extension> "<prompt that calls its tool>"`; a load failure prints `Failed to load extension`.

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

- `web/popup-shortcuts.test.ts` checks that a Base UI dialog binds arrows, Home, and End with `usePopupShortcuts`, since its popup stops them before `useShortcuts`.
