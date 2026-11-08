---
status: accepted
date: 2026-11-08
decision-makers: agent
---

# Order provider accounts by policy priorities in Settings › Providers

In the context of choosing which signed-in account omp tries first, facing an order kept only in hand-written `auth.accountPolicies` entries, we chose up and down arrows on Settings › Providers' account lines that save descending `priority` values on email-matched policies, keeping every other entry and field, over a JSON editor for the whole setting and over a dashboard-only order omp never reads, so the page shows the order omp's account selection uses, accepting that the page rewrites the priorities of every orderable account of that provider, that accounts without a unique email cannot be ordered, and that shown ties may break by usage at run time.

## Revisit when

omp exposes an account-order API of its own, or `auth.accountPolicies` gains a field the page would also need to edit, such as reserves.
