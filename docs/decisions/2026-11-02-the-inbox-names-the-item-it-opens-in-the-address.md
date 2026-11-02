---
status: deprecated
date: 2026-11-02
decision-makers: agent
---

# The Inbox names the item it opens in the address

In the context of the Inbox page, which opens an item beside its list, facing a bare `#inbox` whose open item a new question took over, an address that kept naming an item already gone while its neighbour showed, and a narrow window where the open item hid the list with no way back, we chose to open the first item on arrival with `useOpenLatest`, as Email, Notes, and Todo do, to write the item that takes a shown item's place into the address with a history replace, and to add **Close** and Escape, which empty the address and return the focus to the item's row.
We rejected opening nothing on a bare `#inbox`, a page-local flag for the closed list, holding the auto-opened item in page state only, and a route that names the closed list.
We gain an open item that only you or its leaving change, the same arrival and close behavior as the other list pages, at the cost of a first item picked once the session lists arrive, before the pins do.

## Context

The page picked its open item from the route by position each render, so whatever sat first or at the left item's place opened, and an item that arrived above changed it while E or D waited to act on it.
Reproduced on a test server: with ALPHA marked read and BRAVO open, a new question opened in BRAVO's place while the address still named ALPHA.
The usage page and the Inbox decision record say nothing about a bare `#inbox`, and the page has always opened the first item.
Email, Notes, and Todo open their first item on arrival through `useOpenLatest` in `web/use-open-latest.ts`, which replaces the list's history entry once and then leaves the list as it is, so closing an item there shows the list.
At 700 pixels wide the list split shows only the open item, and the bar had no control to leave it.

## Options considered

- `useOpenLatest` for the bare route and the closed list, and `openFor` in `web/inbox-model.ts` for the item that takes a shown item's place: the route then holds the item, as a click on a row does, and the Inbox behaves as the other list pages.
  `openFor` hands the route on only from an item the list showed, so a link to an item it never showed opens a stand-in without writing it.
  Notices arrive after the session lists, and on a test server a link to a Slack notice showed the first turn for about 70 milliseconds before its notice listed and opened.
  Handing on from any missing item would have written that turn into the address and lost the notice.
- Open nothing on a bare `#inbox`: stable and simple, but it changes what users see, and the user has not approved that.
- A page-local flag that keeps the list closed until you open an item: it works, but it reimplements what `useOpenLatest` settles.
- Keep the auto-opened key in page state: stable, but the address and the open item disagree, and a reload opens another item.
- A route such as `#inbox?open=` for the closed list: a second empty form of the route that links and the router must keep apart from `#inbox`.

## Consequences

The open item changes only when you open another or the open one leaves the list.
Close empties the address and leaves the list as it is until you open an item, and a reload opens the first item again.
`useOpenLatest` waits for the session lists, and the server sends the pins after them, so a bare `#inbox` can open a question that a pinned one then lists above.

## Confirmation

`web/use-open-latest.test.ts` covers the arrival with the Inbox's address, and `web/inbox-model.test.ts` covers `openFor`: a kept item, a bare route, a shown item handed on, a link to an item never shown, and the chain of items that take over.

## Revisit when

Confidence is high.
Revisit when the user decides a bare `#inbox` should open nothing, or when the page can tell that the pins have arrived.
