---
status: accepted
date: 2026-11-03
decision-makers: Maxence Maisonnat
---

# The starter kit installer replaces files you never edited, and Update dashboard runs it

In the context of the starter kit's installer, facing landed kit fixes that never reached `~/.omp/agent` because any installed file that differed from the kit counted as yours, we chose to replace a file whose content matches the last install's record or a version in the kit's git history, and to run that file update from **Update dashboard**, over always keeping a differing file and over overwriting every file.
Kit fixes reach sessions after the next update, accepting that a file you set back to an old kit version by hand counts as unedited.

## Context

On 2026-11-03 six sessions hit a `/ship` gate fixed the day before, because `~/.omp/agent/extensions/ship.ts` was an older, unedited kit version that `bun run omp-template` listed as `keep yours`.
The installed shell command parser, worktree guard, and review workflow doc were the same, while the installed `AGENTS.md`, model routing doc, and git workflow doc held real local edits.

## Options considered

- Keep every differing file unless `--force`: the old behavior, which left stale copies in place and made `--force` clobber the edited ones.
- Overwrite every file: loses local edits.
- Record each installed file's git blob id in `starter-kit-installed.json`, and fall back to the kit's git history for copies installed before the record: chosen.

## Consequences

An install writes the record; `--files` updates only files and needs that record, so the first update after this change still needs one `bun run omp-template`.
The packaged app's kit has no git history, so there only the record tells an unedited file apart.
Settings still keep any value that differs, since omp's settings are not recorded.

## Confirmation

`templates/omp/install.test.ts` checks an outdated unedited file is replaced and an edited one kept, through the record and the git history, and that `--files` adds back no deleted file; `src/server/self-update.test.ts` checks an update runs the kit step before restarting.

## Revisit when

A kit setting goes stale the same way, or users report an edit replaced.
