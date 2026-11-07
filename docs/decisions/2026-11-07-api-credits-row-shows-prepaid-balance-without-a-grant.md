---
status: accepted
date: 2026-11-07
decision-makers: Maxence Maisonnat
---

# API credits row shows the prepaid balance without a grant

In the context of the API credits row, facing a Console that reports no promotional grant once it is gone, we chose to show the prepaid dollars left, red at or below zero, over leaving the row as the name, so the footer still says whether API credits sessions can run, accepting that the amount's unit is read from the field's neighbors rather than from documentation.

## Context

The row read only the promotional grant, as [2026-11-05-api-credits-balance-comes-from-the-console-session](2026-11-05-api-credits-balance-comes-from-the-console-session.md) chose.
On November 7 the Console answered `promo_tranches: []`, `amount: -72`, `currency: "USD"` for the same account, so the row lost its amount while sessions on API credits were about to fail for lack of balance.
The billing endpoint is undocumented.
Its other money fields name their unit, such as `pending_invoice_amount_cents`, and its credit amounts carry an exponent of 2, so `amount` reads as US cents.

## Options considered

- Show the prepaid dollars left from `amount`.
  It tells the user the balance is empty or overdrawn, which is the reason to look at the row.
  A wrong unit would show a figure a hundred times off.
- Keep the row as the name until a grant returns.
  It shows nothing wrong, and nothing useful when the balance runs out.

## Consequences

With a grant, the row and the model menu are unchanged: dollars spent of the grant.
Without one, both show `$X left`, and the footer turns red at or below zero.
A Console answer in another currency, or without `amount`, leaves the row as the name.

## Confirmation

`src/console-credits.test.ts` checks that a grant wins, that the cents become dollars left, below zero included, and that another currency gives no balance.

## Revisit when

Confidence in the unit is moderate: compare the row with the Console's billing page after the next top-up, and reopen this when the two differ or Anthropic documents the field.
