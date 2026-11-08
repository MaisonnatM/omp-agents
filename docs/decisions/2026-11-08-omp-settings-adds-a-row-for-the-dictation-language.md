---
status: accepted
date: 2026-11-08
decision-makers: agent
---

# omp settings adds a row for the dictation language

In the context of dictating in French, facing omp's `stt.language`, which defaults to English and which omp's settings panel gives no control, we chose to give it a row in Settings › omp settings, in omp's Interaction › Speech group beside Speech-to-Text, as a choice among Whisper's language codes named in English.
We rejected a text field for the code and a Dictation line in the dashboard's own Preferences.
We gain the setting where omp's other speech settings already sit, saved to `config.yml` like every other row, accepting one setting whose label and choices the dashboard writes rather than omp, which [omp settings follows omp's own settings panel](2026-11-02-omp-settings-follows-omps-own-settings-panel.md) otherwise avoids.

## Context

The user asked for the dictation language to be editable in Settings, set to French.
omp registers `stt.language` in `stt/settings.ts` with no panel metadata, so Settings › omp settings counted it among the settings only `config.yml` edits.
omp passes the language to Whisper and to cloud transcription; Parakeet, its default local model, ignores it and recognizes the language on its own.

## Options considered

- A row in omp's Speech group with a choice of languages: found beside Speech-to-Text and by a search for "language", and saved through the same write as other rows.
- The same row as a text field: no list to keep, but you must know the code `fr` rather than pick French.
- A line in Settings › Preferences: needs its own read and write of an omp setting, away from omp's other speech settings.

## Consequences

`ADDED_UI` in `src/omp/agent-settings.ts` holds the row's label, description, and choices.
A language Whisper lacks still saves through `config.yml`, and its row shows the code.
If omp gives `stt.language` its own panel metadata, omp's wins, since `ADDED_UI` applies only to a setting without it.

## Confirmation

`src/omp/agent-settings.test.ts` checks the row sits in the Speech group with French among its choices.

## Revisit when

omp's panel gains a control for `stt.language`, at which point `ADDED_UI` loses its entry.
