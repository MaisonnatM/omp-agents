---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat, agent
---

# omp settings leaves out settings only omp's terminal draws

In the context of Settings › omp settings, facing 45 panel rows that change only how omp's terminal draws, we chose to leave out ids under `tui.`, `statusLine.`, `display.`, `theme.`, `composer.`, and `terminal.`, `symbolPreset`, `colorBlindMode`, and rows omp shows only for an image protocol, native rendering, or vim mode, both from the list and from `PUT /api/settings/agent`.
We rejected listing every panel row and hiding by tab name.
We keep the section to settings that change what a dashboard session does, since those sessions run over RPC with no terminal, accepting that a terminal user edits those rows in omp's own panel or in `config.yml`.

## Confirmation

`src/omp/agent-settings.test.ts` checks that no listed row matches the rule and that `agentSetting` finds no such id, and `src/settings.test.ts` checks that a write to one answers 404.

## Revisit when

The dashboard draws a terminal of its own, or omp marks terminal-only settings itself.
