# Terminal sessions

Sessions started in a terminal are reached through their Collab room:

- Every 1.5 seconds the server lists the local hosts through the registry, and pushes the roster when a row or the registry error changed; the past list goes out again only when a session joined or left.
  The roster goes out the way the past list does: whole when a page connects, then each push carries only the rows that changed or joined, the instance ids that left, and the registry error.
  That is the same call that backs `omp collab list`.
- The server joins every listed session's room as a guest named `omp-agents`, as `omp join` would.
  The guest is how the dashboard prompts a session (`prompt` frames), stops a turn (`abort`), messages a subagent (`agent-cmd` `chat`; the host steers, prompts, or revives it), and cancels a running subagent (`agent-cmd` `kill`).
  It also carries the host's subagent registry (`agents` frames), subagent progress (`bus` frames), the host's model, thinking level, context numbers, and whether a turn runs (`state` frames), and the live agent events.
  The composer enables as soon as the host welcomes the guest.
  Nothing waits on the transcript snapshot that the host then sends.
- The host steers every `prompt` and `chat` that arrives during a turn.
  The guest therefore holds follow-ups and sends the next one when a `state` frame stops reporting `isStreaming`, or when an `agents` frame shows the subagent no longer running; it checks after every frame but the agent events, which cannot end a turn.
  It sends none after a turn that its own `abort` or a reply cut off mid-stream ended.
- The dashboard uses omp's discovery and autocomplete modules for file commands, skills, and file mentions.
  It expands file commands and skills before guest prompt delivery because Collab prompts bypass the host's slash-command pipeline.
  The host still resolves `@file` references in the selected session's working directory.
- If a host starts a new room, for example after `/new` or `/resume`, the server sees the new generation and joins the new room.
  If the link request races the switch and fails with `stale_generation`, the server lists again and retries.
  A host that leaves the registry is marked as no longer running.
- Collab has no frame that ends a host, so ending a terminal session sends `SIGTERM` to its omp process, through a writable room only.
  The guest first lists the registry again and signals only when the same `instanceId` still runs at that pid and hosts the session, so a pid that a host freed and another process reused since the last poll is never signalled.

Terminal sessions send their questions to writable guests as Collab `ui-request` frames, and the guest answers with `ui-response`.
The host races every writable guest against its own terminal dialog, and the first answer wins.
When the question ends anywhere else, the host sends `ui-request-end` and the card goes away.
After a reconnect, the host sends the questions that still wait again.
Read-only rooms receive no questions.

## Why the server joins every terminal session

Subagent status lives in the host's memory.
The session files on disk cannot tell an idle subagent from a parked one.
The guest connection is the one source the protocol offers for live status, and the host already leaves advisor rows out of it.
Joining every session keeps those rows current for sessions that you have not opened, and keeps each room ready for a prompt.

The cost is visible on each host and on its relay (`collab.relayUrl`, by default an internet relay):

- Each listed session counts `omp-agents` as one more participant for as long as the dashboard runs.
  The terminal shows that the guest joined.
- Each session sends its full transcript snapshot through the relay when the dashboard joins it, and every live event after that.
  The dashboard ignores the snapshot.
  Transcripts never travel through the relay.
- The text that says what a subagent is doing comes from live progress events.
  After the dashboard restarts, a subagent's link shows only its status until that subagent reports progress again.

Stop the dashboard to leave every room.
