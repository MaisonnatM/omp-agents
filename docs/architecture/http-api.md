# HTTP API

This file holds the settings, analytics, and activity endpoints and the rules every endpoint follows; [How omp-agents works](../architecture.md) lists the files for the other endpoints.

**Settings** reads `GET /api/settings`, or `GET /api/settings?cwd=<directory>` for a workspace.
The server loads omp's settings with omp's own read-only loader (`Settings.loadReadOnly` in `pi-coding-agent/src/config/settings.ts`), the same way a session that starts in that directory would, and applies omp's rule for which roles use the `default` chain (`expandDefaultRetryFallbackChains`).
It finds the files through omp's capability discovery (`pi-coding-agent/src/discovery`), agent discovery (`pi-coding-agent/src/task/discovery.ts`), and `findConfigFile` for `APPEND_SYSTEM.md`, and then reads each file from disk.
Each file carries the SHA-256 of its text, and a Markdown file its parsed frontmatter, in the shape `GET /api/file` gives it.
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
`agents` is an `AgentCatalog` from `src/shared/agents.ts`, a new-session preview read by `src/omp/agents.ts` through native `discoverAgents`, read-only classification, and model selection and resolution.
It carries the winning definitions, scope and package origin, declared tools, model layers, explicit resolved/inherited/unresolved/source-session model states, disabled markers, missing user overrides, and an explicit bundled-seance marker.
The four execution settings come from `agentSettings`, not a second catalog projection or settings load.
Without `cwd`, discovery runs from `/` and filters project definitions, avoiding the home directory's project agents and config; this is a user-only preview, not a running session's extension context.
Model resolution reads the native registry's currently available models without refreshing providers or making model requests; a model-registry failure is separate from a discovery failure.
Bundled seance never uses the stored user override in its effective preview.
`GET /api/models` runs `omp models --json` for the pickers; `listModels` in `src/omp/models.ts` keeps its list 30 seconds, so the draft's `/api/models/connected` and `/api/models/roles`, the settings page, and every window share one run, and a model added to omp's config shows within that time.

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
`PUT /api/storage/cleanup` takes `{ action: "preview", source }`: `gc` answers `{ gc }` for all five native phases, `sandboxes` answers `{ sandboxes }`, the independently measured sandbox plan, and `caches` answers `{ caches }`, each installed tool's cache path and allocated size.
Apply takes `{ action: "apply", step }` for exactly one of `stale`, `blobs`, `archive`, `compress`, `wal`, and `packageCaches`.
Sandbox apply takes `{ action: "apply", step: "sandboxes" | "changedSandboxes", sandboxes: string[] }`, at most 200 paths per request; the page sends one at a time.
`changedSandboxes` also removes a sandbox kept only because its checkout holds changes; a live owner, a lock, or a checkout in use still keeps it.
`src/server/package-caches.ts` runs `uv cache prune --force`, `pnpm store prune`, and `bun pm cache rm` for each tool on `PATH`, and answers each cache's size before and after with its error.
`--force` skips uv's cache lock, which every running `uvx` process holds for its whole life; before the prune, the uv entries any process has open, per `lsof`, are hard-linked into `.uv-cache-keep` beside the cache and moved back afterwards.
When `lsof` answers nothing or fails, uv's cache is left unpruned with an error rather than pruned blind.
`src/omp/gc.ts` runs `omp gc --json` from the home directory, with all explicit phase flags for preview and one phase plus `--apply` for apply.
Native gc owns its lock, thresholds, references, and keep rules.
An exit with phase errors still returns its parsed report, while a held native lock or sandbox guard answers 409 with a busy error.
`src/server/storage-routes.ts` disables the idle timeout for long storage requests and never kills a running cleanup when the page stops requesting steps.
The page runs stale, blobs, archive, compress, and wal in that order, then sandboxes, then package caches, and stops after a failed step or a request to stop.
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
  An optional nonempty `entry` is accepted only for `task.agentModelOverrides` and names one agent's map entry, including a stale name discovery no longer finds.
  In that typed entry form, `expected` must be a selector, ordered selectors, or `null` and compares only that user's entry; a new value is a nonempty selector or ordered nonempty list of selectors, and native `setEntry` writes or removes only that entry.
  Other entries changed elsewhere and workspace-only entries are never copied into the user's map.
- `PUT /api/settings/file` takes `{ path, text, baseHash }`.
  The server runs discovery again for that `cwd` and writes only a path that it finds there, never one the page invents.
  `baseHash` must match the file's current hash, or `null` for a missing file.
  Otherwise the server answers 409 with `conflict: true`.
  The server resolves symlinks, writes a temporary file beside the real file with its mode, and renames it over the real file, so a symlinked file stays a link and a crash cannot leave a truncated file.
  Saves run one at a time, so two saves of the same file cannot both pass the hash check.

**omp memory** reads `GET /api/omp-memory?cwd=<directory>`, which answers 400 without `cwd`, since omp keeps memory per workspace, and answers `{ preview, store }`, built by `loadOmpMemory` in `src/memory.ts` from the settings a session in that workspace loads and the backend omp's `resolveMemoryBackend` picks from them, Off for a value omp does not know.
`preview` is the block a new session's system prompt gets from `buildDeveloperInstructions`, `partial` for Mnemopi and Hindsight, which add recalled memories as the session runs, and `store`, the store of the backend in effect: Local's and Sharpshooter's files that exist, with Sharpshooter's queued sessions, or Mnemopi's and Hindsight's rows, newest first and at most 500, each with the edits omp allows on it, or `{ error }`.
Mnemopi's working and episodic rows come from omp's `beam.exportToDict` on each bank, less those another bank wrote, superseded, or past their end, and its facts from the bank's `facts` table; Hindsight's from the server's `listMemories`.
The backend and **Auto-learn** are rows of `agentSettings` in `GET /api/settings`, and save through `PUT /api/settings/agent`.
Each write below takes `?cwd=`, runs one at a time, answers 400 without it, answers 409 with `conflict: true` when the backend in effect is no longer the one it edits, and answers the memory as it now loads.
- `PUT /api/omp-memory/file` takes `{ path, text, baseHash }` for a file the store lists, with the hash check, symlink handling, and atomic write of `PUT /api/settings/file`, and answers 404 for a path the store does not list.
- `PUT /api/omp-memory/entry` takes `{ op: "update", bank, id, expected, content }`, or `op` `forget` or `retire` without `content`, for a Mnemopi row of a bank the workspace reads.
  `expected` is the text the page showed; a row that is gone or holds other text answers 409 with `conflict: true`, and an edit omp does not allow on the row's kind answers 400.
  The server opens the bank through omp's `Mnemopi`, as a session does, redacts secrets from new text with `redactMemorySecrets`, and updates or forgets a working row or retires an episodic one, as omp's `/memory` edits do; facts are read-only.
- `PUT /api/omp-memory/clear` takes `{ backend }`, one of `local`, `sharpshooter`, and `mnemopi`, which must be the backend in effect.
  Local and Sharpshooter clear through the backend's own `clear`, as omp's `/memory clear` does; Mnemopi removes the databases of the workspace's own banks and keeps the shared one, and answers 400 when every bank it reads is shared.
- `PUT /api/omp-memory/rebuild`, for Local only, calls the backend's `enqueue`, which marks the summary for the rebuild the next session in the workspace runs as it starts.

**Decisions** reads `GET /api/decisions?cwd=<directory>`, for a workspace only, and answers `{ dir, dirDisplay, records }`.
`readDecisions` in `src/decisions.ts` finds the repository's top through git, else takes `cwd` itself, and reads the first of `docs/decisions`, docs/adr, and doc/adr that exists, or answers `dir: null`.
Each record is its file name, title, `status`, `date`, `decision-makers`, `supersedes`, `superseded-by`, and the Markdown after its title, newest first; a file with no frontmatter or broken YAML still lists, with only what it holds.

Every response from these endpoints is JSON.
An error is `{ error, conflict? }` with the HTTP status.
Any other `/api/` path answers a JSON 404.
The page reports a response that is not JSON with its status and text.
Every endpoint needs the access token as `Authorization: Bearer <token>`, and the routes that an image, a video, or a frame loads also take the media key as `?key=`; see [SECURITY.md](../../SECURITY.md).
