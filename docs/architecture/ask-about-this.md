# Ask about this

**Ask about this** answers a question about selected text with one model call that no session sees, unlike omp's `/btw`, which sends the whole conversation and records the exchange in the session file.
The page's `web/discussions.ts` holds the one open discussion in memory and sends each question as an untagged `discuss` socket message with an id counted per page load; `parseDiscussionRequest` in `src/server/wire.ts` holds every text to its limit in `src/shared/discussions.ts`.
The request is the passage, its source, the earlier questions with their finished answers, and the new question, and `discussionPrompt` folds all of it into one user message, which the panel shows as sent.
`Discussions` in `src/server/discussions.ts` runs `answerDiscussion` from `src/omp/discussion.ts` per question and sends its events back to the socket that asked as `discussion` messages: the model, the text in pieces, and an `end` with the error or `null`.
The answers go over the socket rather than an HTTP response, which Bun would cut after its 10-second idle timeout while a slow model writes nothing, and the handler is not awaited, so a `discuss-stop` reaches a running answer.
`discuss-stop` aborts the answer, which ends with no error, and a socket that closes aborts every answer it asked for; the page marks an answer it was waiting on as failed when its socket closes.
`answerDiscussion` resolves omp's `smol` role, else `default`, among the models with a credential, and streams with reasoning off and at most 4,096 output tokens.
**Send to session** is not part of this flow: the page sends the quoted passage and the answer as a `prompt`, as the composer does.
