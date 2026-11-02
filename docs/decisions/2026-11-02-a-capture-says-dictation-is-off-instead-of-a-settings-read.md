---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# A capture says dictation is off instead of a settings read

In the context of the setup popover, which needs a directory's dictation settings when dictation is off there, facing a settings read before every capture that loaded omp's settings and model registry twice per press, we chose to have `dictation-start` answer an `off` event with the settings, then its `end`, when dictation is off, and to drop `GET /api/dictation/settings`.
We rejected the read before each start because it doubled the server's work and gave the page a second state machine, with its own checking and failure states, for what the capture already decides.
We accept that the capture's events carry an outcome that is not about the microphone.

## Context

The server already refused a capture where dictation is off, and already sent where speech goes before it opened the microphone.
The microphone still never opens while dictation is off, so turning it on stays the user's explicit choice.

## Options considered

- The capture answers `off` with the settings: one read per press, one state machine on the page.
- A settings read before each start: a clear separation, at twice the server's work and a second set of page states.

## Consequences

`PUT /api/dictation/settings` remains, for **Enable dictation**, and answers the settings after.
A settings file the server cannot read fails the capture, with the status row every failed capture shows.
