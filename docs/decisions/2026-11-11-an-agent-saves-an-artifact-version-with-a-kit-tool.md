---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# An agent saves an artifact version with a kit tool

In the context of making and updating artifacts, facing agents that revise a page or a document over several turns, we chose to have the agent write the file to its session's `local://` folder and then call a starter-kit `artifact` tool that saves that state as a version in the session file, over a fenced block holding the whole content in the reply and over turning every `local://` file into an artifact.
We chose it so a change costs one `edit` call instead of the whole content again, and so the dashboard reads artifacts from the session file for live, past, and terminal sessions alike, as it reads the `arena` tool's records, accepting that an agent which edits the file and forgets the tool call leaves the artifact on its previous version.

## Options considered

- **Write to `local://`, then call the tool**: cheap edits and an explicit version per call; two calls per version.
- **A fenced block in the reply**: follows the `mermaid` and `chart` fences, but every version repeats the full content as output tokens and in the reply text.
- **Every `local://` file**: no extra call, but scratch files, plans, and subagent handoffs kept there would show as artifacts.

## Revisit when

Agents often forget the tool call after an edit, which a watcher on the saved file could catch.
