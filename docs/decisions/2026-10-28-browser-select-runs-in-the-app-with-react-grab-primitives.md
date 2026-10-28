---
status: accepted
date: 2026-10-28
decision-makers: Maxence Maisonnat
---

# Browser's Select runs in the app with react-grab's primitives

In the context of the Browser's **Select**, which picks elements in a session's app as T3 Code does, facing react-grab's own interface, which sent each element to the composer apart from the marks, could turn itself off and end picking with the marks, and needed its comment told apart from its copied text, we chose our own hover outline and click-to-select in the app's page, `desktop/preview-pick.ts`, with react-grab kept only for `getElementContext` and `getElementAtPoint` from `react-grab/primitives`, over keeping react-grab's interface and over dropping react-grab.
It puts selected elements and marks under one card and one **Attach**, as T3 Code does, accepting a script of ours in the app's page.

## Options considered

- Our own Select in the app's page, reading elements with `getElementContext` only at **Attach**: one card, one chip, and the page decides when picking ends; chosen, as T3 Code's `PickPreload.ts` does.
- React-grab's toolbar, selection, and Comment, as before: no picker to keep, but each click sent an element on its own, and react-grab turning itself off ended picking.
- No react-grab: a smaller guest script, but the chip loses each element's React component, source file, and selector.

## Consequences

The outlines are drawn in the app, in a closed shadow root, so the capture shows them and the page draws only the marks on it.
Select keeps every press from the app's handlers, so a click on a button selects it without pressing it.
An app that ships its own react-grab keeps it; ours no longer starts one, so its toolbar no longer shows in the Browser.

## Confirmation

The desktop smoke selects a button, which stays unpressed, and a card with Shift, draws a box, and attaches them as one chip and one picture; Erase drops a selected element.

## Revisit when

React-grab's primitives change shape, or T3 Code moves its picker out of the app's page.
