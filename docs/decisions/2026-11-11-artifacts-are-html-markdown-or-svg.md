---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# Artifacts are HTML pages, Markdown documents, or SVG images

In the context of artifacts, facing agent output that ranges from small apps to diagrams to code, we chose three kinds, HTML pages, Markdown documents, and SVG images, over also making code files and the `mermaid` and `chart` fences artifacts.
We chose it so an artifact is something the user looks at or reads whole, while replies keep their inline diagrams and charts and code stays in the Todos card's **Files**, accepting that a diagram the user wants to keep and iterate on stays in the reply.

## Options considered

- **HTML, Markdown, and SVG**: each renders as a whole thing to look at; HTML needs a sandbox.
- **Also code files**: overlaps the **Files** section, which already lists and opens what the agent wrote.
- **Also mermaid and charts**: would move them out of the reply, changing how every reply reads today.

## Revisit when

Agents often redraw the same diagram across replies, or users ask to keep a chart outside the reply.
