# Coding standards

Every change meets [Every change](#every-change).
Then read the section for the work: [Changelog](#changelog), [Tests and lint](#tests-and-lint), [omp imports](#omp-imports), [omp internals](#omp-internals), [Where changes go](#where-changes-go), [Markdown](#markdown), or [Template sync](#template-sync).

## Every change

- Keep each pull request to one change, and explain why it is needed.
- Add or update tests for behavior you change.
- Add lines to `CHANGELOG.md` in every change that reaches `main`, as [Changelog](#changelog) says.
- Run `bun test`, `bun run typecheck`, and `bun run lint` and fix what they report.
  Read test results through `bun run test:agent [bun test args]`, which runs `bun test` and prints only a `PASS n FAIL m SKIP k (Ns)` line and one `ERROR <file> > <test> > <first line>` line per failure, and exits as `bun test` does.
  After you change `desktop/`, run `bun install --cwd desktop --frozen-lockfile` once and `bun run --cwd desktop typecheck`.
- Update `docs/usage/` when the interface changes, `docs/architecture/` when the server or a protocol changes, and `docs/code-layout/` when you add, move, or remove a file, or change what one does, including its [Interface map](docs/code-layout.md#interface-map) entry.
  Each of `docs/usage.md`, `docs/architecture.md`, and `docs/code-layout.md` lists its directory's files, one per feature; add a file there when you add one, and split a file before it reaches the 32 KiB that `src/docs.test.ts` allows.
  The README holds only features, installation, and configuration.
- Look a feature up in `docs/usage/` by the words the page shows, such as a button's or a tab's label, rather than by a code identifier, which the interface docs rarely name.
- Bump the tested omp version at all its pins together: `.github/workflows/checks.yml`, `.github/workflows/release.yml`, the README's omp badge and its `Tested with omp` line, the `placeholder` in `.github/ISSUE_TEMPLATE/bug_report.yml`, and the omp version `templates/omp/README.md` names.
  Bump Bun's version at all its pins together: both workflows, the README's badge and its two version lines, `package.json`'s `bun` devDependency, `MIN_BUN` in `src/preflight.ts`, and the Bun `placeholder` in `.github/ISSUE_TEMPLATE/bug_report.yml`.
  Check a new omp release with `bun run omp-release` and the [omp release skill](.agents/skills/omp-release/SKILL.md) before you bump it.
- A change to a file that [`.omp/review-paths`](.omp/review-paths) matches needs the thermonuclear review before it ships; add a file there when it becomes a shared contract or a central file.
- A change to a file that [`.omp/ui-paths`](.omp/ui-paths) matches needs the interface review before the thermonuclear one.

## Changelog

`CHANGELOG.md` is what the header's What's new lists, so every change that reaches `main` adds lines to it.
Put them in the top day section, `## YYYY-MM-DD` for today, and add that heading above the others when it is missing.
Each line is one `- ` bullet on one line, in plain text, with no Markdown formatting, backticks, or links.
Only those bullets under a day heading show; the title and the prose under it do not.

- Write for someone who uses the dashboard but doesn't code.
  Say what they can now do or see, or what got better or was fixed: "You can …", "The Bots tab now …", "Fixed: …".
- Name things by the words on screen, such as a button's label or a tab's name, never by a file, function, API, commit, branch, or pull request number.
- Use no jargon, such as "endpoint", "socket", "refactor", "typecheck", "migration", "props", or "worktree", unless the screen shows that word.
- Write short sentences, one idea per line, each ending with a period.
- Work nobody notices, such as tests, agent docs, or internal cleanup, still gets one line that starts "Behind the scenes:" and names the benefit.

The pre-merge-commit hook refuses a merge into `main` that leaves `CHANGELOG.md` unchanged, so add the lines on the branch before you merge it; a fast-forward skips that hook, and the post-merge hook warns after one instead.
The pre-push hook refuses a push to `main` whose commits leave `CHANGELOG.md` unchanged.
`.gitattributes` merges `CHANGELOG.md` with git's union driver, which keeps both sides' lines instead of conflicting, so the same day heading can appear twice; What's new reads both as one day.
The pre-commit hook drops `CHANGELOG.md`'s oldest days, whole, when a commit grows it past the 32 KB every doc stays under, so What's new lists fewer old days and git history keeps them.
A merge commit skips that hook: when a merge leaves the file too large, run `bun scripts/trim-changelog.ts` and commit the result.

## Tests and lint

A test that already exists guards behavior, so change or delete one only when that behavior changed on purpose, never to make a failing check pass.
When you do, add a line `test-change: <reason>` to one of the branch's commit messages; the landing check `scripts/check-test-edits.ts` fails without it, and adding a new test needs none.

`bun run lint` runs Biome with only the rules `biome.json` turns on, with Biome's formatter off, then `scripts/lint/run.ts`, which runs this repository's own rules, `RULES` in `scripts/lint/rules.ts`.
Its last line is `RESULT: PASS` or `RESULT: FAIL (<what failed>)`.
When the same mistake shows up a second time, turn it into a rule rather than writing the lesson down again:

1. Use a Biome rule when one catches it: look it up in [Biome's rule list](https://biomejs.dev/linter/rules/), count its hits with `bunx biome lint --only=<group>/<rule>`, fix them, and add it to its group in `biome.json` as `"error"`.
   A deliberate hit gets `// biome-ignore lint/<group>/<rule>: <reason>` on the line above it.
2. Otherwise write a rule: a module under `scripts/lint/rules/` that exports a `Rule` from `scripts/lint/rule.ts`, added to `RULES`.
   A rule may read a repository file, such as `GLOSSARY.md`, which Biome cannot.
3. Add the rule's canary, a file that breaks it on purpose: `scripts/lint/canaries/biome/<group>/<rule>.ts` for a Biome rule, `scripts/lint/canaries/<rule id>.<ext>` for one of ours.
   `scripts/lint/canaries.test.ts` fails a rule with no canary, a canary with no rule, and a canary its rule does not flag, so a rule that silently stops firing fails the tests.
4. When a rule of ours has more hits than one change should fix, run `bun scripts/lint/run.ts --write` to record them in `lint-baseline.json`, and add a line `lint-baseline: <reason>` to one of the branch's commit messages.
   The baseline counts the findings each rule may still have in each file: a count above it fails with that file's findings, a count below it fails until `--write` lowers it, and a raised count fails the landing unless a commit says why.
5. Run `bun run lint`, then point the lesson's line in `LEARNINGS.md` at the rule.

## omp imports

Import omp's code instead of reimplementing a protocol or file format.
Import omp's modules only from `src/omp/`, and only through `src/omp/modules.ts`; the one exception is `src/keeper.ts`, which imports the RPC frame module by the path `modules.ts` gives it.
It checks each export this app uses at startup, so add a new export there, and the interface it reads to its area's file in `src/omp/module-types/`.

## omp internals

Read omp's docs before its source: `omp://rpc.md` (RPC frames and commands), `omp://session.md` (session file format), `omp://collab.md`, and `omp://extensions.md`.
Then read [omp modules](docs/architecture/omp-modules.md), which lists the source files this app uses.
After you read omp's source to learn a subsystem, add its files and the exports you used there, so the next agent starts there.

## Where changes go

- A new field on a session row: `RosterHost` or `PastSession` in `src/shared/sessions.ts`, then `row()` in `src/guest.ts` and `src/dashboard-session.ts` (both implement `LiveSession` in `src/live-session.ts`) for what a transport knows, `rows()` in `src/server/live-sessions.ts` for what every live session shares, or `factsOf`/`past` in `src/server/session-files.ts` for what the session files tell, then `web/components/session-row.tsx` and the header in `web/components/conversation-header.tsx`.
- A socket message: `ClientMsg` or `ServerMsg` in `src/shared/protocol.ts`, parsed in `src/server/wire.ts`, handled in `src/server/socket.ts` and `web/use-dashboard.ts`.
- A keyboard shortcut: the table in `web/shortcuts.ts`.
- A control only the page sees, which no view, command, or action records: its id in `CONTROLS` in `src/shared/activity.ts`, spread `activityControl(id)` from `web/activity.ts` on it, and a row in the coverage table of `docs/architecture/activity.md`.
- A popup, list, tab, or other interactive part of the page: UI SDK (`@ui-sdk/react`) primitives; read `node_modules/@ui-sdk/react/docs/llms.txt` first, and for a new component search `node_modules/@ui-sdk/react/docs/core.md` by heading and read `rendering.md` beside it.

## Markdown

Write every Markdown file with one sentence per line.
Tools that read a doc cut a line at 768 characters, and an edit that copies the cut line back writes the truncation mark `…` into the file.
`bun run lint` (the `doc-lines` rule, `scripts/lint/rules/doc-lines.ts`) fails a line over 700 characters or ending in `…`, in root Markdown and under `docs/`, `templates/omp/`, and `.agents/`, including nested agent instructions and skills.

## Template sync

After you edit an installed file under `~/.omp/agent/` that `templates/omp/` also holds, copy it into the matching file there; [Starter kit and docs](docs/code-layout/starter-kit-and-docs.md) says which of `agent/` and `maintainer/` holds it.
`bun run omp-template --dry-run` lists a copy you edited as `keep yours`, and one the kit installed and you never edited as `overwrite`, which an install or **Update dashboard** brings up to date.
