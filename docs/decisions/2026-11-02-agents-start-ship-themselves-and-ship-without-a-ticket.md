---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat
---

# Agents start /ship themselves, and /ship runs without a Linear ticket

In the context of the starter kit's `/ship` workflow, facing most PR-bound work running without it because the user does not type `/ship` and not every change starts from a ticket, we chose an `APPEND_SYSTEM.md` rule that has the agent start the workflow itself for a request that will end in a pull request and say so in its first reply, and a Ticket step that links a named or clearly matching Linear issue and otherwise passes without one, over asking before each start, adopting sessions only when they open a PR, and creating a ticket from the prompt.
It puts the plan and the review gates on the work the user already ships through PRs, accepting that an agent may start the workflow on a request the user meant to keep light, which "no ship" stops.

## Context

32 of the 1008 session files under `~/.omp/agent/sessions` recorded an `omp-ship.state` entry; the rest never ran `/ship`, so their PRs skipped the plan and the review gates and their sessions show no Ship card.
The Ticket step created a Linear issue whenever the user named none, so starting `/ship` on untracked work filled Linear with tickets nobody planned.
The user chose both options below.

## Options considered

- The agent starts `/ship` and says so: no extra question, and the user opts out with "no ship": chosen.
- The agent asks before it starts: the user keeps control, at one more question per coding session.
- The extension adopts a session when it runs `gh pr create` or `gt submit`: never misses a PR, but the work arrives at the reviews with no ticket or plan stage.
- A Ship button in the session header: still manual, one click instead of a command.
- For the ticket, keep creating one from the prompt, or ask each time; both add Linear noise or friction for small work.

## Consequences

Without an issue, the plan goes under `## Plan` in the PR body instead of a Linear comment, and the PR's title and body carry no `Fixes <ID>`.
The ticket step still shows as done on the Ship card and widget; the widget's title line says "(no ticket)" once past it.
A repository that merges locally without pull requests, such as omp-agents, never starts `/ship` on its own, because the stages after Implement assume a PR.
The rule lives in the kit's `APPEND_SYSTEM.md`, so installed copies change only after `bun run omp-template`.

## Confirmation

`templates/omp/agent/APPEND_SYSTEM.md` has the `# Shipping without /ship` section, and step 1 of `templates/omp/agent/skills/ship/SKILL.md` creates an issue only when the user asks for one.

## Revisit when

Agents start `/ship` on requests the user then stops with "no ship" often enough that asking first costs less, or the user wants every shipped change tracked in Linear.
