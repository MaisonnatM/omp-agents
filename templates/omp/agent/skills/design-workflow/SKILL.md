---
name: design-workflow
description: The steps for any UI change, from a one-value tweak to a redesign, with references before the first edit, a screenshot check every round, and a separate critic once the user approves the direction. Use before you build, restyle, or fix a screen, component, layout, or flow.
---

# Design workflow

Run these steps in order for every change to what a screen shows.
Each step ends on its output; start the next step only once you have it.
With variants, steps 1 to 3 run, then 5 and 6; once the user picks one, steps 4 to 6 run on the pick.
Every round runs step 5's screenshot check; its critique runs once, when the user approves the direction.

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
  Follow [Variant rules](#variant-rules) for names, screenshots, and the switcher.
- A cosmetic ask, or a variant the user already picked: change the page in place.

Output: every changed page or variant running on a dev server.

## 4. Stress the structure

Skip this step for a cosmetic ask, and for variants the user has not picked from yet.
For each new or restructured component, read `skill://state-machine` and run it when the component has more than one state, then read `skill://break` and run it.
Fix what broke on the `break` page.
When either skill is missing, tell the user to run `bunx skills add jakubkrehel/skills --skill state-machine --skill break -g`, and continue without it.

Output: the `state-machine` and `break` page URLs, with every break fixed or listed.

## 5. Check, then critique once

Every round, screenshot each changed page, variant, and step 4 page in the state the user will check, beside one sibling screen from step 2.
`read` each screenshot and fix what is visibly broken: misalignment, overflow, clipped or wrapped text, a blank or loading state, a component that departs from its sibling.

The critique runs once the user approves the direction: by saying so, or by asking to merge, to mark the PR ready, or to ship.
In `/ship` it runs before the Interface review stage.
Spawn `task` with `agent: "design-critic"`; the builder never grades its own screenshots.
The assignment holds:

- the user's request in their words, and step 1's sentence;
- in `/ship`, the contract's `done_when` list from `ship_stage`, which the critic judges line by line;
- the URL of each changed page, variant, and step 4 page, and how to reach each state a URL cannot open;
- the sibling screens from step 2, with their URLs;
- for an app behind sign-in, the repository's smoke or verify guide that says how to sign in.

Fix every finding and criterion marked `BLOCKING`, then spawn a fresh critic with the same assignment.
Stop after the second critique.

Output: each round, the checked screenshots; once approved, a critic report with no `BLOCKING` line, or the second report's open findings.

## 6. Hand off

Hand off as [Handing off a UI change](#handing-off-a-ui-change) says, and list:

- before the direction is approved, the line "The design critic runs once you approve the direction.";
- each critic finding you left open, with the reason;
- each component or pattern you added where the app already had one, so the user decides whether the app should have two;
- the step 4 pages still running, which you delete when the user says so.

Present the variants unranked; the user picks.

## Variant rules

Name each variant after what it looks like, such as "Mode chip" or "Value slot", and save its screenshot under that name, such as `mode-chip.png`.
That name is the variant's ID, and every surface quotes it unchanged: the preview's labels and switcher, a Slack post and its image captions, suggested prompts such as "Implement Mode chip", and, with the screenshot's path, a subagent's handoff, the ticket, and the PR description.
Refer to a variant by its name alone, never by a number or letter: sharing two of five renumbers them, and the Suggestions block numbers its prompts with the same digits.
A pick that names a variant or shows its screenshot is settled, so build it without asking again; ask only when a pick by number could mean a variant or a suggested prompt.
Before tests or a review, screenshot what you built in the same state as the saved screenshot and compare the two; fix each difference, or name it in the report with its reason.
Keep every prototype and variant screenshot in the session's worktree, in a directory git ignores, and name its path in the reply: the repository's own, such as `tmp/` in omp-agents; otherwise create `prototypes/` and add it to the file `git rev-parse --git-path info/exclude` prints. Never `/tmp` or elsewhere outside the worktree.
Serve a prototype through a named `bash` service, never a bare background process.

## Handing off a UI change

Outside a `/ship` session, "live" means a running localhost URL the user can open, not a merge or a deploy.
When a UI change or a prototype is ready to test, or the user asks you to start a dev server for them, hand it off running:

1. Start the project's dev server yourself as a named long-lived service: `bash` with `name` and `ready`, on a free port between 20000 and 39999. Leave it running after the reply.
2. Open that URL headless and screenshot the changed page in the state the user will check.
3. `read` each screenshot before you show it. Retake one that is blank, white, cropped, still loading, or framed differently from the real page.
4. Show the checked screenshots with the reply, and write out each running server's full URL, such as `http://localhost:24816/settings`, pointing at the changed page.

When the page needs a login the local server cannot complete, give each page as a login link that opens it signed in, never the bare page URL, and use the same links in the `review-pages` block.
In yampa, follow `verify-yampa` § "Hand a page to the user" (`task preview -- <page>` prints the links).
