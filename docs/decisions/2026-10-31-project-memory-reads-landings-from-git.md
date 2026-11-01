---
status: accepted
date: 2026-10-31
decision-makers: agent
---

# Project memory reads landings from git

In the context of the brief and the catch-ups that tell a session what other sessions landed, facing merges made by sessions, by people, and on GitHub, we chose to read the target branch's first-parent commits and their `Omp-Session` trailers from git at each prompt over recording each landing when a session merges and over scanning every branch for new work.
Every landing shows, whoever made it, and nothing can fall out of step with git, accepting that a landing made without the trailer names no session and that a landing only on the remote shows after the user fetches, since the extension never fetches.

## Options considered

- Record a landing when a session merges: misses merges made by hand or on GitHub, and needs a store that can disagree with git.
- Scan `git log --branches` for other sessions' new commits: reports unfinished work and costs more with each branch.
- Read first-parent commits of the target and the trailers of what each merge brought in: chosen.

## Consequences

- `extensions/session-trailer.ts` is what links a landing to a session, so the two extensions belong together.
- The intent each session records at its first prompt is the one thing kept outside git, under `<common dir>/omp-project-memory/intents/`, and never pruned.

## Confirmation

`templates/omp/project-memory.test.ts` merges branches whose commits carry other sessions' trailers and checks the brief and the catch-up name those sessions and their intents.
