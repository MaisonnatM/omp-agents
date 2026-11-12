# Artifacts

The `artifact` tool saves HTML, Markdown, and SVG files for the user to reopen beside the conversation.
Its successful tool result's `details` is the artifact version record.
There is no custom session entry, `SessionFacts` field, or separate artifact index.

## Records and copies

`ArtifactSave` in `src/shared/artifacts.ts` holds the file's slash-separated identity under `local://`, its kind, title, optional change note as `string | null`, lowercase SHA-256, byte count, and `savedAt`, the save time in milliseconds since the epoch.
The tool stamps `savedAt`, so the live event and the file entry carry the same record and the Artifacts tab can say when each version was saved.
A note is trimmed, contains one line, and has at most 120 characters.
`parseArtifactSave` checks the record at the transcript boundary, and `parseVersionName` checks `<sha256>.<kind>` at the HTTP boundary.
`src/transcript.ts` folds successful artifact results into `Item.artifact`, both from live tool events and from file entries.
A replay with identical details produces no new delta.

The starter kit's `templates/omp/agent/extensions/artifact.ts` owns the save.
The caller writes a file under `local://` first, then calls `artifact` with `path`, `title`, and an optional `note` describing the change.
The tool checks containment after symlink resolution, a supported extension, non-empty UTF-8 bytes of at most 2 MiB, and an SVG root tag for SVG files.
Subagents neither receive its tool schema nor save artifacts through it.

Before returning the record, the tool writes `<artifacts dir>/artifact-versions/<sha256>.<kind>` through a temporary file and rename.
Equal bytes of the same kind share one copy, and later edits to the source file cannot change an earlier version.
The kit cannot import the dashboard's shared module, so `templates/omp/extensions.test.ts` saves every supported source extension and checks its details with the shared parser.
The desktop bundle copies the whole kit `agent/` directory, including this extension.

## Capability URLs

`GET /api/artifact-link?session=<id>&version=<sha256>.<kind>` requires the bearer token and returns `{ url }`.
The returned `/api/artifact` URL carries a deterministic HMAC capability derived from the server token and the exact session and version.
It opens no other session or version, discloses no bearer token, and survives a server restart with the same token.

`GET /api/artifact?session=<id>&version=<sha256>.<kind>&cap=<key>` checks the host, a same-origin or address-bar fetch site, and the capability.
It uses `LiveSessions.fileOf` before the saved file index, so a private live session resolves too.
Only a `.jsonl` session file can supply a version.
A missing copy returns 404.

`SERVED` in `src/server/artifact-routes.ts` holds each kind's content type and sandbox CSP.
HTML runs scripts and forms but has an opaque origin, even when opened as a top-level page.
SVG has no scripts or network sources, and Markdown is served as plain text for browser opens.
Every kind sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Cache-Control: private, max-age=31536000, immutable`.
A missing or wrong capability returns 403, even when the request carries a bearer token.

## Session lifecycle

omp 18.18.6 does not prune individual files in `artifact-versions/`.
Its session deletion removes the whole artifacts directory, and archive or move operations carry the directory as a whole.
`PrivateSessions.purge` deletes the private session's whole directory, so artifact copies need no separate purge step.

The dashboard's fork calls omp's RPC `branch`, which keeps tool results but does not set `copyArtifacts`.
When a version is absent from the fork's own folder, the route follows the native session header's `parentSession`, as an absolute session path or a session id, for at most eight session files.
Content-addressed names let the route serve the ancestor's identical copy without writing another copy or changing the fork path.
If an ancestor is deleted before its fork, an inherited version whose copy existed only there becomes unavailable.
