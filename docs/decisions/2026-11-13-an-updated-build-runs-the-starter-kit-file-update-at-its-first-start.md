---
status: accepted
date: 2026-11-13
decision-makers: agent
supersedes: 2026-11-03-starter-kit-updates-files-you-never-edited
---

# An updated build runs the starter kit file update at its first start

In the context of the starter kit installer that replaces files you never edited, facing an update that the desktop shell can now roll back when its build does not start, we chose to run `install.ts --files` in the background once the build an update moved to first listens, over running it before the restart as before.
A rolled-back update leaves `~/.omp/agent` as the build that runs left it, accepting that new sessions get the landed kit a few seconds later, after the restart.
The rule for which files the installer replaces is unchanged: a file whose git blob id matches the last install's record or a version in the kit's git history.

## Context

The record this replaces ran the kit step before the restart, while the old build still ran.
With rollback, the kit files a broken build installed would stay behind after the checkout went back.

## Confirmation

`templates/omp/install.test.ts` still checks which files the installer replaces; `src/server/self-update.test.ts` checks an update installs no kit files before restarting, the new build's first start does, and a later start does not.
