---
name: decision-records
description: Keep a project's decision records, one file per choice in `docs/decisions/`. Use when you pick between viable options, when the user settles a choice, or before you change code or behavior a record may cover.
---

# Decision records

A decision record is one Markdown file that keeps one choice made in a project, with what was chosen, over which options, and why.
Records live in the repository beside the code they govern, so whoever changes that code next learns why it is the way it is.

## Find the records

Records live in `docs/decisions/` at the repository root.
If the repository already keeps them elsewhere, such as `docs/adr/` or `doc/adr/`, use that directory instead.

- List every title with `grep -m1 -H '^# ' docs/decisions/*.md`.
- List the choices an agent made alone with `grep -l '^decision-makers: agent' docs/decisions/*.md`.
- Find the records that cover an area by grepping the directory for its file names, symbols, and domain words.

## Read before you change

Before you change code or behavior, read every `accepted` record that covers it.
If your change goes against an `accepted` record, tell the user, then supersede the record in the same change, as [Change a decision](#change-a-decision) says.
A `rejected` record names an option someone already turned down.
Propose that option again only when the context the record describes has changed, and say what changed.

## Record each choice

Record a choice when both of these are true:

- You chose between two or more options that would each work.
- Someone who knows the code could reasonably have picked another one.

That covers a choice the user makes, such as an answer to a question you asked, a choice you make on your own, and an option the user turns down.
Skip a choice that a record, a repository convention, a linter, or the user's exact instruction already fixes.
Write one record per choice; a choice made in phases, such as a stopgap now and a redesign later, gets one record per phase.
Commit the record with the change it governs, so a revert removes both.

## Name the file

Name the file `YYYY-MM-DD-slug.md`, the day you made the choice followed by the title in lowercase words joined by hyphens, such as `2026-10-27-store-sessions-in-sqlite.md`.
Never number records.
Parallel branches each read the same highest number and take the same next one, and git merges the duplicates without a conflict; with a date and a slug, two branches can collide only by adding the same file name, which git refuses to merge.
Cite a record by its file name, without `.md`.
In a directory of numbered records, name new records by date and leave the old numbers as they are.

## Write the record

Every record starts with this short form:

```markdown
---
status: accepted
date: 2026-10-27
decision-makers: agent
---

# Store sessions in SQLite

In the context of the session list, facing reads that scan every session file on each start, we chose SQLite over one JSON file and over the existing per-session files, to load the list in one query, accepting a native dependency and a schema to migrate.
```

The frontmatter holds these fields:

- `status`: one of `proposed`, `accepted`, `rejected`, `deprecated`, or `superseded`.
  `proposed` waits on someone in `decision-makers`; `accepted` is in force; `rejected` keeps a turned-down option from coming back; `deprecated` no longer applies and has no replacement; `superseded` names its replacement in `superseded-by`.
- `date`: the day the choice was made, the same date the file name starts with.
- `decision-makers`: who chose.
  Write the user's name when the user chose or approved the choice, and `agent` when you chose alone.
- `supersedes`: the file names of the records this one replaces, when it replaces any.
- `superseded-by`: the file name of the record that replaced this one, set only when `status` is `superseded`.

The title states the choice, not the topic: "Store sessions in SQLite", not "Session storage".
The paragraph under the title is a Y-statement with six parts: the context, the concern it faces, the option chosen, the options rejected, the benefit, and the cost accepted.
Split it into two or three sentences when it runs long, but keep all six parts.

Add these sections after the paragraph when the choice is hard to reverse, changes what users see, or the user debated it:

- `## Context`: the facts and the forces in tension, written so they favor no option.
- `## Options considered`: each option with what it offers and why it lost.
  Name at least two real options, and never invent one to fill the section.
- `## Consequences`: what gets better, what gets worse, and who notices, such as users, maintainers, or operators.
- `## Confirmation`: the test, lint, or review that shows the code follows the choice.
- `## Revisit when`: how confident the choice is, and the change in context that should reopen it.

Write to a developer who joins the project a year from now, in full sentences.
Derive the criteria from the problem, not from the features of the option you prefer.
Name the costs; every choice has one.
Keep the record to one screen, and link a design doc instead of copying it.

## Change a decision

Once a record is `accepted`, change only its `status` and `superseded-by` fields, a broken link, or a typo.
The history of what was decided, and for how long, is the point of the record.

To change a decision:

1. Write a new record whose `supersedes` names the old one and whose context says what changed.
2. In the old record, set `status: superseded` and `superseded-by` to the new record's file name.
3. Commit both records with the code change.

When the code a record covers is deleted with no replacement, set the record's `status` to `deprecated`.

## Check the records

After you add or change a record, run `bun check.ts <directory>`, with `check.ts` from this skill's directory and the records directory, which defaults to `docs/decisions`.
It lists each file name, frontmatter field, and `supersedes` link that breaks these rules, and exits with code 1 when it finds any.
