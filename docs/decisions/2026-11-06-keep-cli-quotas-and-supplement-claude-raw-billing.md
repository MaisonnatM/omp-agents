---
status: accepted
date: 2026-11-06
decision-makers: agent
---

# Keep CLI quotas and supplement Claude raw billing

For Claude subscription extra usage missing from normalized limits, we keep `omp usage --json` authoritative and supplement its raw billing through native `AuthStorage.usage.reports`.
We chose this over replacing the CLI with native reads or modifying installed omp, to show the original billing currency without losing extension reports, accepting a second read and strict identity matching.

## Context

A Claude report retained enabled `raw.spend` of €13.65 with no cap while its normalized limits omitted that spend.
The CLI owns extension loading and quota setup; native auth reports retain the raw billing.
This preserves [Ask omp for what omp already computes](2026-10-20-ask-omp-for-what-omp-already-computes.md).

## Options considered

- Keep CLI quotas and supplement Claude raw billing through `src/omp/usage.ts`, with native imports through `modules.ts`.
  This preserves the CLI's reports and recovers the missing amount.
- Replace the CLI with native auth reports.
  This would require reproducing its extension and credential setup.
- Modify installed omp's normalization.
  This would make the fix depend on a local runtime patch outside this repository.

## Consequences

Extra usage retains its original currency without conversion, and a missing cap remains `null`.
The supplement reads Claude's `spend` and `extra_usage` only.
It requires the same account through `accountId`, or through email when neither side names an account.
Organizations must match when both sides name one.
Email alone never crosses organizations.
A Claude account that names no organization still matches.
Another provider's raw payload does not replace its CLI extra usage.
Quota windows, reset credits, and extension reports remain CLI-owned.
The dashboard makes no direct token or provider billing requests for this supplement.

## Confirmation

The ingestion tests must cover non-USD spend, a null cap, identity mismatches across organizations, and preservation of CLI quota reports.

## Revisit when

The CLI retains all billing currencies in normalized extra usage, or native reports provide the CLI's complete extension setup.
See [Plan quota](../architecture/plan-quota.md) for the data flow.
