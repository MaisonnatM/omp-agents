---
status: accepted
date: 2026-11-26
decision-makers: Maxence Maisonnat
---

# Context files keep only undiscoverable, global lines

In the context of `AGENTS.md` and `APPEND_SYSTEM.md`, which load into every main request, facing about 6,000 tokens of rules most sessions never use, we chose to keep only lines an agent cannot find in the code or a tool description and needs in every session, over keeping per-task rules inline, accepting that a per-task rule now depends on its skill's description triggering the read.

## Options considered

- Keep every rule inline: each session pays for design, review, and subagent rules it rarely uses.
- Move per-task rules into the doc `AGENTS.md` links to, as the 2026-11-08 token audit proposed: still a pointer line per doc in every request.
- Keep only undiscoverable, global lines and move the rest into skills, whose descriptions already trigger them (chosen).

## Consequences

- `APPEND_SYSTEM.md` keeps the reply format, the Suggestions block, asking rules, and a one-line `# Starting /ship yourself` section, which `2026-11-02-agents-start-ship-themselves-and-ship-without-a-ticket` requires before any skill is read.
- `ship` holds "When ship starts" and "Before any pull request"; `design-workflow` holds variant rules and UI handoff; `git-worktrees`, `fan-out`, and `model-routing` are new.
- Pointer lines to skills whose descriptions already trigger them, and rules tool descriptions already state, are gone.
