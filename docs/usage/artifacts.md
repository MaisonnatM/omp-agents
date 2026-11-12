# Artifacts

An artifact is a page, a document, or a drawing the agent saves for you to look at beside the conversation, such as a mockup, a report, or a diagram.
Each save keeps a version, so you can step back through what the agent changed.

- The agent writes an HTML, Markdown, or SVG file under `local://`, then calls its `artifact` tool with the file, a title, and an optional note on what changed.
  Saving the same file again adds a version; a subagent cannot save one.
  A saved version stays as it was, even when the agent edits the file again.
- The conversation shows each save as its own line, **Saved** with the title **as version N**, and an **Open** chip; see [Conversations](conversations.md).
  While the sidebar shows that version, the chip reads **Showing**.
- The **Artifacts** tab of the [session details sidebar](session-details-sidebar.md) shows once the session saved one, with a badge counting its artifacts.
  When the agent saves a version in the view the sidebar follows, the sidebar opens on the tab and shows the new version.
  **Open** on a card shows its version; in a pane beside others, it first maximizes that pane, since side-by-side panes hide the sidebar.
- With two or more artifacts, a row of tabs above names each by its title, the most recently saved first; picking one shows its latest version.
- Under the tabs, the version's title, then its file, its kind, its size, and when it was saved.
  **Copy** copies the version's text, **Download** saves the file, and **Open in browser** opens it in a browser tab of its own.
- **Version** lists the artifact's versions by number; hover one for its note and when it was saved, and click it to show it.
  Each new save shows the new version, even when you had picked an earlier one.
- **Rendered** shows the version as it looks, and **Source** shows its text with line wrapping and colors.
  An HTML page runs in a sealed frame: its scripts and forms work, but it cannot reach the dashboard, your sign-in, or other sessions.
  An SVG shows as an image, without its scripts, and Markdown shows formatted as the conversation formats messages.
- In a narrow sidebar, **Copy**, **Download**, **Open in browser**, **Rendered**, and **Source** keep only their icons, and the note moves to its own line.
- A version whose saved copy was deleted, such as one a fork inherited from a session since deleted, reads **This version's saved copy is gone.**
- A past session shows its artifacts too, and a fork shows those of the session it came from.
- A Bot's page shows no artifact lines and no tab.
