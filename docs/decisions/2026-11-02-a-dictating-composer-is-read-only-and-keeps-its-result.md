---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# A dictating composer is read-only and keeps its result

In the context of dictated text landing at the selection saved when the microphone was pressed, facing edits or sends during a capture that would move or remove that range, we chose to make the composer's text field read-only, and its send unavailable, while its capture starts, listens, or transcribes.
We also chose that leaving the composer, by switching session or closing the pane, stops its capture and keeps the result in the draft, that recording goes on when the window loses focus, and that a composer that keeps no draft, such as a scheduled start's, shows no microphone.
We rejected letting the user type during a capture, which would need the range to follow every edit, and discarding a capture on unmount, which would lose speech the user meant to keep.
We accept that the user waits for the capture to end before editing.

## Context

The page holds one capture at a time; other composers' microphones are disabled while it runs.

## Options considered

- Read-only while capturing: the saved range stays valid.
- Editable while capturing: the range must be remapped after each edit.
- No microphone where no draft is kept: text that lands after the composer closes has nowhere to go.

## Consequences

Escape or the dictate shortcut stops a starting or listening capture.
A capture that ends after its composer closed lands in the kept draft through `replaceInComposer`.
