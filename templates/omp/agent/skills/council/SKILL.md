---
name: council
description: Use when the user says "council": three models from three providers review or advise on the request.
---

# Council

Adapted for omp from [tstack's council](https://github.com/t3dotgg/tstack/blob/main/skills/council/SKILL.md).

## Before the council

Address outstanding PR comments, fix known issues, and run the relevant checks, so the council sees the updated work.
When the user wants to discard the implementation and explore new ideas, skip fixes to code being replaced.

## Members

The council is three members, one strong model from each of three providers, at high reasoning effort:

| Member | Model |
| --- | --- |
| Claude Opus | `anthropic/claude-opus-5-5:high` |
| GPT Sol | `openai-codex/gpt-6.1-sol:high` |
| Gemini Pro | `cursor/gemini-3.1-pro:high` |

Members the user names replace these.
omp runs a member only on a model that both the `model` list in `~/.omp/agent/agents/council.md` and `task.perCallModelAllow` in `~/.omp/agent/config.yml` name; a glob grants nothing.
Before spawning a named member outside them, and with the user's go, add `provider/model-id:high` to the agent's `model` list and `provider/model-id`, without the level, to `task.perCallModelAllow`.

## Spawn

Spawn the members in one `task` call: one `tasks[]` item each, with `agent: "council"` and the member's exact selector in `model`.
Give every member the same assignment: the user's request, the goal behind it, and pointers to the context, such as the branch, the diff command, or the PR number.
For a review or feedback, write "read-only: report findings, edit nothing" into the assignment.
For a code review, ask each member for a score out of 10.

omp checks every member's model before the call runs, and refuses the whole call when one is unknown, unapproved, or on a provider that is not signed in.
The refusal names that member's model: report the member, then spawn the others again without it.
A member whose model runs out of quota or loses its sign-in mid-run fails alone, and never falls back to another model.
Report each failed member with its error, and continue with the members that answered; never substitute another model.

## Rounds

Collect the members' replies, then summarize the useful findings, where the members disagree, and the recommended next steps.
Each full review pass is one round.
When you agree with a recommendation, make the change, then spawn fresh members for the next round.
Their assignment carries the previous round's findings, what changed, and each declined finding with its reason.
Continue until every member that ran is satisfied.
Keep the scope fixed across rounds: decline each finding outside the original request, and say why.

## Results

Record the rounds in this table, with `no score` for a member that gave none and `failed` for one that did not run:

```markdown
## Council review

Rounds: 2

| Member | Round 1 | Round 2 |
| --- | --- | --- |
| Claude Opus | 7/10 | 9/10 |
| GPT Sol | 8/10 | 10/10 |
| Gemini Pro | 7/10 | 9/10 |
```

When the work ends in a pull request, put the table in its description with the `pr_description` tool, above any closing footer line, never in a comment; a PR opened after the council gets it when it opens.
Otherwise put it in the final reply.
