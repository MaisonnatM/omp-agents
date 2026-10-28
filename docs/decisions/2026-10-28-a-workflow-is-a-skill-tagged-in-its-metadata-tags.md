---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# A workflow is a skill tagged in its metadata tags

In the context of Settings › Workflows, facing the need to tell which omp skills are multi-step workflows such as `/ship`, we chose a `workflow` entry in the comma- or space-separated string `metadata.tags` of a skill's frontmatter, over a top-level `tags:` list and over a separate workflow file kind, so the same `SKILL.md` loads in every way omp reads skills, accepting a tag that hides one level down and a string that is split by hand.

## Context

omp keeps every frontmatter key of a skill the user writes (`SkillFrontmatter` in `pi-coding-agent/src/capability/skill.ts`).
A skill from a plugin or a skillshare pack goes through `validateAgentSkillFrontmatter` in `pi-coding-agent/src/discovery/agent-plugin-format.ts` instead, which refuses any top-level key but `name`, `description`, `license`, `allowed-tools`, `metadata`, and `compatibility`, and any `metadata` value that is not a string.
A workflow written for one user is likely to be shared later through those channels.
`/ship` must stay a slash command, since `src/task-claims.ts` reads the issue from `/ship <id>` and the ship extension names it.

## Options considered

- A top-level `tags: [workflow]` list: the most natural YAML, but a plugin or a skillshare pack carrying that skill fails to load.
- A new workflow file kind, such as `workflows/<name>.md`: no tag to learn, but omp does not discover it, so it would need its own loader and could not be started as `/skill:<name>`.
- `metadata.tags` as a string, split on commas and spaces: loads everywhere omp loads skills; chosen.

## Consequences

Users tag a skill with two lines, `metadata:` and `  tags: workflow`, which the empty Workflows section shows.
A skill with only a top-level `tags:` key is not listed, which can surprise someone who guessed the format.
The `/ship` procedure moved into `templates/omp/agent/skills/ship/SKILL.md`, and `commands/ship.md` only tells the session to follow that skill, so editing the workflow in Settings changes what `/ship` does.
A workflow pairs with the command named after it, the project's before the user's; a workflow without one starts as `/skill:<name>`.

## Confirmation

`src/omp/workflows.test.ts` checks that a tag in a comma list matches, that a skill without the tag or with a top-level `tags:` key is left out, and that a workflow pairs with the command omp names the same, the project's before the user's.

## Revisit when

Confident while omp's plugin validator keeps `metadata` to string values; reopen if omp adds a first-class tag or kind for skills.
