# Context and session pickup

Read this after compaction, when resuming a session, or when handling large artifacts.

The agent cannot read its own context percentage or start a new conversation.
Compaction is the observable boundary; do not promise to pause at a percentage or block it.
Cursor's user-level preCompact hook writes `tmp/compact-resume-<conversation>.md` and tells the user to start a fresh conversation; the agent is not notified.
Omp replaces older turns with an in-thread summary.
Treat summaries as lossy and read the prior transcript using Poteto `playbooks/session-pickup.md`.
Reuse completed work and resume without restating the mode when mma-mode is invoked after compaction.

If a paste is likely to exceed about 20 KB, write it under `tmp/` and read only the relevant range.
HAR files, log dumps, and full stacks with frames are common examples.
Pasted content is resent on later turns.
Search generated types and large assets by symbol rather than loading them whole.
