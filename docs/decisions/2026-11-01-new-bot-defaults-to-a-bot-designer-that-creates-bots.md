---
status: accepted
date: 2026-11-01
decision-makers: user, agent
---

# New Bot defaults to a Bot designer that creates Bots

In the context of making a new Bot, facing a blank form where the user must write a good job alone, we chose a third Bot type, `bot-designer`, preselected on the New Bot form and filled with Dr Eggbot's name and job, whose own `create_bot` tool creates the Bots it designs.
We rejected adding Dr Eggbot as a job template under Routines, because such a Bot could only write a job for the user to paste, and rejected sending New Bot straight into one shared designer conversation, because it would replace the form everyone uses today.
We accept that each New Bot now starts as another designer until the user picks another type, and that a designer's one tool creates Bots, so it never edits or deletes one.

## Context

Dr Eggbot is a Grok Bot by Lauren Tan, published at https://x.ai/bot/marketplace/bots/dr-eggbot-v2, that asks a few preference questions and then creates the Bot.
Before this change a Bot could set only its own job, its own routines, and its memory, so none could create another Bot.
omp registers an extension's tools before it sets its flags, so a tool only some Bots have needs its own extension, as the PR shepherd's does.

## Options considered

- A `bot-designer` type with a `create_bot` tool, preselected.
  It gives the user the designer's interview and a real Bot at the end, at the cost of a new extension and a new inbox request.
- Dr Eggbot as the first job template, preselected.
  It is one array entry, but the resulting Bot cannot create anything.
- New Bot opens one shared Dr Eggbot conversation, with the form behind a link.
  It is the closest copy of Grok, but changes how every Bot is made and needs a Bot the app creates on its own.

## Consequences

The designer's tool leaves a request in `bot-inbox/` beside the `set_job` requests, so the server stays the only writer of `bots.json` and a new PR shepherd still gets its routine from the same save.
The tool mints the new Bot's id, so a request replayed after a restart creates the Bot once; an id that already exists is never edited.
The server sets aside a create from a Bot that is not a designer as misrouted; it guards against a request in the wrong place, and is no permission, since only a designer's session has the tool.
The job is adapted to this app: Grok-only parts, such as templates, webhooks, and healthcheck routines, are left out.

## Confirmation

`src/server/bot-inbox.test.ts` covers a designer's create, a misrouted create from another type, and a replay; `src/omp/designer-extension.test.ts` covers the tool.

## Revisit when

Users mostly switch the type back to Routines, which would make a template or a separate designer entry the better default.
