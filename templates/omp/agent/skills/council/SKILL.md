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

The council is three members, one strong model from each of three providers, at high reasoning effort.
Members the user names replace the defaults.
Otherwise use the latest flagship of each provider:

| Member | Model |
| --- | --- |
| Claude Opus | `anthropic/claude-opus-5-5:high` |
| GPT Sol | `openai-codex/gpt-6.1-sol:high` |
| Gemini Pro | `cursor/gemini-3.1-pro:high` |

Check `omp models --json` when a newer flagship may exist, and spawn the newest one.

## Spawn

Spawn the three members in one `task` call: one `tasks[]` item each, with `agent: "council"` and the member's exact selector in `model`.
Give every member the same assignment: the user's request, the goal behind it, and pointers to the context, such as the branch, the diff command, or the PR number.
For a review or feedback, write "read-only: report findings, edit nothing" into the assignment.
For a code review, ask each member for a score out of 10.

A per-call `model` needs `task.perCallModel: on`; omp refuses the call while it is `off`, its default.
A per-call member never falls back to another model: an unavailable model or an exhausted quota fails that member's spawn.
Report the failed member and its error, and run the council with the members that answered; never substitute another model for it.
`task.maxConcurrency` may hold the third member in a queue; wait for it.

## Rounds

Collect the members' replies, then summarize the useful findings, where the members disagree, and the recommended next steps.
Each full review pass is one round; a fresh review after fixes starts a new round.
When you agree with a recommendation, make the change, then spawn fresh members for the next round.
Continue until every member is satisfied.
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
| Gemini Pro | failed | failed |
```

When the work ends in an open pull request, put the table in its description with the `pr_description` tool, never in a comment.
Otherwise put it in the final reply.
