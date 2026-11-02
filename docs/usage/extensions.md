# Extensions

Open **Settings › Extensions** to manage packages with omp's own installers.
The workspace picker previews that workspace's discovery; **All** shows user packages and user sources only.
A workspace selection does not make npm or linked packages project-scoped: those are user installs in omp.

## Installed

Select a package to see its scope, version, requested range, source, location, and contributions.
User and project marketplace copies remain separate, including a user copy overridden by the project.
A missing store or an incomplete inventory is a warning, not evidence that a package contributes nothing.
Contribution files open read-only.
Packaged workflows remain in **Workflows**, with a source label and **Manage package** instead of an editor; authored workflows remain editable.
**Files** cannot save into a package, but includes an existing project `plugin-overrides.json`.

**Install package** accepts npm/git package specifications, local links, marketplace plugin names, and registry skill specifications.
Review the target directory, scope, specification, and code-execution warning before confirming.
Registry installations with scripts pause on a separate approval naming the exact package version and files; declining never approves execution.
An unanswered script request expires after ten minutes.
A package approval never grants project trust.
**Update from source** uses omp's native semantics: saved registry ranges, a marketplace's cached catalog, or the npm/git package's source.
Linked packages do not have a fabricated registry update candidate.
Enable/disable and uninstall operate on the selected package copy; uninstall leaves other scopes alone.
Registry skills have no package enable switch in omp: open a contribution to disable its skill name globally, after reviewing every matching path.
Project configuration can still override global discovery settings.

## Discover, Loaded items, and Sources

**Discover** reads cached marketplace catalogs only when requested.
Choose **Skill registry** and press **Search registry** to make a remote search, using the selected workspace's effective registry URL and native pagination.
A remote result without an inventory says that contribution details require installation.
**Loaded items** is a workspace discovery preview, not a running session's loaded set.
It lists provenance, invocation, and available/disabled/shadowed state, with separate global provider switches and foreign user-source opt-ins.
**Sources** adds, refreshes, and removes marketplaces, showing their last refresh; removing a source keeps installed packages.
It also shows the effective skill registry and edits only its global URL, preserving a workspace override.
Get started remains the starter kit's setup path; Extensions manages its packages like other packages.

Changes affect files on disk and new sessions; they do not reload running sessions.
omp's `/reload-plugins` refreshes skills and commands only, not task discovery or MCP connections.
A full live reload is not offered here.
