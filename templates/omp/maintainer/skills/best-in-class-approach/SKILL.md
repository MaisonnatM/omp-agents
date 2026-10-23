---
name: best-in-class-approach
description: Find and pursue the best possible solution following industry standards and world-class engineering practice, even when that means large changes. Use when designing, implementing, or reviewing a change and the goal is the right approach rather than the easiest local patch. Triggers on best-in-class approach, industry standard, best practice, gold standard, how do top companies do this, or "do it properly even if it's a big change".
disable-model-invocation: true
---

# Best-in-Class Approach

Mandate: find the approach a leading engineering org would choose, ground it in
real standards, adapt it to this codebase, and pursue it — even when that is
larger than the obvious local patch. Ambition serves correctness and longevity,
not novelty.

Full workflow, research gate, review flags, and phrasing:
[reference.md](reference.md). **Read it when designing, implementing, or
reviewing** nontrivial work.

Two modes: **Implementation** and **Review**. Same bar for both.

## Decision workflow

1. State the real problem (requirements and constraints).
2. Name the category (caching, auth, pagination, …) — it usually has a known best answer.
3. Check the codebase first (`AGENTS.md`, helpers, owning layer).
4. Research only when it changes the decision (docs → upstream → articles).
5. Hold two candidates: local patch vs best-in-class. Name costs and benefits.
6. Choose for long-term payoff; prefer correctness → maintainability → performance.

## Big-change test

Push larger when the local fix locks in a pattern you would not choose from
scratch. Hold back when extra scope is speculative gold-plating or breaks a
stable contract without a migration path.

## Done bar

Not done merely because it works. Require: best-in-class (or gap explicitly
justified); grounded in a real standard; docs checked when external APIs matter;
adapted to local canon; correct under real conditions; structural fix pursued
when warranted.

## Output shape

1. Best-in-class approach + why.
2. Tradeoff vs local fix.
3. Codebase mapping.
4. Concrete plan (sequenced if large).
5. Risks / migration if contracts change.
