---
status: accepted
date: 2026-11-16
decision-makers: Maxence
---

# The link preview card reads no page for a link in agent text

In the context of the link preview card, which has the server read a link's page and icon once the pointer rests on it, facing the rule that a link in agent text loads nothing before a click, since a prompt-injected agent can write a secret into an address, we chose to show only the address, with a globe, for a link in agent or prompt text, and the full card for every other link, such as a pull request's or a ticket's.
We chose it over reading every link once the pointer rests on it, accepting that the links agents write, the most common ones, show no title or description.

## Context

The card replaced the desktop app's address at the bottom left, which sent nothing anywhere.
The code-quality review found that a read on rest sends the whole address, path and query included, to its host.

## Options considered

- Address only for agent text, through `linkPages: false` on its `MarkdownPreset`: keeps the rule; chosen.
- The full card everywhere, with the rule changed to "nothing loads before you click or rest on it": richer cards, but a pointer passing over a link could send a secret out.

## Consequences

`MessageMarkdown` marks agent text's root `data-link-preview="address"`, and the card neither reads the page nor fetches the favicon for a link inside it.
Text from GitHub or Linear keeps the full card, though an agent may have written it.

## Revisit when

The dashboard can tell an address an agent wrote from one a person wrote, or a link's host can be checked against a list the user trusts.
