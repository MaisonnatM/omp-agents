---
status: accepted
date: 2026-11-07
decision-makers: agent
---

# A spent API key is a usage limit, in a runtime patch

In the context of sessions routed to the Anthropic API key, facing Anthropic's 400 `Your credit balance is too low` that omp treats as an ordinary failure, we chose to add that wording to pi-ai's credits-exhausted pattern in a standalone runtime patch over folding it into the paid Cursor patch and over an omp extension that rewrites the error, to send the refusal down the same usage-limit path as a 429 quota, accepting a patch the user must apply and rebuild after each omp upgrade.

## Context

omp classifies the refusal as `{usage: false, retriable: false}`, so turn recovery never marks the credential's limit reached.
With `retry.fallbackOn: usage-limit` the session stops; with `any` it falls back, but the generic five-minute cooldown restores the dead primary on the next prompt, which is the loop two Hameau sessions hit on 2026-11-07.
One regular expression, `CREDITS_EXHAUSTED_PATTERN` in `pi-ai/src/error/rate-limit.ts`, feeds the quota reason, the `UsageLimit` flag, and the billing-cap check that skips the sleep.
The dashboard cannot change how a session's runtime classifies its errors; omp-agents keeps runtime changes as patches in `patches/`.

## Options considered

- Add the wording to `CREDITS_EXHAUSTED_PATTERN` in its own patch, now `patches/omp-18.18.8-credit-balance-fallback.patch`: one line, every consumer of the pattern agrees, and it applies with or without the other runtime patches. Chosen.
- Fold it into the paid Cursor patch, now `patches/omp-18.18.8-paid-cursor-fallback.patch`: that patch is about paying for Cursor, and a user who wants this fix without paid fallback could not take it alone.
- An omp extension that rewrites the error text into a 402 before turn recovery sees it: it would replace the provider's real message with a made-up one, and it would depend on hook ordering inside turn recovery that the runtime does not promise.

## Consequences

A spent key now marks its credential reached for 30 minutes, walks the fallback chain under `usage-limit` or `any`, and is not restored by the five-minute cooldown.
`retriable()` turns true for it, as it is for every usage limit; the provider still does not replay the request.
The dashboard's own out-of-credit check in `src/omp/stats.ts` matches the same wording itself, so the bell and the footer flag the key even on a stock runtime.

## Confirmation

The patch's tests: `treats the Anthropic credit-balance 400 as a usage limit` in `rate-limit-utils.test.ts`, and `walks the fallback chain on an Anthropic credit-balance 400 under retry.fallbackOn usage-limit` and `does not restore a credit-exhausted primary when the generic five-minute cooldown expires` in `agent-session-retry-fallback.test.ts`; each fails on the stock release.

## Revisit when

Upstream omp ships the wording in its own pattern, which makes the patch redundant; or Anthropic changes the refusal's text or status.
