---
status: accepted
date: 2026-10-28
decision-makers: Maxence Maisonnat
---

# What's new reads a hand-written CHANGELOG.md

In the context of the header's What's new, facing a list built from commit subjects that people who don't code cannot read and that stays mostly empty, we chose one `CHANGELOG.md` written in everyday words, merged with git's union driver and required by the pre-push hook, over commit subjects and over a `Changelog:` trailer on each merge commit.
It lets anyone edit, backfill, and read the lines on GitHub, accepting that every change to `main` carries a file edit and that a union merge can repeat a day heading.

## Options considered

- Commit subjects, the status quo: no extra work, but the subjects are technical, and few start with `feat` or `Add `, so the list stays mostly empty.
- A `Changelog:` trailer on each merge commit: one per merge and never in conflict, but it cannot be edited or backfilled once pushed, and merges made on GitHub leave it out.
- One `CHANGELOG.md` with a union merge driver in `.gitattributes` and a pre-push check: editable, readable on GitHub, and backfilled for past changes; chosen.

## Consequences

Users read what changed in words they know, and the lines a build lacks show under **Not loaded yet** before they update.
Maintainers write a line for every push to `main`, tests and cleanup included, and the hook refuses the push until they do.
A union merge can leave a day heading twice or keep a line both sides edited in both forms; the reader merges the headings, and a doubled line needs a manual fix.

## Confirmation

`.githooks/pre-push` refuses a push to `main` whose commits leave `CHANGELOG.md` unchanged.
The changelog test in `src/server/self-update.test.ts` checks the lines What's new reads, merged headings and pending lines included.

## Revisit when

The choice is firm for pushes to `main` from a checkout, where the hook runs.
A pull request merged on GitHub skips the local hook, so reopen it when most changes reach `main` that way and the check needs to run in CI.
