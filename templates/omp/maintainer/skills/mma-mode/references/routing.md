# Task routing

Use this map when choosing a domain skill or a playbook.
Resolve bare skill names through `skill://<name>` on omp.
Repo-local paths are relative to the repository, not this skill directory.

| Situation | Route |
| --- | --- |
| Ambiguous bug / Slack / Sentry | Poteto Investigation; restate the problem in your own words first |
| Production conversation UUID / behavior | `yampa-strategist` or BigQuery; name the conversations sampled, not the local DB |
| Harness audit / token or cost work | Resolve Yampa runtime versus coding-agent harness before auditing; use production data when it changes priorities |
| Shared mental model | `how`, `why`, `teach`, `recall` |
| UX creation or design fork | `linear-method-ux`, then Poteto Prototype and Yampa console proof through `.agents/skills/verify-yampa/SKILL.md` |
| New shared API / package DX | Readme-driven `technical-writing`, then `architect` |
| Structural / module shape | `architect` |
| Multi-PR execution after design | Poteto `playbooks/multi-phase-plan.md` or `front/.agents/skills/writing-plans/SKILL.md`, with live proof boxes |
| New feature / stack shape | Cursor's `split-to-prs` command; on omp, Poteto multi-phase-plan after design is settled |
| Backend / API / domain | `.agents/skills/backend-development/SKILL.md` |
| Endpoints | Repo endpoint-design skill, when present; use its discovered URI or exact repo path |
| Tests / pytest layout | `.agents/skills/writing-tests/SKILL.md` |
| Tests / spec-first logic | `behavior-tests`; frontend also `__tests__/meta/frontend-test-quality.test.ts` |
| Frontend tests | [frontend.md](frontend.md) |
| IPA / page context / RJSF connectors | `front/.agents/skills/frontend-patterns/SKILL.md`, `building-components` |
| Sidebar or UI icons | Central icon registry and meta tests under `front/__tests__/` |
| Color tokens / OKLCH | `better-colors` |
| Component patterns feel hacky | [shadcn docs](https://ui.shadcn.com/docs) before new wrappers |
| Surrounding architecture unsound | `global-best-practice` |
| Slim code / defensive guards | `lean-code-simplification-review` |
| Rebase / conflicts | [shipping.md](shipping.md), `gt restack`; Cursor may also use `fix-merge-conflicts` |
| PR status / get green / Bugbot | Poteto `playbooks/babysit.md` and its skeptical Bugbot triage |
| Land a green stack | Poteto Shipping, through Graphite unless explicitly told otherwise |

Research and design details live in [pstack-research-design.md](pstack-research-design.md).
