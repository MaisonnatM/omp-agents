---
status: accepted
date: 2026-11-18
decision-makers: Maxence Maisonnat
supersedes: 2026-11-12-the-artifacts-tab-uses-the-document-header-look
---

# The Artifacts tab and card follow Claude's artifact look

In the context of the Artifacts tab and its card in the conversation, facing a tab whose title block, artifact tabs, and version pills pushed the artifact itself down a narrow sidebar, we chose the look Claude and Cursor give their artifacts over keeping the Document header look, so the artifact fills the tab and the controls sit in thin bars around it, accepting that the note and the other versions now take a click or a glance at the bottom bar.

## Context

Maxence asked for the artifacts to look better, taking Claude's and Cursor's as the example.
Those apps put the artifact's name, a Preview and Code switch, and the actions in one toolbar, show the artifact edge to edge, and keep the version switcher in a small control; the conversation shows each artifact as a tile with an icon, a title, and a kind line.
The Document header look gave the header about 100px more height than a one-line toolbar, which mattered most in the sidebar's default 288px.

## Options considered

- Claude's look, built in place: one toolbar as the Browser's, the artifact full-bleed, a bottom bar with ‹ and › and a **Version N of M** menu, and a tile in the conversation.
- Keeping Document header and only restyling its type and spacing, which left the artifact below a block of metadata.

## Consequences

- Good, because the artifact starts right under one 36px toolbar, and a Markdown artifact reads as a document in a centered column.
- Good, because the toolbar matches the Browser tab's, its sibling in the sidebar.
- Bad, because the note of the shown version sits in the bottom bar, and other versions' notes show only in its menu.
- The switch reads **Preview** and **Source**, as a drawn code block in a reply does, rather than Claude's **Code**, so the dashboard keeps one name.

## Revisit when

Five variants were not built this time, since Maxence named the reference; revisit when the bottom bar's version control proves hard to find.
