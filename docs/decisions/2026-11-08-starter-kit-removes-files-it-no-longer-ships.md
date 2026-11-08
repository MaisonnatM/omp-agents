---
status: accepted
date: 2026-11-08
decision-makers: agent
---

# The starter kit installer removes the files it no longer ships when you never edited them

In the context of the starter kit's installer, facing files a kit change dropped that stayed in `~/.omp/agent` and kept loading in every session, we chose to remove a file that the install record or the kit's git history names, that the kit no longer ships, and whose content still matches the record or that history, over leaving every such file and over removing them whatever their content.
Dropped extensions stop loading after the next install or **Update dashboard**, accepting that an edited copy stays until you delete it, even with `--force`.

## Context

On 2026-11-08 `~/.omp/agent/extensions` still held `request-log.ts`, `replay-guard.ts`, and `replay/`, which the kit had dropped days before.
`request-log.ts` went on saving every model request on disk, and `replay-guard.ts` imported a module the dashboard had deleted.
The installer only added and updated files, so nothing took them away; [2026-11-03-starter-kit-updates-files-you-never-edited](2026-11-03-starter-kit-updates-files-you-never-edited.md) already tells an unedited kit file from an edited one.

## Options considered

- Leave every file the kit dropped: the old behavior, which kept dead code loading in sessions until someone noticed.
- Remove every file at a path the kit once shipped: loses a copy you edited, or a file of your own that took a dropped path.
- Remove only a dropped file whose content matches the record or a version in the kit's history, and keep an edited one even under `--force`: chosen, since `--force` exists to overwrite an edit with the kit's version, and a dropped file has no kit version to overwrite it with.

## Consequences

An install and `--files` print each dropped file as `remove` or `keep yours`, remove the unedited ones and the directories they leave empty, and drop their record entries.
A file under `maintainer/` counts as shipped even for an install without `--maintainer`, so a maintainer file is never removed for being outside the chosen layers.
The packaged app's kit has no git history, so there only the record names dropped files.

## Confirmation

`templates/omp/install.test.ts` checks that a dropped unedited file is removed and an edited one kept with and without `--force`, that a file `maintainer/` still ships stays, and that `--files` removes a recorded dropped file, its empty directory, and its record entry.

## Revisit when

Users report a file of theirs removed, or the kit starts shipping files that a session writes to after install.
