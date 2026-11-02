---
status: accepted
date: 2026-11-02
decision-makers: user, agent
---

# Dictation records in the server through omp's bridge

In the context of a composer microphone for a dashboard that runs on the user's own computer, facing omp already shipping speech-to-text settings, models, and a recorder with an RPC dictation bridge, we chose to run each capture in the dashboard server through omp's `RpcDictationBridge`, with no session and omp's `STTController` as its recorder, and to send its events to the page over the socket.
We rejected recording in the page with the browser's microphone, which would need a second transcription path beside omp's, and sending a dictation command to a session's omp, which needs a session and has no RPC command for it.
We accept that the microphone is the one of the computer that runs the server, and that the packaged app must declare the microphone to macOS.

## Context

omp's terminal already dictates with its `stt` settings, local or provider models, and language.
The proposal's recommended variant is the inline microphone with a status row, which needs listening, preview, transcribing, and end events.

## Options considered

- Server capture through omp's bridge: one recorder, omp's settings and models, events over the socket.
- Browser capture with `getUserMedia`: a second transcription path and model choice to keep in step with omp.
- A session's omp over RPC: dictation would need a running session and a new omp command.

## Consequences

The server holds one capture at a time, and a second start is refused as busy.
A socket's close disposes its capture, so the page marks it failed and keeps its last preview.
