# Approval and shipping

Read this for approval-token ambiguity, branch or PR work, rebasing, or submission.
Mma overlays win over Poteto Shipping and GitHub transport defaults unless the user explicitly overrides them.
On omp, read `~/.omp/agent/docs/git-workflow.md`; on Cursor, read `~/.cursor/rules/graphite-cli.mdc`.

## Approval tokens

| Token | Meaning |
| --- | --- |
| **go** / **continue** / **yes go** | Implement approved scope |
| **go on** + ticket URL | Investigate, fix, prove, commit, open a draft PR with `gt submit --draft`; ready-for-review still needs **push** |
| **create a draft pr** | Commit relevant changes, then `gt submit --draft`; if blocked, list missing access or proof in the PR body |
| **go all** / **go all don't commit** | Execute everything in scope; **don't commit** means zero git writes, with staging only if needed |
| **fix all** / **fix all don't commit** | Same as go all for review-comment batches |
| **go all then push** / **fix all then push** | Implement first; push or submit only on the explicit second ask |
| **all in one PR** | Overrides slicing, including an attached plan; scope is still bounded by evidence |
| **push** / **gt submit** | Explicit ready-for-review publication, not bundled with go unless requested in one phrase |

## Workflow

Foundation PR goes on trunk, then one reviewable PR per slice.
Restack after parent merges and unstack so approved PRs can merge alone.
**All in one PR** overrides slicing.

For PR creation, use the repo `.agents/skills/pr/SKILL.md`; Cursor may also use `.cursor/commands/pr.md`.
A Linear `ENG-*` URL supplies the ticket slug for the branch name.
Split unrelated staged work onto a separate branch off main.
Poteto Opening a PR applies, with Graphite as the transport.

Create the draft before publishing.
Apply thermonuclear findings, commit and push the fixes, then add the review checkbox according to `~/.omp/agent/docs/review-workflow.md`.
Present stack state before ready-for-review submission unless the user already approved publication.
Commits require a user request; a draft PR request or **go on** + ticket URL counts.
Amend only when the user's commit rules allow it.
Before commit, draft PR, push, or ready, apply the cleanup route in `skill://poteto-mode` on omp, or `deslop` on Cursor, and `no-comments` before review.

A terse rebase request means inspect state, `gt restack`, resolve conflicts, continue, and verify.
Stop before force-pushing and name the next step.
Before merge, apply thermonuclear and best-in-class reviews when invoked or stacked, then implement after approval.
Use these on code and settled designs, not theoretical risks in abstract plans.
A dedicated simplification request routes to `lean-code-simplification-review`.

## Autonomy

Reversible reads, local investigation, prototypes, draft plans, stack inspection, comment drafts, and tests proceed without asking.
Pause on shared-branch force-push, deploys, data deletion, customer-facing messages, GitHub replies to humans, unapproved push or submit, and implementation before go.
**Don't commit** remains binding.
Full-autonomy grants keep the run going under Poteto Autonomous run and show-me-your-work, while retaining explicit operator gates and the ban on human GitHub replies unless overridden.
Push back when scope does not earn its place, pursue the better path unless the user insists, and re-aim immediately on a short correction.
A clear best option or a prototype that can decide does not need a preference question.
