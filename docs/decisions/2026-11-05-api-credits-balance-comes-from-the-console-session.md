---
status: accepted
date: 2026-11-05
decision-makers: Maxence Maisonnat
---

# API credits balance comes from the Console session

In the context of the API credits row, facing a footer that could show only the name, we chose the Firefox or Zen Claude Console session over an Admin API key and over leaving the name, to show dollars spent of the monthly grant, accepting an undocumented billing endpoint and no reading of Chrome's encrypted cookies.

## Context

The stored API key can name the Console organization and cannot read billing.
The organization is an individual account, and Anthropic's Admin API, including the cost report, is unavailable for individual accounts.
The cost report would also be calendar-month spend, not the promotional grant and its cap.
The grant, spent and cap, is on the Console billing page.

## Options considered

- Read the signed-in Console session in Firefox or Zen.
  It returns the promotional grant's remaining amount, the amount granted, and the expiry.
  The endpoint is undocumented and the session expires.
  Chrome's cookie store is encrypted, so a sign-in that exists only there is not read.
- Use an Admin API key.
  The official cost report needs an organization that can issue one, which this individual account cannot.
  It still would not show the grant cap.
- Leave the row as the name.
  The amounts stay on the billing page and the footer cannot show them.

## Consequences

The API credits row shows spent and the grant when Firefox or Zen holds a Console session, and stays a name otherwise.
Plan notices and continues still ignore the row.
The server sends the session cookie only to `platform.claude.com` and does not store it.

## Confirmation

`src/console-credits.test.ts` checks the grant math, which organization is asked, and which cookie is chosen.

## Revisit when

Anthropic documents a balance call that an individual account's API key can make, or the footer needs Chrome's encrypted store.
