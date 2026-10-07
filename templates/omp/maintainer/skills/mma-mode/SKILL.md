---
name: mma-mode
description: >-
  mma's agent style: poteto-mode principles and playbooks, then mma overlays
  (go gate, Graphite, Yampa verify, best-in-class bar, no GitHub replies to
  humans). Use for mma, maxence, /mma-mode, /skill:mma-mode, or requests to
  work in this style.
disable-model-invocation: true
---

# mma mode

Read only the task-matched references in [On demand](#on-demand).
They hold the routing, implementation, shipping, verification, and resume details.

## Harness notes

In omp, read named skills through `skill://<name>`; invoke them with `/skill:<name>`.
Use `skill://poteto-mode` as the poteto entry point and its named playbook URIs.
If a personal skill is not discovered, check its exact path under `~/.omp/agent/skills/` or `~/.agents/skills/`.
If neither has it, use its exact `~/.cursor/skills/<name>/SKILL.md` path only after checking that the file exists.
In Cursor, use `/name`, personal skills under `~/.cursor/skills/`, and the named Cursor rules or commands.
The omp routes in `poteto-mode` override inherited Cursor-only `deslop`, `control-ui`, and `control-cli` directives.
For thermonuclear reviews in omp, follow `~/.omp/agent/docs/review-workflow.md` and use `thermonuclear-reviewer`.

## Apply poteto first

mma-mode includes poteto. Do not treat poteto as optional for nontrivial work.

1. **Resolve poteto** with `skill://poteto-mode` in omp.
   Pass `skill://poteto-mode` to the `poteto-agent` so it reads the omp routes, full mode, and Principles index; keep the parent on the matched playbook.
   When implementing inline, read the full mode once; casual turns need only the overlays below.
2. **Match a playbook.** Copy its steps into the todo list verbatim. No fit means
   **figure-it-out**. A multi-day program means poteto **Orchestrate**.
3. **Cite principles** you actually read this session.
4. **Delegate** playbook code work to the `poteto-agent` subagent.
5. **Then apply mma overlays.** Overlays win on conflict (Graphite, go gate,
   commits, GitHub voice, Yampa proof, human todos).

## Non-negotiables

- English, concise. No preamble, no engagement bait.
- Prose: poteto **Writing the reply** + **unslop**. Short declarative sentences.
- Quality bar: **best-in-class-approach**. Right solution over smallest diff.
- Skill stack: mma-mode alone for explore. Add **best-in-class-approach** for
  build and review. Add **thermo-nuclear-code-quality-review** for settled
  designs, large diffs, and pre-merge. Not for adversarial review of abstract
  plan docs.
- Nontrivial work: research, then design with code, then wait for **go**. After
  go, do not re-confirm reversible steps.
- "All" is bounded by evidence. **do all** / **all in one PR** covers the items
  that earn their place. Name what you left out and why. A question gets a
  report, not an edit.
- Human todos stay. Update their status only. Never drop or recreate them.
- Graphite only for branch and PR work.
  In omp, read `~/.omp/agent/docs/git-workflow.md`; in Cursor, read `~/.cursor/rules/graphite-cli.mdc`.
  Never `git push` or `gh pr create` unless the user explicitly overrides this transport.
- Commits only when asked. A draft PR request counts as the ask.
- Slop gate.
  Before any commit, draft PR, or "ready", strip AI slop and narrating comments from the diff.
  In omp, follow the cleanup route in `skill://poteto-mode`; in Cursor, use `deslop`.

## Approval tokens

| Token | Meaning |
| --- | --- |
| **go** / **continue** / **yes go** | Implement the approved scope. |
| **go on** + ticket URL | Investigate, fix, prove, then open a draft PR (`gt submit --draft`). |
| **create a draft pr** | Commit, then `gt submit --draft`. Partial work is fine when blocked. Say what is missing. |
| **go all** / **go all don't commit** | Execute everything. **don't commit** = zero git writes. |
| **fix all** / **fix all don't commit** | Same as go all, for review-comment batches. |
| **go all then push** / **fix all then push** | Implement first. Push only on the explicit second ask. |
| **all in one PR** | Overrides stack slicing. |
| **push** / **gt submit** | Publish ready-for-review only when explicit. Never bundled with go. |

## Autonomy (short)

Proceed without asking on reversible reads, local investigation, prototypes,
draft plans, stack inspection, comment drafts, test runs. Pause on force-push,
deploys, data deletion, customer-facing messages, GitHub replies to humans,
push or submit without a token above, commits under **don't commit**, and
nontrivial scope before **go**.

"Harness" is ambiguous. Confirm whether the user means the Yampa runtime
(customer agents, IPA, voice) or the coding-agent harness before auditing.

## Verification (short)

Done means proven.
Delegate Yampa console proof to a subagent following `.agents/skills/verify-yampa/SKILL.md`.
Other browser surfaces use the repository's smoke guide and `xd://eval/browser`; CLI/TUI proof launches the actual program.
Follow `.agents/skills/writing-tests/SKILL.md` and `behavior-tests` when applicable.

Prod questions (a conversation UUID, "it's prod", harness cost) get prod data
through **yampa-strategist** or BigQuery. Do not start from the local DB.

Before deleting skills, rules, or config, prove whether agents load them.
Check discovery paths and count real uses in past transcripts.

## Paste / context discipline

If a paste is likely to exceed ~20 KB (HAR, log dump, full stack with frames),
write it to `tmp/` and read the range you need. Pasted content is resent on
every later turn. Search by symbol instead of reading large generated files
whole (`front/lib/types/fastapi/types.gen.ts`). Never re-read a file already in
context this session.

## On demand

| Read | When |
| --- | --- |
| [references/routing.md](references/routing.md) | Selecting a domain skill or a playbook |
| [references/implementation.md](references/implementation.md) | Implementing or executing a settled plan |
| [references/shipping.md](references/shipping.md) | Approval-token ambiguity, branch/PR work, rebasing, submitting |
| [references/verification.md](references/verification.md) | Reproducing a bug, proving behavior, querying production |
| [references/context.md](references/context.md) | Compaction, resuming a session, large artifacts |
| [references/reply.md](references/reply.md) | Writing a substantive final reply |
| [references/frontend.md](references/frontend.md) | Vitest / UI / UX creation |
| [references/review.md](references/review.md) | PR review, comment triage, quality pass |
| [references/pstack-research-design.md](references/pstack-research-design.md) | Research, then design-with-code path |
