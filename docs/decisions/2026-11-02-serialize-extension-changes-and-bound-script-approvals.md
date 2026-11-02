---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Serialize extension changes and bind script approvals

In the context of native package changes from the dashboard, facing concurrent registry writes and an installer that can pause for script consent, we chose one in-process mutation queue with workspace-bound, exact-request approval tokens over concurrent handlers and over detached CLI processes, to retain native installer behavior without automatic consent, accepting that a waiting approval blocks later changes and a restart loses transient job status.

## Context

The native installer supplies the resolved package version and script file list before asking for consent.
Its callback is asynchronous, while the dashboard needs to show progress and accept the answer in another HTTP request.
The exported managers do not provide one transaction covering every registry.

## Options considered

- A queued in-process adapter preserves native errors, warnings, and consent callbacks while preventing dashboard writes from racing each other.
- Concurrent in-process handlers let unrelated installs proceed, but can race the same native registry while an approval waits.
- Detached CLI processes isolate installations, but require another protocol for native script questions and process ownership.

## Consequences

The page can leave and return while polling an operation in its original workspace.
No approval is inferred from the initial install confirmation, project trust, or another package's token.
Approval expires after ten minutes and terminal jobs after one hour.
An external CLI remains outside this queue.

## Confirmation

`src/extensions.test.ts` exercises deferred approval, decline, stale-token/workspace refusal, serialized changes, and native warning/failure propagation.

## Revisit when

Revisit when omp exports transactional mutations or a durable package-operation protocol.
