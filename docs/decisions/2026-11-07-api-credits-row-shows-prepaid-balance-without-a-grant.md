---
status: accepted
date: 2026-11-07
decision-makers: Maxence Maisonnat
---

# API credits row shows the prepaid balance without a grant

In the context of the API credits row, facing a Console that reports no promotional grant once it is gone, we chose to show the prepaid dollars left, as $0.00 in red once usage runs past them, over leaving the row as the name and over showing the overdrawn amount below zero, so the footer still says whether API credits sessions can run, accepting that the amount's unit comes from an undocumented field and that the row hides how far past zero usage went.

## Context

The row read only the promotional grant, as [2026-11-05-api-credits-balance-comes-from-the-console-session](2026-11-05-api-credits-balance-comes-from-the-console-session.md) chose.
On November 7 the Console answered `promo_tranches: []`, `amount: -72`, `currency: "USD"` for the same account, so the row lost its amount while sessions on API credits were about to fail for lack of balance.
The billing endpoint is undocumented.
Its other money fields name their unit, such as `pending_invoice_amount_cents`, and its credit amounts carry an exponent of 2, so `amount` reads as US cents.
The Console's billing page showed -$0.72 for that account, which confirms the cents.

## Options considered

- Show the prepaid dollars left from `amount`.
  It tells the user the balance is empty or overdrawn, which is the reason to look at the row.
  A wrong unit would show a figure a hundred times off.
- Show the overdrawn amount below zero, as `-$0.72 left`.
  It matches the billing page to the cent, and reads as a broken figure in a row that says what is left.
- Keep the row as the name until a grant returns.
  It shows nothing wrong, and nothing useful when the balance runs out.

## Consequences

With a grant, the row and the model menu are unchanged: dollars spent of the grant.
Without one, both show `$X left`, never below `$0.00`, and the footer turns red at or below zero.
A Console answer in another currency, or without `amount`, leaves the row as the name.
With several API organizations, the first one with a grant wins, and with none, the first one's prepaid balance shows.

## Confirmation

`src/console-credits.test.ts` checks that a grant wins, on a later organization too, that the cents become dollars left, below zero included, and that another currency gives no balance; `web/components/plan-usage.test.tsx` checks that an overdrawn balance reads `$0.00 left` in red.

## Revisit when

Confidence in the unit is high for this account: reopen this when the row and the Console's billing page differ, or when Anthropic documents the field.
