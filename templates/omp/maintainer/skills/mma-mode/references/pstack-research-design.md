# Research and design (pstack Pt. 2 → Yampa)

Personal map of Lauren / poteto’s research–planning–architecture workflow onto mma + Yampa. Source: [The Complete Guide to pstack Pt. 2](https://x.com/poteto/status/2097732320606507506). Pt. 1 lives in `verify-yampa`. This file is the design half.

mma-mode loads poteto-mode (principles + playbooks) then applies mma overlays. Prefer mma-mode as the entry; poteto playbook names below still identify which file to open. Prompt shapes below use Cursor slash syntax. In omp, write `/skill:mma-mode`, `/skill:architect`, and so on.

## Thesis

Verification without research still babysits. Research without proof still gambles. The loop is:

1. Prime context (agent restates the problem in its own words).
2. Build a shared mental model (`/how`, `/why`, `/teach`, `/recall`).
3. Design with code (`prototype`, `/architect`, readme-driven `/technical-writing`).
4. Execute only after the design is settled (multi-phase plan / `writing-plans` with live proof).
5. Prove on the real surface (`verify-yampa`, not “it compiles”).

mma’s **go** gate still sits between settled design and implementation. It is not a substitute for empirical design.

## Failure modes agents still hit

1. Intent under-specified or poorly specified.
2. Not enough context on how to do the work correctly.

Both are context problems. Write working code without priming if you must. Outcomes are better when the agent has everything it needs first.

## Indirect prompt

Do not lead with your hypothesis on an ambiguous thread or bug. Draw the problem out of the agent.

```text
/mma-mode read this slack / sentry / ticket thread.
restate in your own words and in plain english what you think the underlying issue is
```

What this buys:

1. Compresses noise into a structured problem statement.
2. Surfaces misunderstandings before any code.
3. Avoids locking the agent onto your (possibly wrong) framing.

## Mental model tools

| Skill | Job | Yampa note |
| --- | --- | --- |
| `/how` | Runtime mechanics. Parallel explorers when the subsystem spans dirs/services. | Prefer repo-local paths under `yampa/`, `front/`, Temporal workers. |
| `/why` | Motivation and intent from history (git/PRs, Linear, Notion, Slack, Datadog, Sentry). | Use when “why is it this way?” blocks a change. |
| `/teach` | Agent explains how/why in words you can trust. Calls `/how` + `/why` under the hood. | Use before approving a non-obvious design. |
| `/recall` | Pull rich context from prior chats so a fresh agent is not cold. | Use on multi-day threads (virtualization-style repeats). |

Example:

```text
/teach me why you implemented it this way and not <other way>.
what were the tradeoffs you made and why?
```

Teaching you also forces the agent to read enough code to stop confident guessing.

## Design with code (not Plan Mode)

Most plan modes over-specify implementation and under-specify everything else. Prefer:

### Readme-driven shared surfaces

For packages or APIs others will call, start with the caller experience via `/technical-writing` (Diátaxis + `/unslop`). Tutorial or how-to first. Implementation follows the public shape.

### Prototype playbook

`/mma-mode prototype …` matches poteto `playbooks/prototype.md`. Throwaway sketches. Competing variants behind a switcher when useful. Measure with the control skill.

Yampa control skill for console UI:

```text
/mma-mode prototype a few options for <feature>.
use /verify-yampa and take screenshots for me to review and choose from
```

Prototypes answer open questions with evidence so you do not babysit forks the agent can settle alone.

### `/architect`

For new boundaries and bigger shape changes:

1. Ground with `/how` + `/why`.
2. Parallel design runners (usage sketch, types, signatures, rationale).
3. Cross-judge and synthesize.
4. Implement against the sketch. Surface signature drift.
5. Scrap and restart when types need `any` / casts / repeated workarounds across call sites.

Do not adversarially review abstract plans. Agents invent theoretical risks. Settle open questions with prototypes instead.

## Execution plans (after design)

When the design is good and the work spans several PRs:

```text
/mma-mode turn this design into a plan
```

That is poteto `playbooks/multi-phase-plan.md` (or repo `writing-plans` for a lighter checklist). Every task ends in proof. Tests alone are not enough. Live verification uses `verify-yampa` for console surfaces.

Keep large plans temporary. Delete them when the program lands so the tree does not accumulate stale intent.

## Prompt shapes that work

Ambiguous production bug:

```text
/mma-mode investigate why <symptom>.
give me a breakdown of what we know, what data you used, and your best hypotheses
```

New service boundary:

```text
/mma-mode we need <capability>.
/architect this first, and answer any open questions with prototypes.
let me review before proceeding
```

Multi-PR migration:

```text
/mma-mode create a plan to <migration>.
break into small verifiable PRs.
each PR must have unit + live verify-yampa steps.
final result must match current behaviour (bugs included if that is the bar)
```

Enough context already:

```text
/mma-mode do it
```

or

```text
/mma-mode repro this with /verify-yampa.
if it repros on main, fix it and show me screenshots as proof
```

## Compound research → design prompt

```text
(1) /recall my recent work on <area>. use /how and /why on the current implementation.
(2) /mma-mode planning and /technical-writing: design <target> that eliminates <known failure modes>.
    start with a tutorial for how I would use the new surface.
(3) /teach me and prove why this approach beats the current one (verify-yampa where UI is involved)
```

## What “plan, then go” means here

| Step | Owner | Artifact |
| --- | --- | --- |
| Restate + research | Agent | Problem statement, how/why notes |
| Design with code | Agent | Prototype evidence and/or architect sketch |
| Human gate | mma | **wdyt?** → **go** |
| Execution plan (if multi-PR) | Agent | Checklist with verify boxes |
| Build + prove | Agent after **go** | Stacked PRs + `verify-yampa` / tests |

Abstract Plan Mode docs without prototypes are not a plan. They are the illusion of progress.
