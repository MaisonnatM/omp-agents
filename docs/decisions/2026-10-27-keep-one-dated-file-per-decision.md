---
status: accepted
date: 2026-10-27
decision-makers: Maxence Maisonnat
---

# Keep one dated file per decision

In the context of agents that make most of this repository's choices in parallel worktrees, facing a single `decisions.md` that each entry edits in place, we chose one immutable file per decision named `YYYY-MM-DD-slug.md` over the single file and over numbered files, to keep every choice and its replacement in history without merge races, accepting more files and records that never get shorter.

## Context

The single `decisions.md` that came before this directory held about twenty entries, and its header asked a pull request that reopens a decision to edit the entry.
An edit in place erases what was decided before and when, which is what a later reader needs when a choice looks wrong.
Agents now make most of the choices, often in several worktrees at once, and the user asked that every choice with a viable alternative be recorded, not only architecture.
That rate of records makes one shared file a merge conflict on every pull request that touches it.

## Options considered

- One shared file, edited in place: one read shows every choice, but each record conflicts with every other branch that adds one, and an edit loses the old choice.
- One file per decision, numbered `0001-slug.md`, as Nygard's and MADR's templates do: parallel branches read the same highest number and add duplicates that git merges without a conflict, as [mattpocock/skills#799](https://github.com/mattpocock/skills/issues/799) reports for four parallel agents.
- One file per decision, named by date and slug, as [log4brains](https://github.com/thomvaill/log4brains) does: chosen, since two branches collide only by adding the same name, which git refuses to merge.

## Consequences

- A choice changes by a new record that supersedes the old one, so the history of a choice reads as a chain of files.
- The directory listing is the index; no file lists the records, so no two branches conflict over one.
- Reading every decision takes a directory read instead of one file.
- `src/docs.test.ts` runs the `decision-records` skill's `check.ts` on this directory, so a broken name, field, or supersede link fails `bun test`.

## Confirmation

`bun test src/docs.test.ts` checks every record's file name, frontmatter, title, and supersede links.

## Revisit when

The records outgrow a directory listing, or omp gains its own store of decisions that agents read without a skill.
