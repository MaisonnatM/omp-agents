---
status: accepted
date: 2026-11-12
decision-makers: Maxence Maisonnat
---

# The Artifacts tab uses the Document header look

## Context and Problem Statement

The Artifacts tab and its transcript card needed a look, and five variants were built: Toolbar strip, Artifact list, Version rail, Floating dock, and Document header.

## Decision Outcome

Chosen option: "Document header", because the version's note and whether it is the latest show without a click, and its transcript card is one line like "Ran 6 tools".
The tab shows one tab per artifact, a title block with file, kind, size, save time and the Copy, Download, and Open in browser actions, then numbered version buttons with the version's note and a "Go to latest" link, and the Rendered or Source switch.
The card is one line, "Saved Pricing page as version 2", with an Open chip, or Showing when that version is open.
Each save carries an optional short note the agent writes, saying what that version changed.

### Consequences

* Good, because the history of an artifact reads at a glance.
* Bad, because the header takes about 100px more height than Toolbar strip.
