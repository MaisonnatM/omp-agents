# Implementation

Read this when implementing or executing a settled plan.
The approval and transport rules remain in the entry skill and [shipping.md](shipping.md).

## Design and execution

Research and prove the design with prototypes or `architect` before an execution plan.
Use an indirect prompt on noisy threads and `how`, `why`, `teach`, or `recall` to build a shared mental model.
For shared surfaces, use readme-driven `technical-writing`.
Do not lead the investigation with untested hypotheses or adversarially review abstract plans instead of prototyping.

After design is settled, use Poteto multi-phase-plan, an attached plan, or repo writing-plans.
Every task ends in runtime proof for the console and behavior tests for logic.
Execute attached plans verbatim without editing the plan file, drive existing todos, and preserve human-added items.
Prefer deleting spent plan files after the program lands so the repo does not accumulate stale intent.

## Code discipline

- Follow `.agents/skills/implementation-guidelines/SKILL.md` for surgical diffs, subject to the best-in-class bar.
  Apply Poteto Laziness Protocol and Subtract Before You Add when their leaves are read.
- For a lint ratchet such as file size or ESLint, use the minimum fix, usually an allowlist bump.
  A structural split needs an explicit request.
- Fix the canonical layer rather than adding a wrapper patch.
  Name a better structural alternative when the obvious fix is hacky, and pursue it after approval.
- Use backend-exported enums and types on the frontend.
  API values, limits, prefixes, and constants come from the backend when generated types exist.
- Removing UI-only behavior also removes backend code used only there.
- Refactors use one native path, without legacy shims unless required.
  Handle IPA events in place rather than converting to an old model.
- Before deleting skills, rules, commands, or config, prove which harness loads them and count real uses in transcripts.
  Delete the full confirmed scope, including references.
- Preserve existing columns, fields, headers, ordering, and detail-view parity unless the user asks otherwise.
- Implement only the current PR slice unless the user says **all in one PR**.
- Keep prompt and user-facing output free of formatting leaks such as `**Summary:**` and AI-slop comments.
- Comments retain only a non-obvious why; verification scripts do not narrate phases.
- Read the smallest range that answers the question and search generated types or large assets by symbol.
  Reuse already-read material; re-read when it changed or compaction removed it.
- Read frontend-patterns once per implementation context.
  Delegate large frontend work so its full skill text stays out of the parent context.

Large artifacts and compaction follow [context.md](context.md).
