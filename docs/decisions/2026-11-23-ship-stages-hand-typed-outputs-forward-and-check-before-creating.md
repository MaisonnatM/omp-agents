---
status: accepted
date: 2026-11-23
decision-makers: Maxence Maisonnat
---

# /ship stages hand typed outputs forward and check before creating

In the context of the starter kit's `/ship` workflow, facing stages that end without saying what they produced and resumed runs that open a second PR, Linear link, or Slack post, we chose an `output` argument on `ship_stage`, keyed by the stage it finishes and kept in the ship state and the trace, and check-before-create for the side effects, over a separate state file per stage and over instructions alone.
Advancing to a stage needs the output of the stage before it; `draft_pr` reuses the branch's open PR; a Slack post or Linear link is recorded with `posted`, and recording it again is a no-op.

## Context

The plan stage already hands its contract forward through `ship_stage`, and the trace already records each call.
Later stages handed nothing forward, so a resumed run could not tell which checks ran, which PR it opened, or how each review finding ended.
GitHub refuses a second PR for one branch only after the agent tries, and nothing stopped a second Slack post or Linear link.

## Options considered

- Instructions alone: the skill already said to reuse an existing PR.
- A state file per stage beside the trace: a second record of what the ship state already holds.
- An `output` argument checked with the zod schemas `ship_stage` already uses, kept in the ship state and the trace, plus a `posts` list: chosen.

## Consequences

The output belongs to the stage being left, so a call advancing several stages at once, as on a resumed run, passes each output it needs, keyed by stage.
Only advancing needs the output; recording the current stage again, an earlier one, or live work does not, so a run recorded before this change resumes once it passes the next output.
The ready gate's output goes with the `ready_gate` call, since `gh pr ready` records `live` and carries no argument; the `tool_call` gate blocks `gh pr ready` until it is recorded.
`draft_pr` looks only for an open PR whose head is the current branch, and treats a failed `gh pr list` as no PR, so the agent's `gh pr create` stays the fallback.
Whether a Linear issue already links the PR is read by the agent with `get_issue`, since the extension does not call Linear.

## Confirmation

`templates/omp/ship-outputs.test.ts` tests the refusals, the reused PR, and the no-op second post.

## Revisit when

Agents fill outputs with placeholder text to pass the gate, or a stage needs an output the next stage cannot check.
