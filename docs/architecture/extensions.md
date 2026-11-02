# Extensions library

`src/shared/extensions.ts` is the HTTP contract for packages, source catalogs, contribution provenance, changes, and operation state.
`src/omp/extensions.ts` adapts omp's exported marketplace manager, plugin manager, skill installer/client, discovery providers, and setting descriptors.
`src/omp/modules.ts` checks every required export and manager method at startup; `src/omp/module-types/extensions.ts` holds their narrow types.
The dashboard does not parse portable plugin formats, resolve semver, unpack registry archives, execute package entrypoints for inspection, or write native registries itself.
A top-level raw-registry guard refuses a marketplace mutation when omp would silently treat malformed JSON as an empty registry.
Native errors and discovery warnings remain visible.

## HTTP API

All routes share the existing authenticated settings endpoints and workspace validation in `src/server/routes.ts`.
`cwd` absent means **All**, never the server's working directory; a supplied directory must be a known workspace.

- `GET /api/settings/extensions` returns local packages, all known discovery items, providers, sources, effective/global registry URL, and diagnostics.
- `PUT /api/settings/extensions` validates an `ExtensionChange` and starts a serialized native mutation, returning an operation ID.
- `GET /api/settings/extensions/catalog?source=<marketplace>&q=<query>&page=<page>` reads a cached marketplace, all cached marketplaces when source is empty, or the remote skill registry when source is `registry`.
- `GET /api/settings/extensions/operation?id=<id>` reads the operation only in the workspace that started it.
- `PUT /api/settings/extensions/approval` answers the exact current script approval with `{ id, token, approved }` in that workspace.
- `GET /api/settings/extensions/contribution?key=<key>` re-discovers the workspace and reads only a current contribution path, with a one-MiB preview limit.

`src/extensions.ts` holds validation, the operation queue, transient approvals, and the read-only preview allowlist.
An operation is working, needs-approval, done, or failed.
The native installer receives `yes: false` and its script confirmation callback waits on a random token bound to the operation and workspace, with exact package/version/files shown.
Decline or ten minutes without an answer resolves false; a stale token is refused.
Terminal jobs expire after one hour and server restart forgets them; no credentials or catalog answers are persisted by the dashboard.
The queue prevents two dashboard native mutations racing a registry, including while an approval waits.
It is not a cross-process lock on an independently running omp CLI.

## Discovery and ownership

`src/omp/scoped-discovery.ts` serializes native discovery reads while binding the selected workspace's read-only settings, because the native provider registry uses a process-wide settings binding.
The files, prompts, project-trust inspection, MCP discovery, and Extensions readers share that binding boundary.
Files discovery alone can fall back to isolated defaults when config is broken so users can repair their authored configuration.
User-only views filter out project results, and package identity includes kind, ID, and scope.
Discovered availability, static declarations, and missing declared files are distinct from a session's loaded runtime.
Disabled or overridden portable packages may have incomplete static inventories because omp does not export a complete inventory reader.
`src/omp/discovery.ts` marks package-owned files; `src/settings.ts` excludes them both from Files and the server save allowlist, returning only packaged workflow bodies separately.
No package operation bypasses project-trust admission or sends a reload RPC.

See [Extensions usage](../usage/extensions.md) and the [operation queue decision](../decisions/2026-11-02-serialize-extension-changes-and-bound-script-approvals.md).
