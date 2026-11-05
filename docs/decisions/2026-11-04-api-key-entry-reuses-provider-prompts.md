---
status: accepted
date: 2026-11-04
decision-makers: agent
---

# API-key entry reuses provider prompts

In Settings › Providers, facing Anthropic subscription sign-in that asks for no Console API key, we chose an Anthropic API-key method on the existing masked provider prompt, over a separate settings field and over replacing the provider's whole credential set, so the key stays in omp's credential store and subscription accounts stay signed in, accepting that replacement is several native calls and that saving does not check the key.

## Context

Anthropic's subscription sign-in does not offer a Console API-key field.
Users need to replace a key without putting it in a conversation or signing out subscription accounts.
Settings already has a masked provider prompt and an authenticated answer route.
omp's credential upsert matches an API key by the key itself, so a different key adds a row.
A broker snapshot does not contain the real OAuth refresh token.

## Options considered

Reusing the provider prompt saves through the discovered credential store, then removes only the API-key rows seen before the save whose key differs.
A separate settings field would store the secret outside omp's credential store, or would need a second form for the same masked entry.
Replacing every credential for the provider would drop subscription accounts, and on a broker it would write back OAuth rows whose refresh tokens are only sentinels.

## Consequences

The page shows Add API key or Replace API key, a masked field, and Save API key.
Subscription sign-ins and fallback routing stay as they were.
A failed save leaves the previous keys.
A failed cleanup can leave the new key and an old key together, and the page says so without returning native error text.
Saving does not check that the key works or that the account has credit.

## Confirmation

The isolated Settings smoke adds a key, replaces it without a duplicate row, keeps both subscription accounts, and shows no key in the provider response.

## Revisit when

omp grows one credential-store call that replaces a provider's API keys and leaves its OAuth rows untouched, including through an auth broker.
