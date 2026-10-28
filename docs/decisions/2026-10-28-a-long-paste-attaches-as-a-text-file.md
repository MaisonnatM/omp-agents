---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# A long paste attaches as a text file

In the context of the composer, facing pasted logs and documents that bury the typed prompt in a field that scrolls, we chose to attach a paste over 2,000 characters or 40 lines as `Pasted text.txt`, through the existing text-file attachment path, over keeping every paste inline and over a collapsed chip inside the text field.
The pasted text reaches the model in the same `<file name="…">` block a dropped text file uses, and the transcript shows it as a file chip, accepting that a long paste can no longer be edited in place: removing the tile and pasting again is the way back.

## Revisit when

The limits are a guess, close to where the composer starts to scroll; move them when users paste short snippets that should stay inline, or ask for a way to paste long text as text.
