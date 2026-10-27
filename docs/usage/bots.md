# Bots

- A Bot is a named teammate with one conversation you come back to, a job, and a memory.
- The sidebar's **Bots** tab, just before **Sessions**, lists every Bot like a messaging app, whatever workspace the sidebar shows.
  Each row shows the Bot's avatar, its name, the time of its last message, and that message on one muted line.
  The line reads **You:** before your own words, **Working…** while the Bot works, or the question it waits on you for, in amber.
  A blue dot marks a reply you have not read, and the most recent conversation comes first.
  The tab counts the Bots that wait on your answer.
- Each Bot's avatar is a colored shape with two eyes, both picked from its id, so a rename keeps its face.
  The avatar bobs and glances while the Bot works, or pulses gently when your system asks for reduced motion, and an amber dot marks a question waiting on you.
- The search field at the top of the tab filters the Bots by name.
  The **+** beside it, or a `#bots` address, opens the New Bot form.
- The New Bot form asks for a name and a job, then the workspace its conversation runs in, the sidebar's workspace by default.
  **Create Bot** saves it and opens its page, `#bots/<id>`.
- A Bot's page shows its avatar and name in the header, and its conversation below.
  A new Bot greets you and offers three starters built from its job, which the composer lists under its action bar as it lists suggested prompts.
  The composer reads **Message** and the Bot's name.
  While its session runs, the conversation and its composer work as in a pane.
  Otherwise the composer writes to the Bot: the first message starts its conversation in its workspace, and a later one resumes the same session.
  Where the Bot used its `remember` tool, the conversation shows **Updated memory for** and the Bot's name.
- Clicking the Bot's name opens its details: its workspace, its **Job**, its **Memory**, its **Routines**, **End session** while its session runs, and **Delete**.
  Editing the job shows **Save job** and **Revert**; every turn's system prompt carries the saved job.
  **Memory** lists what the Bot keeps in `bots/<id>/memory.md` under the data directory, newest last, each with its date.
  Only the Bot writes it, with its `remember` tool, when you tell it something worth keeping.
  **Routines** lists the routines that send their prompt to the Bot; click one to open it.
  Ending the session keeps the page open.
- **Delete** asks first.
  Deleting a Bot forgets it, but its conversation stays one of your sessions, and its memory file stays.
- A routine can send its prompt to a Bot in place of a new session; see [Routines](routines.md).
- The server keeps the Bots in `bots.json` beside its access token, so every window of the app shows the same ones.
