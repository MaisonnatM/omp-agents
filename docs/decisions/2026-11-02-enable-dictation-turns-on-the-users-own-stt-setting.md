---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Enable dictation turns on the user's own stt setting

In the context of dictation being off by default in omp, facing a first press of the microphone that should not need a trip to the config files, we chose a popover whose **Enable dictation** sets `stt.enabled` in the user's own omp config, and does not start recording.
We rejected writing a project's config, which would change the repository, and starting a capture on the same click, which would open the microphone before the user saw where speech goes.
We accept that a project's config or an environment variable that turns dictation off still wins, and the popover then says so and offers only **Open config**.

## Context

The popover names where speech is transcribed and the download a local model may need, so the user agrees to both before the first capture.

## Options considered

- The user's own config, then press again: clear consent, no repository change.
- The project's config: a change in the repository for a personal choice.
- Enable and start at once: one click, but the microphone opens before the user reads the popover.

## Consequences

`PUT /api/dictation/settings` with `{ enabled: true }` answers the settings again, which stay off when a workspace overrides them.
