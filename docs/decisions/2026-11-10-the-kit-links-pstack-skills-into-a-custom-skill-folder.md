---
status: accepted
date: 2026-11-10
decision-makers: Maxence Maisonnat
---

# The kit links pstack's skills into a custom skill folder

In the context of the starter kit, which installs pstack for `/ship` and poteto mode, facing omp 18.18.6 skipping 57 of pstack's 58 skills because pstack's `plugin.json` opts into the Agent Plugins schema, whose closed skill frontmatter refuses `disable-model-invocation`, we chose a kit extension that links each installed pstack skill into `~/.omp/plugins/pstack-skills`, which the kit config lists under `skills.customDirectories`, over rewriting the plugin cache's frontmatter and over copying pstack's skills into the agent directory.
We chose it so a fresh install loads every pstack skill hidden from the model's skill list, as pstack intends, and follows each marketplace update, accepting a folder of links omp does not own and a session after an update that finds the new skills only through a `skill://` lookup.

## Context

A fresh install's `/ship` stopped at its plan step, which reads `skill://arena` and `skill://technical-writing`, and poteto mode could not open its principles.
Maxence's own machine worked only through a script that stripped the cache's frontmatter, a `skills.manualSkills` list that hid the stripped skills again, and a copy of pstack's skills from October that newer pstack versions no longer replaced.

## Options considered

- Rewrite the cache's frontmatter: omp loads the plugin as it ships, but the skills lose their hidden flag, so `skills.manualSkills` must list every pstack skill by name and misses each skill a later pstack adds.
- Copy pstack's skills into the agent directory: no omp internals involved, but the copies go stale at the next pstack release, which is what happened on Maxence's machine.
- Link the skills into a custom skill folder: omp's custom-folder scan reads `disable-model-invocation` as hidden and leaves the cache untouched, but the links must follow updates, which the extension does at each session start.

## Consequences

A custom-folder skill takes its bare name from a skill of the same name in the user's folders, which omp keeps under a prefixed name such as `agent/how`, so stale copies stop shadowing pstack.
The link folder leaves out pstack's `poteto-mode`, so the kit's alias of that name, which maps pstack's Cursor routes to omp, keeps it.
The kit ships its own `poteto-agent` and `poteto-agent-codex`, since pstack's `poteto-agent` looks for its skill under Cursor's paths.
omp discovers skills before it loads extensions, so the first session after an update lists the new version's skills only once a `skill://` read misses and rediscovers them; they are hidden, so the model's skill list is unchanged.

## Revisit when

omp accepts `disable-model-invocation` in plugin skills, or pstack drops the key or the strict schema; the extension and the config entry can then go.
