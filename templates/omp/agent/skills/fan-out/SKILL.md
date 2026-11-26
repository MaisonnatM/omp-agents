---
name: fan-out
description: Use before spawning more than one subagent, to size the fan-out by the question it answers.
---

# Fan-out

Size a fan-out by the question it answers, not by the amount of work:

- A lookup, such as where a symbol is used or what a doc says: one agent, or none when a read or search answers it, since a second agent returns the same answer.
- A comparison of two to four options, such as designs, libraries, or suspected causes: one agent per option, two to four in all, since each reports on its option without the others' framing.
- An arena, several runners given the same task and a judge that picks the base: only for a decision that is costly to reverse, such as a schema, a public interface, or a large rewrite, since it multiplies the cost by the number of runners.

Independent slices of one change, each on its own files, run in parallel whatever their number, as `skill://git-worktrees` says.
