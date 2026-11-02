---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat, agent
---

# omp settings follows omp's own settings panel

In the context of editing omp's own settings from the dashboard, facing about 500 settings that only `config.yml` or omp's terminal `/settings` panel could change, we chose a Settings section drawn as a tab rail with inline rows, whose tabs, groups, labels, and controls come from omp's panel definitions in `pi-tui/src/overlays/settings-defs.ts`.
We rejected a flat list grouped by config key and a list with a detail pane per setting.
We gain the same tabs in the same order as omp's panel, and a setting omp adds to its panel shows here with no change, accepting that the server loads a module from `pi-tui` and that a release which renames those exports stops the server at startup until `src/omp/modules.ts` follows.

## Context

omp's registry (`config/registry.ts`) knows every setting's type, default, and writer, and its panel definitions add the tab, group, label, description, and choices a person reads.
`createSettingsHost` in `config/settings-ui.ts` builds the same panel entries, but from omp's process-wide `settings`, while the dashboard reads one workspace at a time through `Settings.loadReadOnly({ cwd })`.
The user approved this as the recommended variant of the design proposal described in the pull request that added the section.

## Options considered

- Tab rail with inline rows: omp's tabs in a rail like Settings › Files, each row editable in place, with the workspace and environment layers shown only when they apply.
- Flat list by config key: simple, but it drops omp's grouping and labels and shows keys a person rarely knows.
- List with a detail pane: room for every layer of a value, at the cost of a click to read or change any setting.

## Consequences

Users moving between omp's terminal and the dashboard find the same settings in the same places.
Maintainers follow omp's panel exports at each release, which `bun run omp-release` checks.
Settings omp's panel gives no control stay in `config.yml`, which the section counts and links to in Files.

## Confirmation

`src/omp/agent-settings.test.ts` checks the tab order, the Appearance rows, and the control each kind of setting gets.

## Revisit when

omp exports a host for its panel that takes a loaded settings instance, or moves the panel definitions out of `pi-tui`.
