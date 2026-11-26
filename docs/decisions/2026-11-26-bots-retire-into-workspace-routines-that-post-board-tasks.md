---
status: accepted
date: 2026-11-26
decision-makers: Maxence Maisonnat
supersedes:
  - 2026-10-27-a-bots-routines-show-as-one-card-of-rows-that-open-in-place
  - 2026-10-28-a-bot-edits-its-own-routines-through-an-inbox
  - 2026-10-28-a-routine-run-shows-as-a-card-in-its-bots-conversation
  - 2026-11-04-bots-end-routine-runs-quietly-with-a-tool
  - 2026-11-09-settings-sync-carries-each-bots-routines-to-run-on-one-machine
---

# Bots retire into Workspace routines that post Board tasks

In the context of Bots, long-lived conversations that held a job, a memory, and the routines that ran in them, facing a second concept beside the Board that also turns a message into a session's work, we chose to delete Bots and make each routine belong to one Workspace, whose run posts a Board task there, over a long-lived conversation per Workspace and over a session the user marks as a Workspace's main one.
Each run gets a fresh session on the Board's normal path, with its worktree, branch, and **Merge on main**, accepting a worktree per run and prompts that carry their old Bot's whole job.

## Context

17 Bots held 25 routines; 13 of those Bots worked in `~/code`, across repositories, and their jobs ran to 6,500 characters that the routine prompts leaned on.
The Board already starts a session on each ready Board task in a Workspace, wakes it on a reply, and lands its branch.

## Options considered

- A long-lived conversation per Workspace that every run posts into: one context for about 20 runs a day plus the user's own messages, which compacts often and lets runs read each other's output.
- A session the user marks as a Workspace's main one: runs have nowhere to go until one is picked.
- A Board task per run in the routine's Workspace: chosen.
- Keep Bots as a hidden runtime behind routines: keeps the whole Bot code for no visible concept.

## Consequences

- A run posts a Board task titled with the routine's name, authored by the routine; while that routine's last Board task is not done, a run replies on it instead, which wakes its session.
- A run that finds nothing marks its Board task done quietly, with one line, and raises no notice; `stay_quiet` goes.
- A command routine runs in its Workspace and posts its report as a Board task only when its `post` rule allows.
- Every dashboard session gets `save_routine` and `delete_routine`, limited to its own Workspace's routines.
- The migration folds each Bot's job and memory into its routines' prompts, gives each routine its Bot's directory as its Workspace, and renames `bots.json` to `bots.json.migrated`; Bot conversations stay as past sessions.
- A Routines tab in each Workspace replaces the Bots tab; the Bots gallery, Bot types, the Bot designer, the PR shepherd, and Bot messages go.

## Revisit when

Runs of one routine need what an earlier run learned beyond what its Board thread holds, or the worktree per run costs more than the work it does.
