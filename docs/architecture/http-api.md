# HTTP API

This file holds the settings and analytics endpoints and the rules every endpoint follows; [How omp-agents works](../architecture.md) lists the files for the other endpoints.

**Settings** reads `GET /api/settings`, or `GET /api/settings?cwd=<directory>` for a workspace.
The server loads omp's settings with omp's own read-only loader (`Settings.loadReadOnly` in `pi-coding-agent/src/config/settings.ts`), the same way a session that starts in that directory would, and applies omp's rule for which roles use the `default` chain (`expandDefaultRetryFallbackChains`).
It finds the files through omp's capability discovery (`pi-coding-agent/src/discovery`), agent discovery (`pi-coding-agent/src/task/discovery.ts`), and `findConfigFile` for `APPEND_SYSTEM.md`, and then reads each file from disk.
Each file carries the SHA-256 of its text.
`GET /api/models` runs `omp models --json` for the pickers.

`GET /api/analytics?range=<range>` answers `Analytics` from omp-stats and Claude Code's and Codex's recorded requests, defaulting to `24h`.
The accepted ranges are `today`, `24h`, `7d`, `30d`, `90d`, and `all`; an unknown range returns 400.
The answer includes totals, time buckets with per-provider usage, provider totals, models, workspaces, agent types, tools, the 20 sessions with the most tokens, and live indexing status.

`GET /api/analytics/context?range=<range>[&cwd=<directory>][&session=<id>]` answers `ContextReport`, the context sources over the range, defaulting to `24h`, for every workspace, one working directory, or one session; an unknown range returns 400.
It includes the requests, their input tokens and input cost, the sources by tokens, the workspaces with input in the range, the 20 sessions with the most input in the chosen workspace, and the index's progress while it syncs.

Edits go through two endpoints, each taking the same `?cwd=` and answering with the settings as they load after the write:

- `PUT /api/settings/routing` takes one change: a role's model or fallbacks, a model-keyed chain, some `retry.*` values, or the provider order.
  The server writes it through omp's own write path, the one `omp config set` uses: `Settings.loadIsolated`, the setting's `set` or `setEntry`, and `flush`.
  omp re-reads `config.yml` under its lock and writes back only the paths that changed.
  A model must be one that `omp models` lists, read by `resolveSelector` in `src/omp/config.ts`, so `provider/id:level` works even when the id holds a colon.
  A selector that the config already names passes as it is, so keeping an entry never blocks a save.
  omp checks each retry value against the setting's type and allowed values.
  If omp cannot load `config.yml`, the write is refused, because omp would move the broken file aside before it writes.
- `PUT /api/settings/file` takes `{ path, text, baseHash }`.
  The server runs discovery again for that `cwd` and writes only a path that it finds there, never one the page invents.
  `baseHash` must match the file's current hash, or `null` for a missing file.
  Otherwise the server answers 409 with `conflict: true`.
  The server resolves symlinks, writes a temporary file beside the real file with its mode, and renames it over the real file, so a symlinked file stays a link and a crash cannot leave a truncated file.
  Saves run one at a time, so two saves of the same file cannot both pass the hash check.

Every response from these endpoints is JSON.
An error is `{ error, conflict? }` with the HTTP status.
Any other `/api/` path answers a JSON 404.
The page reports a response that is not JSON with its status and text.
Every endpoint needs the access token as `Authorization: Bearer <token>`, and the routes that an image, a video, or a frame loads also take the media key as `?key=`; see [SECURITY.md](../../SECURITY.md).
