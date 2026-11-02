# HTTP API

This file holds the settings, analytics, and activity endpoints and the rules every endpoint follows; [How omp-agents works](../architecture.md) lists the files for the other endpoints.

**Settings** reads `GET /api/settings`, or `GET /api/settings?cwd=<directory>` for a workspace.
The server loads omp's settings with omp's own read-only loader (`Settings.loadReadOnly` in `pi-coding-agent/src/config/settings.ts`), the same way a session that starts in that directory would, and applies omp's rule for which roles use the `default` chain (`expandDefaultRetryFallbackChains`).
It finds the files through omp's capability discovery (`pi-coding-agent/src/discovery`), agent discovery (`pi-coding-agent/src/task/discovery.ts`), and `findConfigFile` for `APPEND_SYSTEM.md`, and then reads each file from disk.
Each file carries the SHA-256 of its text.
`workflows` lists, by name, the skills among those files whose frontmatter, as omp's discovery parsed it, names `workflow` in `metadata.tags`, a comma- or space-separated string (`workflowsOf` in `src/omp/workflows.ts`).
The tag sits under `metadata` because omp's plugin loader (`validateAgentSkillFrontmatter` in `pi-coding-agent/src/discovery/agent-plugin-format.ts`) refuses a top-level key other than `name`, `description`, `license`, `allowed-tools`, `metadata`, and `compatibility`, and a `metadata` value that is not a string.
Each workflow carries the skill's name as omp resolves it, its `name` field else its directory, and two paths into `files`: `skill`, and `command`, the slash command omp names the same, the project's before the user's, or `null`.
A workflow's skill is one of `files`, so `PUT /api/settings/file` edits it.
`agentSettings` holds omp's own settings as omp's terminal `/settings` panel lays them out, read by `readAgentSettings` in `src/omp/agent-settings.ts`, or `{ error }` when omp cannot load them.
Its tabs, groups, and controls come from `getSettingsForTab` in `pi-tui/src/overlays/settings-defs.ts`, over the entries `orderedSettings` in `pi-coding-agent/src/config/all-settings.ts` lists, so a setting omp adds to its panel shows with no change here.
Settings that change only how omp's terminal draws are left out: those under `tui.`, `statusLine.`, `display.`, `theme.`, `composer.`, and `terminal.`, `symbolPreset`, `colorBlindMode`, and those omp's panel shows only for an image protocol, native rendering, or vim mode.
Each row carries omp's default and the values in your `config.yml` (`user`) and in the workspace's settings (`workspace`, `getProjectSettings`), each absent when that layer sets none, and `env`, the variable that overrides it when one is set.
A credential's value never leaves the server: its `user` and `workspace` are `true` when set, and it carries no default.
`unlisted` names every other setting a session reads, those omp's panel gives no control to.
`GET /api/models` runs `omp models --json` for the pickers.

**Get started** reads `GET /api/readiness/terminal-sessions` (omp's global `collab.autoStart`) and `GET /api/readiness/starter-kit` (a genuinely read-only installer plan).
`PUT /api/readiness/terminal-sessions` takes `{ access }` of `view` or `control`, stages only `collab.autoStart` through omp's isolated locked writer unless it already holds that value, and returns the value it reads back; another body is a 400.
Providers, GitHub, sessions, and integrations reuse `GET /api/providers`, `GET /api/source-control`, and their existing socket/store reads; see [Get started](get-started.md).

`GET /api/analytics?range=<range>` answers `Analytics` from omp-stats and Claude Code's and Codex's recorded requests, defaulting to `24h`.
The accepted ranges are `today`, `24h`, `7d`, `30d`, `90d`, and `all`; an unknown range returns 400.
The answer includes totals, time buckets with per-provider usage, provider totals, models, workspaces, agent types, tools, the 20 sessions with the most tokens, and live indexing status.

`GET /api/analytics/context?range=<range>[&cwd=<directory>][&session=<id>]` answers `ContextReport`, the context sources over the range, defaulting to `24h`, for every workspace, one working directory, or one session; an unknown range returns 400.
It includes the requests, their input tokens and input cost, the sources by tokens, the workspaces with input in the range, the 20 sessions with the most input in the chosen workspace, and the index's progress while it syncs.

`GET /api/analytics/session?session=<id>` answers `AnalyticsSession`, what that session's file and its subagents' files used over all time, from omp-stats, or `null` before its first request; a missing `session` returns 400, and a session whose file is not listed returns 404.

`GET /api/activity?range=<range>` answers `ActivityRead`, the page's activity over the range, defaulting to `30d`, with the same ranges as Analytics; an unknown range returns 400 `Unknown activity range`.
It includes each feature's uses, every feature's last use over all stored rows, the moves between views, the time on each view, each local day's active time, visits, and actions, and `serverActions`, every route that takes a `PUT`, for the inventory; see [Activity](activity.md).

**Storage** reads `GET /api/storage`, or `?cwd=<known-workspace>` only to report workspace overrides.
`StorageUsage` in `src/shared/storage.ts` includes allocated folder sizes, global cleanup rules as `AgentSettingRow`s with native defaults and exact user values for conflict checks, workspace override ids separately, and the last native background compression log.
The three measured folders come from omp's directory exports; the archive-size card is absent because omp's archive-directory helper is private.
`PUT /api/storage/cleanup` takes `{ action: "preview" }` for all five native phases, or `{ action: "preview", step: "sandboxes" }` for the independently measured sandbox plan.
Apply takes `{ action: "apply", step }` for exactly one of `stale`, `blobs`, `archive`, `compress`, and `wal`.
Sandbox apply takes `{ action: "apply", step: "sandboxes", sandboxes: string[] }`, at most 200 paths per request; the page sends one at a time.
`src/omp/gc.ts` runs `omp gc --json` from the home directory, with all explicit phase flags for preview and one phase plus `--apply` for apply.
Native gc owns its lock, thresholds, references, and keep rules.
An exit with phase errors still returns its parsed report, while a held native lock or sandbox guard answers 409 with a busy error.
`src/server/storage-routes.ts` disables the idle timeout for long storage requests and never kills a running cleanup when the page stops requesting steps.
The page runs stale, blobs, archive, compress, and wal in that order, then sandboxes, and stops after a failed step or a request to stop.
Rule changes reuse `PUT /api/settings/agent` with the user value the row showed as `expected`; no separate settings writer exists.
Storage uses omp settings' `SettingRow`: toggles save on change, whole-number fields on Enter or blur, and Reset removes the user's override.
After a conflict, the row reloads the current value and asks the user to review it before another change.
No daily native cleanup or dashboard-triggered automatic compression is added.

Edits go through three endpoints, each taking the same `?cwd=` and answering with the settings as they load after the write:

- `PUT /api/settings/routing` takes one change: a role's model or fallbacks, a model-keyed chain, some `retry.*` values, or the provider order.
  The server writes it through omp's own write path, the one `omp config set` uses: `Settings.loadIsolated`, the setting's `set` or `setEntry`, and `flush`.
  omp re-reads `config.yml` under its lock and writes back only the paths that changed.
  A model must be one that `omp models` lists, read by `resolveSelector` in `src/omp/config.ts`, so `provider/id:level` works even when the id holds a colon.
  A selector that the config already names passes as it is, so keeping an entry never blocks a save.
  omp checks each retry value against the setting's type and allowed values.
  If omp cannot load `config.yml`, the write is refused, because omp would move the broken file aside before it writes.
- `PUT /api/settings/agent` takes `{ id, value, expected }` or `{ id, reset: true, expected }` for one of omp's settings, any id `agentSettings` could list, whether or not this page gives it a control.
  `expected` is the `user` value the page showed, `null` when unset; when `config.yml` holds another value, the server answers 409 with `conflict: true` and writes nothing.
  The server checks the value with the setting's `assertWritable`, then writes through the same path as routing: `Settings.loadIsolated`, the handle's `set`, or `unset` for a reset, and `flush`.
  It answers 404 for an id omp does not know and for one that changes only how omp's terminal draws, and 400 for a value omp refuses.
- `PUT /api/settings/file` takes `{ path, text, baseHash }`.
  The server runs discovery again for that `cwd` and writes only a path that it finds there, never one the page invents.
  `baseHash` must match the file's current hash, or `null` for a missing file.
  Otherwise the server answers 409 with `conflict: true`.
  The server resolves symlinks, writes a temporary file beside the real file with its mode, and renames it over the real file, so a symlinked file stays a link and a crash cannot leave a truncated file.
  Saves run one at a time, so two saves of the same file cannot both pass the hash check.

**Decisions** reads `GET /api/decisions?cwd=<directory>`, for a workspace only, and answers `{ dir, dirDisplay, records }`.
`readDecisions` in `src/decisions.ts` finds the repository's top through git, else takes `cwd` itself, and reads the first of `docs/decisions`, docs/adr, and doc/adr that exists, or answers `dir: null`.
Each record is its file name, title, `status`, `date`, `decision-makers`, `supersedes`, `superseded-by`, and the Markdown after its title, newest first; a file with no frontmatter or broken YAML still lists, with only what it holds.

Every response from these endpoints is JSON.
An error is `{ error, conflict? }` with the HTTP status.
Any other `/api/` path answers a JSON 404.
The page reports a response that is not JSON with its status and text.
Every endpoint needs the access token as `Authorization: Bearer <token>`, and the routes that an image, a video, or a frame loads also take the media key as `?key=`; see [SECURITY.md](../../SECURITY.md).
