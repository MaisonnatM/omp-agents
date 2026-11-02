---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# The Inbox names the item it opens in the address

In the context of the Inbox page, which opens an item beside its list, facing a bare `#inbox` whose open item a new question took over, an address that kept naming an item already gone while its neighbour showed, and a narrow window where the open item hid the list with no way back, we chose to keep opening the first item, write the item a bare route opens, or the one that takes a left item's place, into the address with a history replace, and add **Close** and Escape, which empty the address and open nothing until you open an item.
We rejected opening nothing on a bare `#inbox`, holding the auto-opened item in page state only, and a route that names the closed list.
We gain an open item that only you or its leaving change, at the cost of a page-local flag for the closed state and a first item picked before the pins arrive.

## Context

The page picked its open item from the route by position each render, so whatever sat first or at the left item's place opened, and an item that arrived above changed it while E or D waited to act on it.
Reproduced on a test server: with ALPHA marked read and BRAVO open, a new question opened in BRAVO's place while the address still named ALPHA.
The usage page and the Inbox decision record say nothing about a bare `#inbox`, and the page has always opened the first item.
At 700 pixels wide the list split shows only the open item, and the bar had no control to leave it.

## Options considered

- Write the opened item into the address with `location.replace`: the route then holds the item, as a click on a row does, so arrivals and the back button behave as for a picked item.
  `routeAfter` in `web/inbox-model.ts` names that item.
- Open nothing on a bare `#inbox`, as Notes and Email do: stable and simple, but it changes what users see, and the user has not approved that.
- Keep the auto-opened key in page state: stable, but the address and the open item disagree, and a reload opens another item.
- A route such as `#inbox?open=` for the closed list: a second empty form of the route that links and the router must keep apart from `#inbox`.

## Consequences

The open item changes only when you open another or the open one leaves the list.
**Close** sets a flag the page clears once the route names an item, so a closed list survives arrivals but not a reload, which opens the first item again.
The roster comes before the pins on a new socket, so a bare `#inbox` can open a question that a pinned one then lists above.

## Confirmation

`web/inbox-model.test.ts` covers `nextAfter` and `routeAfter`.

## Revisit when

Confidence is high for the route and moderate for the closed flag.
Revisit when the user decides a bare `#inbox` should open nothing, or when the page can tell that the pins have arrived.
