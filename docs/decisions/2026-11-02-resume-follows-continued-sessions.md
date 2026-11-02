---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Resume follows continued sessions, fork and replay read the exact file

In the context of omp 18.13.2 and later, where a session that cannot keep writing its file goes on in a sibling file with a new session id that names the old one in `continuationOf`, facing the dashboard's `switch_session`, which opens only the exact file it is given, we chose to have **Resume** open the copy omp's `findSessionContinuation` picks, as `omp --resume` does, while a fork and a replay keep reading the exact file the pane shows.
We rejected following continuations in all three, and following them in none.
Resume then continues the conversation where it went on, not as it was before the move, at the cost of resuming a session id other than the one the row named.

## Context

A resume writes to the file it opens.
Opening the old file after omp moved off it revives the conversation without the turns the copy holds, so the next prompt branches it a second time.
`findSessionContinuation` follows a link only when the copy holds the newest turn of the file it continues, so a file whose own process went on after the move stays the one resumed.

A fork branches at an entry the user picked in the transcript the pane shows, and a replay copies that transcript up to such an entry into a file the dashboard writes itself.
Neither writes to the file it reads.
A copy holds every entry of the file it continues, so the history before the picked entry is the same in either file; but when the old file went on after the move, the copy may not hold an entry picked after it.

## Consequences

`src/server/start.ts` resolves the copy before it spawns omp, so the copy's recorded directory, its replay marker, and its id decide the launch, and a resume of the old file is refused while its copy runs here.
The task identity and the linked facts stay those of the session asked for, since the copy holds its transcript.
The past list still shows the old file and its copy as two rows; **Resume** on either opens the copy.
