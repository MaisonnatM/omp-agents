# Ask about this

- Select text in a live or past session's transcript, or in a pull request's **Code** tab on the Pull requests page, and **Ask about this** shows under the end of the selection.
  It opens a discussion panel at the top right of the page, clear of the toasts below it, which leaves the rest of the page usable.
- The panel quotes the passage and names where it came from, such as `session “Fix login”` or `pull request acme/api#7 “Cache tokens”, file src/cache.ts`.
  Type a question and press Enter, or **Ask**; Shift+Enter starts a new line.
  The answer streams in under the question, with the model that answers it; **Stop** ends it early.
  Ask again for a follow-up, which carries the earlier questions and their full answers along.
- The model sees the passage, its source, and the discussion, nothing else: not the rest of the transcript, the session's files, or any tool.
  **The model sees this passage, its source, and this discussion, with no tools** opens the exact instructions and message it gets for the question you are typing.
- The answer is one model call apart from every session, with omp's `smol` model role, else its `default` role, from your user settings.
  A model that omp has no key for, or no role set, shows the reason under the question.
  The session the passage came from gains nothing from the discussion.
- In a live session the dashboard can message, each finished answer has **Send to session**, which sends the session the passage, quoted, and that answer, as the composer would send them: a queued follow-up while a turn runs, else a message.
  A past session and a pull request offer no **Send to session**.
- Esc, or the close button, closes the panel and puts focus back where it was; selecting other text and asking about it replaces the discussion.
  A discussion lasts until you close it or reload the page; nothing of it is saved.
