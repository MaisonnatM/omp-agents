---
status: accepted
date: 2026-11-04
decision-makers: Maxence
---

# Bots end routine runs quietly with a tool

In the context of a Bot whose routines wake it several times a day, facing the PR shepherd raising a desktop notification and an unread mark on every run, even one that printed NOTHING NEW, we chose a `stay_quiet` tool that a Bot calls in a turn that found nothing, over matching a reply such as "Nothing new." and over a routine setting that never notifies.
It keeps the decision with the Bot, which knows whether the run found something, accepting that a Bot whose job does not mention the tool still notifies on every run.

## Context

Every ended turn marks its session unread, and an unread turn raises a session notification.
A routine posts its prompt or command output into the Bot's conversation, so each run is a turn like any other.
The same routine can find nothing on one run and a pull request that needs you on the next, so the routine alone cannot tell.

## Options considered

- Match a sentinel reply, such as "Nothing new.": rejected, since any wording change breaks it and a real reply could start with it.
- A per-routine "never notify" setting: rejected, since it also hides the runs that found something.
- A Bot tool whose call the turn's messages show: chosen.

## Consequences

A quiet turn gives back the unread turn its start read, so a run that found nothing leaves an earlier unread reply unread.
That held turn lives in memory only, so a server restart during the run loses it and the session reads as read.
The PR shepherd's starting job asks it to stay quiet; an existing Bot needs the same line in its job.
A run that calls the tool and then also tells the user something stays quiet, so the tool's description says never to do that.

## Confirmation

`src/live-session.test.ts` checks that a run calling `stay_quiet` ends quietly, live and from a session file, and `src/server/live-sessions.test.ts` checks that a quiet end gives back the earlier unread turn, while a look or a turn that ends aloud reads it for good.

## Revisit when

omp lets an extension mark a turn's end itself, or routines need quiet runs without a Bot.
