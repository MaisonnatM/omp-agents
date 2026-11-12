---
status: accepted
date: 2026-11-10
decision-makers: agent
---

# One ask card per form, through a runtime patch

In the context of dashboard sessions on omp 18.18.8, facing an `ask` tool that now builds an HTML form and, under RPC, walks it field by field through `select`, `input`, and `editor` frames even after the dashboard sends `set_ask_dialog`, we chose a runtime patch that gives omp's RPC UI context a `formDialog` sending the whole form as one `ask` frame, over rebuilding the form from the field-by-field frames in the dashboard and over accepting one card per field, to keep one card per `ask` call with every answer sent at once, accepting a fifth runtime patch the user must apply and rebuild after each omp upgrade.

## Context

Up to omp 18.18.1, the `ask` tool called the UI context's `askDialog`, which RPC mode turns into one `ask` frame once a host opts in with `set_ask_dialog`.
omp 18.18.8 replaced that call: `ask.ts` renders its questions as an HTML form and uses the UI context's `formDialog` when it has one, else `askFieldByField`, a chain of single prompts.
RPC mode's UI context has `askDialog` but no `formDialog`, and upstream's own RPC test expects the field-by-field chain after `set_ask_dialog`.
So a dashboard session asking three questions showed three cards in a row, could not go back to an earlier answer, and lost the multi-select checked rows that the `ask` frame carries.
The dashboard cannot change a session's in-process UI context; omp-agents keeps runtime changes as patches in `patches/`.

## Options considered

- A runtime patch, `patches/omp-18.18.8-rpc-ask-form.patch`, adding `formDialog` to RPC mode's UI context when the host enabled `set_ask_dialog`: it maps each named form field to one question of the existing `ask` frame, checks the answers with the form's own rules, and asks again only for the fields that fail, with the reason. Chosen.
- Rebuild the form in the dashboard from the field-by-field frames: the server would have to hold `select` and `input` frames back, guess which belong to one `ask` call, and answer them in omp's order, reimplementing omp's fallback protocol where [omp modules](../architecture/omp-modules.md) says the server imports omp rather than reimplementing it.
- Accept one card per field: no code to carry, but every multi-question `ask` loses its Back button and its single send, and multi-select rows arrive as repeated selects.

## Consequences

A dashboard session on the patched omp gets one `ask` frame per `ask` call; a text field becomes a question with no options, which `AskCard` opens as a text field that may be left blank to keep the field's value.
On a stock omp, sessions still work, one card per field, as before the patch.
A form field kind the `ask` frame cannot express keeps omp's rules: a choice field takes typed text only when the form allows another answer, and a wrong answer comes back in a second frame.

## Confirmation

The patch's tests in `rpc-extension-ui.test.ts`: `sends a form as one ask frame, a question per field, and returns its form data`, `asks again, with the reason, only the fields whose answers fail the form's checks`, `submits the form's defaults when the ask frame times out, and nothing when the host cancels`, and `walks the ask tool's form through select prompts until the host opts into ask dialogs`, whose second half fails on the stock release.

## Revisit when

Upstream omp gives RPC mode a `formDialog` or sends the `ask` tool's form as one frame itself, which makes the patch redundant; or the `ask` frame gains field kinds of its own.
