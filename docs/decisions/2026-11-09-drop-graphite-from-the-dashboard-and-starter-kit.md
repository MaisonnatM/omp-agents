---
status: accepted
date: 2026-11-09
decision-makers: Maxence Maisonnat
supersedes: 2026-10-20-plain-git-not-graphite-for-this-repository
---

# Drop Graphite from the dashboard and the starter kit

In the context of a maintainer who stopped using Graphite in every repository, facing Graphite support spread across the dashboard, the ship gate, the worktree guard, and the agent instructions, we chose to remove it everywhere over keeping the dashboard features idle or keeping the instructions behind a "when Graphite is configured" check, so that agents and readers meet one way to ship, plain `git` and `gh`, accepting that a user who still runs `gt` loses the Graphite sign-in, the Open on Graphite links, and the PR links a `gt submit` made.

## Context

The maintainer uninstalled `gt` and removed Graphite's metadata from his repositories.
The 2026-10-20 record made omp-agents the one repository that never used Graphite; with Graphite gone everywhere, that exception has nothing left to except.

## Options considered

- Remove Graphite from the system, the agent instructions, the starter kit, and the dashboard: chosen.
- Remove it from the system and the instructions, and keep the dashboard features, which do nothing without `gt`: leaves code and a Settings row no one exercises.
- Remove it from the system and the live agent files only: the next **Update dashboard** restores the kit's Graphite instructions.

## Consequences

Sessions open drafts with `gh pr create --draft` and publish with `gh pr ready`, and the ship gate checks only those.
A stack is a chain of pull requests by base branch, which the dashboard still reads and merges through `gh`.
Graphite links in conversations show as ordinary links.
