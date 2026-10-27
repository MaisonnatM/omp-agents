# Bots

- A Bot is a named teammate with one conversation you come back to, a job, and a memory.
- The sidebar's **Sessions** tab lists the Bots under **Bots**, above the scheduled sends, whatever workspace the sidebar shows.
  Each row shows the Bot's initial on a color picked from its id, and a status dot while its conversation runs.
  **New Bot** at the end of the group, or a `#bots` address, opens the New Bot form.
- The New Bot form asks for a name, the workspace its conversation runs in, and its job.
  **Create Bot** saves it and opens its page, `#bots/<id>`.
- A Bot's page shows its conversation, with the Bot's name and state in the header: the session's status while it runs, **Not running, a message resumes it** once it ended, or **No conversation yet**.
  While its session runs, the conversation and its composer work as in a pane.
  Otherwise the composer below the conversation writes to the Bot: the first message starts its conversation in its workspace, and a later one resumes the same session.
  Ending the session keeps the page open.
- The panel beside the conversation shows the Bot's workspace, its **Job**, its **Memory**, and its **Routines**.
  Editing the job shows **Save job** and **Revert**; every turn's system prompt carries the saved job.
  **Memory** lists what the Bot keeps in `bots/<id>/memory.md` under the data directory, newest last, each with its date.
  Only the Bot writes it, with its `remember` tool, when you tell it something worth keeping.
  **Routines** lists the routines that send their prompt to the Bot; click one to open it.
- **Delete** in the header asks first.
  Deleting a Bot forgets it, but its conversation stays one of your sessions, and its memory file stays.
- A routine can send its prompt to a Bot in place of a new session; see [Routines](routines.md).
- The server keeps the Bots in `bots.json` beside its access token, so every window of the app shows the same ones.
