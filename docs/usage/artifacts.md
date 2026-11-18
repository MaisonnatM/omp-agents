# Artifacts

An artifact is a page, a document, or a drawing the agent saves for you to look at beside the conversation, such as a mockup, a report, or a diagram.
Each save keeps a version, so you can step back through what the agent changed.

- The agent writes an HTML, Markdown, or SVG file under `local://`, then calls its `artifact` tool with the file, a title, and an optional note on what changed.
  Saving the same file again adds a version; a subagent cannot save one.
  A saved version stays as it was, even when the agent edits the file again.
- The conversation shows each save as a card with the kind's icon, the title, and a line such as **HTML · Version 2 · Pro tier stands out**; click the card to show that version.
  **Open** shows at the card's right on hover, and **Showing** stays there, with a darker border, while the sidebar shows that version.
- The **Artifacts** tab of the [session details sidebar](session-details-sidebar.md) shows once the session saved one, with a badge counting its artifacts.
  When the agent saves a version in the view the sidebar follows, the sidebar opens on the tab and shows the new version.
  A card shows its version; in a pane beside others, it first maximizes that pane, since side-by-side panes hide the sidebar.
- The tab's top bar names the shown artifact with its kind's icon; with two or more, the name opens a menu of them, the most recently saved first, each with its version count, and picking one shows its latest version.
- **Preview** shows the version as it looks, and **Source** shows its text with line wrapping and colors, as a drawn code block in a reply does.
  The version fills the tab from edge to edge: an HTML page runs in a sealed frame, where its scripts and forms work but it cannot reach the dashboard, your sign-in, or other sessions.
  An SVG shows as an image, without its scripts, on a light gray ground, and Markdown reads as a document, in a centered column with larger headings and roomy lines.
  A click on an image inside an HTML page, or on an SVG, opens it over the whole window, where you can zoom and step through the page's other images with ← and →.
- **Copy** copies the version's text, **Download** saves the file, and **Open in browser** opens it in a browser tab of its own; each names itself on hover.
- The bar at the bottom steps through versions: the ‹ and › arrows show the older and newer one, and **Version N of M** opens a menu of every version, newest first, with its note and when it was saved.
  Beside it, the shown version's note, then its kind, size, and save time, or **Go to latest** while an older version shows.
  Each new save shows the new version, even when you had picked an earlier one.
- In a narrow sidebar, the name takes a row of its own above **Preview**, **Source**, and the actions; below 30rem **Preview** and **Source** keep only their icons and the bar drops the kind, size, and save time.
- A version whose saved copy was deleted, such as one a fork inherited from a session since deleted, reads **This version's saved copy is gone. Pick another version.**, and its **Copy**, **Download**, and **Open in browser** are off.
- A past session shows its artifacts too, and a fork shows those of the session it came from.
- A Bot's page shows no artifact lines and no tab.
