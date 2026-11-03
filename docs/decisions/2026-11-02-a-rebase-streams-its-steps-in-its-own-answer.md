---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# A rebase streams its steps in its own answer

In the context of the rebase loading toast, facing a request that runs for minutes while the page could only say a fixed sentence, we chose to answer `PUT /api/pull-request/rebase` with NDJSON lines, a `{ step }` line as each step starts and then one `{ done }` or `{ error }` line, over pushing the steps on the dashboard socket and over a job the page polls.
The steps and the outcome then share one ordered channel, so the outcome never overtakes its last step, and a refusal before the first step keeps its 409; we accept that an error after the first step comes back inside a 200, which `putSteps` in `web/api.ts` turns back into an `ApiError`.

## Options considered

- A streamed answer, chosen: the request that started the rebase carries its own steps, with nothing to match up and no state kept on the server.
- Socket messages keyed by pull request: they reach every open page, but they race the HTTP answer, and a page would have to match a step to the click that queued it.
- A job id the page polls: it survives a reload, but it adds a job store and a second route, and a poll interval delays each step.

## Confirmation

`src/server/http.test.ts` reads a step line from a live server before the work ends, and checks a refusal before the first step is a 409.

## Revisit when

A rebase must outlive the page that started it, or another page must watch it; a socket or a job then fits better.
