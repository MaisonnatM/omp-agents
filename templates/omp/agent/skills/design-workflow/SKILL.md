---
name: design-workflow
description: The steps for any UI change, from a one-value tweak to a redesign, with references before the first edit and a separate critic before the user sees it. Use before you build, restyle, or fix a screen, component, layout, or flow.
---

# Design workflow

Run these steps in order for every change to what a screen shows.
Each step ends on its output; start the next step only once you have it.
With variants, steps 1 to 3 run, then 5 and 6; once the user picks one, steps 4 to 6 run on the pick.

## 1. Name the ask

Say in one sentence whether the request is structural or cosmetic.
Structural changes the layout, what the screen shows, the flow, or which component presents it.
Cosmetic changes one color, spacing, radius, or piece of copy on a layout that stays.
"Design", "UX", "UI", "rework", or "world class" with no named value means structural.

Output: the sentence, in your reply.

## 2. Gather references

Before the first edit, write a reference note:

1. The app's own pattern: the shared components and sibling screens that already present this kind of UI, with their file paths, and how sibling callers use those components.
   The app's pattern wins unless the user asked for a redesign or the app has no pattern for this.
2. For a structural ask, the user's saved UI library when their `AGENTS.md` names one, then Mobbin's `search_screens` or `search_flows` for how strong products present the same thing.
   Name what you borrow from each reference.

Output: the note, listing only sources you opened this session.

## 3. Build

- A structural ask with no picked variant: build 5 variants, each a different structure, such as a table, an inbox, a split view, or a timeline, each named after its structure.
  Two skins of one layout are one variant.
  Build each inside the real page with the app's shared components and data shaped like production.
  Follow the Design variants rules in your system prompt for names, screenshots, and the switcher.
- A cosmetic ask, or a variant the user already picked: change the page in place.

Output: every changed page or variant running on a dev server.

## 4. Stress the structure

Skip this step for a cosmetic ask, and for variants the user has not picked from yet.
For each new or restructured component, read `skill://state-machine` and run it when the component has more than one state, then read `skill://break` and run it.
Fix what broke on the `break` page.
When either skill is missing, tell the user to run `bunx skills add jakubkrehel/skills --skill state-machine --skill break -g`, and continue without it.

Output: the `state-machine` and `break` page URLs, with every break fixed or listed.

## 5. Critique

Spawn `task` with `agent: "design-critic"`; the builder never grades its own screenshots.
The assignment holds:

- the user's request in their words, and step 1's sentence;
- the URL of each changed page, variant, and step 4 page, and how to reach each state a URL cannot open;
- the sibling screens from step 2, with their URLs;
- for an app behind sign-in, the repository's smoke or verify guide that says how to sign in.

Fix every finding marked `bug`, then spawn a fresh critic with the same assignment.
Stop after the second critique.

Output: a critic report with no `bug`, or the second report's open findings.

## 6. Hand off

Hand off as the Handing off a UI change rules in your system prompt say, and list:

- each critic finding you left open, with the reason;
- each component or pattern you added where the app already had one, so the user decides whether the app should have two;
- the step 4 pages still running, which you delete when the user says so.

Present the variants unranked; the user picks.
