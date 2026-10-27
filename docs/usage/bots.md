# Bots

- A Bot is a named teammate with one conversation you come back to, a job, and a memory.
- The sidebar's **Bots** tab, just before **Sessions**, lists every Bot like a messaging app, whatever workspace the sidebar shows.
  Each row shows the Bot's avatar, its name, the time of its last message, and that message on one muted line.
  The line reads **You:** before your own words, **Working…** while the Bot works, or the question it waits on you for, in amber.
  A blue dot marks a reply you have not read, and the most recent conversation comes first.
  The tab counts the Bots that wait on your answer.
- Each Bot's avatar is a colored shape with two eyes, which you pick when you make it and can change later, so a rename keeps its face.
  A Bot made before you could pick keeps the shape and color its id gave it.
  The avatar bobs and glances while the Bot works, or pulses gently when your system asks for reduced motion, and an amber dot marks a question waiting on you.
- The search field at the top of the tab filters the Bots by name, job, or the line under the name.
  The **+** beside it, or a `#bots/new` address, opens the New Bot form.
  Until the server sends the Bots, the tab reads **Loading your Bots…**.
- `#bots`, the **Bots** tab's own page, is a gallery of every Bot as a card, as Grok's companions.
  Each card shows the Bot's avatar, its name, the first sentence of its job or **No job yet**, whether its session runs or the question it waits on you for, its routine count, and the time of its last message.
  Click a card to open the Bot's page.
  The last card, and **New Bot** in the header, open the New Bot form.
  Deleting a Bot returns to the gallery.
- New Bot follows Grok's: name the Bot, pick a shape and a color, and choose **Create**; the form starts on a random shape and color.
  Its optional **Job** field starts empty, and a template above it, **PR reviewer**, **Daily retro**, **Worktree janitor**, or **Release watcher**, fills it, and the name while the name is empty.
  It also asks for the workspace its conversation runs in, the sidebar's workspace by default.
  **Create** saves it and opens its page, `#bots/<id>`.
  A Bot made with no job learns it from you: tell it in your first message what to do, where to look, and what to ask before acting, and it remembers that.
- A Bot's page shows its avatar and name in the header, the first sentence of its job under them, and its conversation below.
  The conversation reads as a chat: it shows your messages and the Bot's replies, never its tool calls or thinking, whatever **Show tool calls** and **Show thinking** say.
  The Bot's conversation is not listed in the **Sessions** tab, the command palette, or the workspace list; only its Bot's page shows it.
  A new Bot greets you and offers three starters, built from its job, or asking what its job should be while it has none, which the composer lists under its action bar as it lists suggested prompts.
  The composer reads **Message** and the Bot's name.
  While its session runs, the conversation and its composer work as in a pane.
  Otherwise the composer writes to the Bot: the first message starts its conversation in its workspace, and a later one resumes the same session.
  What you type there stays when you leave the page, one draft per Bot, until you send it.
  Its `/` and `@` menus work as in any composer, resolved in the Bot's workspace, so you can mention a file, todo, ticket, pull request, person, email, event, or session.
  Where the Bot used its `remember` tool, the conversation shows **Updated memory for** and the Bot's name.
- The right sidebar shows the Bot's details, as it shows a session's on the panes.
  Click the Bot's name in the header, the button at the header's end, or press Cmd+Alt+B to show or hide it; it keeps the width and open state of the session details sidebar.
  The details start with the avatar, the name, whether the Bot's session runs, and its workspace.
  Click the avatar to change its shape and color; the avatar follows each pick, and closing the popover saves the last one.
  Click the name to rename it: Enter or leaving the field saves, and Escape puts the name back.
  Below come its **Job**, its **Memory**, its **Routines**, **End session** while its session runs, and **Delete**.
  Editing the job shows **Save job** and **Revert**; every turn's system prompt carries the saved job.
  **Memory** lists what the Bot keeps in `bots/<id>/memory.md` under the data directory, newest last, each with its date; for a long memory it lists the newest 16 KB, the part the Bot reads.
  Only the Bot writes it, with its `remember` tool, when you tell it something worth keeping.
  **Routines** lists the Bot's routines, each with its last run's dot, its schedules and triggers, and when it last ran and what that run did, or **Not run yet**; **New routine** opens the editor of a new one, `#bots/<id>/routines/new`.
  Click a routine to open it in place of the conversation, `#bots/<id>/routines/<routine id>`, and the details mark it; **Edit** in its menu opens its editor at `#bots/<id>/routines/<routine id>/edit`, so Back returns to the routine.
  An address that names a routine the Bot does not have, such as one deleted, shows that, with a link back to the conversation.
  Saving a routine opens it once the server has saved it; a save it refuses says why and keeps the editor open.
  Ending the session keeps the page open.
- **Delete** asks first, and says that the Bot's routines go with it.
  Deleting a Bot forgets it and deletes its routines, but its conversation stays one of your sessions, and its memory file stays.
- Every routine belongs to a Bot: on a schedule, or when a Slack message, a pull request, a calendar event, or unread mail triggers it, it messages the Bot, or runs a command in the Bot's workspace and posts the output into its conversation; see [Routines](routines.md).
- The server keeps the Bots in `bots.json` beside its access token, so every window of the app shows the same ones.
