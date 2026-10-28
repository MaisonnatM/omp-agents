# Composer

- While a turn runs, Enter or the send button queues a follow-up until the turn finishes.
  Cmd+Enter (Ctrl+Enter on Linux and Windows), or the **Send now** button that shows beside the attach button while a draft would queue, steers the running turn immediately.
  Cmd+Enter again on the empty composer stops that turn and delivers a pending steer now, instead of leaving it behind a long reply or tool call.
  It does nothing once the agent has already taken the steer, and a follow-up still waits.
  When omp cannot hold a follow-up for a subagent, Enter steers instead.
  An idle session takes either key as a new prompt.
- A prompt sent while the dashboard is disconnected from its server comes back to the composer with its files and a note saying why.
  A prompt, answer, or start sent just before the connection drops reaches the session once when the page reconnects, never twice.
  If the server restarted, or the page stayed disconnected for over an hour, before the server answered, the page says so, and the session's transcript shows whether the prompt took effect.
- Each session and subagent keeps its own unsent text when you switch to another one or to a page, and when you reload, as chat apps keep a draft per conversation.
  The text is kept in the app and goes once you send it or empty the composer.
  The new-session draft keeps its text the same way, one for the plain draft and one for each todo it starts from, until the session it starts opens.
  Attached files and images are not kept.
- Messages that wait on the turn show above the text field, each tagged **Steer** or **Follow-up**, as Cursor lists its queue.
  Hovering a row, or focusing it, shows three buttons; a touch screen shows them always.
  **Send now** (↑ icon, or Cmd+Enter on the focused row) turns a follow-up into a steer, which the running turn takes at its next step; on a steer it stops the turn so omp runs its held steers at once.
  **Edit** (pencil, or a double-click, Enter, or F2 on the row) moves the message back into the composer, with its images; its files come back as their `<file>` blocks in the text.
  **Remove** (**×**, or Delete on the row) drops it.
  Editing or removing a queued message shrinks the queue area to fit the remaining rows, without leaving blank space above the text field.
  ↑ in the empty composer moves the last one back, the last steer before the last follow-up, as omp does.
  **Stop** and Cmd+Shift+Backspace interrupt the turn and move every waiting message back into the composer, images included, so nothing runs after an interrupt.
  In a terminal session, Stop moves back only the follow-ups the dashboard holds; a steer already sent waits in the host's queue.
- When a turn ends, its reply can suggest what to send next: a `Suggestions:` line followed by numbered prompts, as its last lines.
  The starter kit's `APPEND_SYSTEM.md` asks omp to write one when the next moves are clear, up to three.
  The transcript leaves the block out of the reply, and so does its copy button; the composer lists the prompts under its buttons, numbered, while it is empty and nothing else waits on you: no turn runs and no question is open.
  Press a prompt's number to send it at once.
  With two or more prompts, 0 sends them all as a single message, a Markdown list in list order, and so does a click on the **All of them** row under them.
  ↓ moves a highlight into the list and ↑ back out; Enter sends the highlighted prompt, Tab puts it in the composer to edit first, and Esc drops the highlight.
  A click sends it too.
  Cmd+click (Ctrl+click off macOS) marks a prompt without sending it.
  A click or a number then sends the marked prompts plus that one as a single message, a Markdown list when it holds more than one.
  Enter sends them plus the highlighted prompt, if any, and Tab puts the same text in the composer instead.
  Esc clears the marks along with the highlight.
  Typing hides the list, and clearing the draft shows it again; the next prompt you send ends it.
  The prompts send as you would type them, so a message of your own that starts with a digit needs another character first, such as a space, while the list shows.
  omp's terminal shows the block as part of the reply.
- A session that the dashboard started queues steers and follow-ups in omp itself, and the composer shows omp's own queue.
  Collab has no follow-up frame, and the host steers every guest message that arrives during a turn.
  So in a terminal session the dashboard holds a follow-up until the host reports that the turn ended, then sends it as a prompt, one per finished turn, as omp's default `followUpMode` delivers them.
  A steer goes to the host at once.
  The host shows guests no queue, so a terminal session lists only the follow-ups that the dashboard holds, not the steers waiting in the host.
  A follow-up held when the room closes shows as a warning in the conversation instead.
  Esc in the host's terminal during a tool call looks to a guest like a turn that ended, so a follow-up that the dashboard holds still runs after it.
- Sessions started from the dashboard have a model menu, as Cursor's does: the button reads the model and its effort, such as **Opus 5.5 High**.
  **Fast** turns omp's `/fast` on or off; it is greyed out for a model without a priority tier, and reads **not active** when omp has it on but the provider refused the fast tier.
  **Context** shows the model's context window and switches to a variant of the same model with another window, such as Cursor's `claude-opus-5-5` (300K) and `claude-opus-5-5-1m` (1M); models without such a variant have no Context row.
  **Effort** chooses the thinking level among the ones the live model supports.
  **Model** opens the model search beside the menu, with the cursor in its field.
  Before you type, it lists the models that your `modelRoles` and `retry.fallbackChains` name, plus the current one, grouped by provider.
  A name counts as the model omp runs for it, so a fallback of `cursor/grok-4.7-high` lists `cursor/grok-4.7`.
  The providers that `modelProviderOrder` names come first, in that order.
  Typing searches every connected model, and every word typed must appear in the model's selector, label, or name, in any order.
  Each provider's heading shows how much of its plan is used, by the tightest window of the account with the most left, since omp moves to that account, then the dollars that account spent on extra usage, as `77% used · $12.40 extra`; hover it for that account's windows and the extra usage cap.
  The list contains models that the session's omp RPC process offers from providers you are connected to, the ones omp's `/login` marks as signed in or given a key.
  Models that omp finds without a login, such as Apple's on-device model or a local Ollama, stay out of the list.
  A login made in a terminal shows the next time the menu opens.
  Each row shows the logo of the org that makes the model, its label (`Opus 5.5`), and its id, muted, to tell apart models that share a label.
  Choosing a model, a context, or an effort closes the menu.
  While a model, Fast, or Effort change runs, the picker spins and its settings wait until the server answers.
  A change that fails shows its error, and the picker takes another.
  Terminal sessions show their model and thinking level in the same place, but Collab has no frame that changes them, so make those changes in the terminal.
  Subagents have no pickers.
- The composer's bottom row starts with where the session works, left of the model menu, and shows its context counter on the right, before the clock button.
  The counter is a ring that fills clockwise beside the percent of the session's context window used.
  It turns amber at 70% and red at 90%.
  Hover or focus it to see the token count and the window size, for example `Context 10% full: 95.6k of 1m tokens`.
  The numbers are the ones that omp's status line shows.
  Dashboard sessions report them after each turn and after each model or thinking change.
  Terminal sessions report them through Collab `state` frames.
- Type `/` to complete discovered file commands and `/skill:<name>` skills; a skill whose name has a space is left out, since omp cannot invoke it.
  Type `@` to mention something: the list shows the last three files the session changed, then Files & Folders, Todos, Tickets, Pull requests, People, Email, Calendar, and Sessions.
  Picking a category narrows the list to it, which you can also type as a prefix: `@file:`, `@todo:`, `@ticket:`, `@pr:`, `@person:`, `@mail:`, `@event:`, or `@session:`.
  People lists the authors, reviewers, and review teams of the pull requests the Pull requests page lists, without you or bots, each with the pull requests they are on, so `@person:#12` finds the people on pull request 12, then your Linear workspace's active members while Linear is connected.
  Email lists your Gmail inbox's latest conversations while Gmail is connected; Calendar lists the events from today through the next 14 days, from your Google calendars while Google Calendar is connected and from this computer.
  Type `@` and a word to search everything at once: up to five files from the selected session's working directory, then up to three matches from each category.
  Every word must appear in a row's name or the detail beside it, such as a ticket's ID, in any order; quote several words, as in `@"login page` or `@ticket:"login page`.
  A file inserts its path, as in omp's terminal.
  A todo inserts its text and ID, a ticket, pull request, or email a Markdown link, a GitHub person or team their handle linked to their GitHub page, a Linear member their name and ID, an event its title, time, and calendar, linked when it is a Google event, and a session its title and ID.
  Done todos and the session you are typing in stay out of the list.
  Use arrow keys, Tab or Enter to insert a suggestion, and Esc to close the list.
  File suggestions follow Git ignore rules in Git repositories.
- In the composer, a skill or command at the start of the prompt, an `@` file or folder, an inserted todo, ticket, pull request, person, or session, and an annotation attached from the [Browser](browser.md) show as a chip, a single unit with an icon and a short name, such as the file's name or the ticket's ID and title.
  A picked suggestion is a chip at once; a reference you type becomes one once you type past it or move the caret away, so `/mo` stays text while you type `/move`.
  Typing right against a chip turns it back into text, so `/move` followed by `X` reads `/moveX`.
  The arrow keys step over a chip as over one character, Backspace removes a chip whole, undo brings it back, and the prompt you send is still the text behind each chip.
- Attach files to a prompt with the paperclip before the send button, by dropping them on the composer, or by pasting them, such as a screenshot.
  They show as tiles above the text field until you send; hover a tile for its **×**.
  PNG, JPEG, GIF, and WebP files go to the model as images, up to 32 MB per prompt.
  A text file, such as `.md`, `.txt`, `.json`, or source code, goes as its text, after what you typed, in the `<file name="…">` block that omp's `@file` writes.
  A PDF, Word, PowerPoint, Excel, or EPUB file goes as the Markdown that omp's own converter reads from it.
  Each file takes up to 32 MB, and the files' text up to a million characters per prompt; a file past that, or one omp cannot read, such as a `.zip`, stays out, and a note under the composer names it and says why.
  A prompt can be files alone.
  Steers and follow-ups carry their files too, and a queued row shows the files' names when you typed nothing.
  The new-session draft takes files for its first message.
  omp gives a subagent text only, so a subagent's composer takes text, documents included, but no image.
- Pasting more than 2,000 characters or 40 lines attaches the text as a file, `Pasted text.txt`, instead of filling the text field, as ChatGPT and Claude do; a second one is `Pasted text 2.txt`.
  Its tile shows the text's first lines, and it goes to the model as a text file does.
- A prompt's images show above it in the transcript, in live and past sessions, including images sent from omp's terminal, and its files show by name in chips above the text.
- In a session that the dashboard started, omp's built-in `/` commands run as they do in its terminal, for example `/compact` or `/usage`, and what a command prints shows as a line in the conversation.
  `!<command>` runs a shell command in the session's directory, as in omp's terminal: the command and its output show as your message, and the agent sees them in its next turn.
  omp saves a new session only with its first reply, so a new session cannot start with a `!` command.
  `!!`, which keeps the output out of the agent's context, needs the omp terminal, because omp's RPC mode has no such option.
