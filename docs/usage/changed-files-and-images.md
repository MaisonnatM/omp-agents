# Changed files and images

- The **Todos** card at the top right of each live session's, subagent's, or past session's conversation, or above its messages when the conversation is narrow, lists what the agent changed, took, and opened under its todo list.
  It has separate **Files**, **Images**, and **Sources** sections, each shown only when it has items; the card shows once any of them, or the todo list, has something to show.
  Click a section's header to fold or unfold it.
  Each starts open, and the app keeps each choice across sessions and reloads.
  The card scrolls as a whole when its sections outgrow it.
  **Show todos card** in Settings › Preferences hides only the todo list; these sections stay.
  A Bot's page, which reads as a chat, leaves these sections out, and the card hides while the trajectory takes the transcript's place.
- **Files** lists the files the agent's `edit` and `write` calls changed, in the order it first touched them.
  Each row shows a file-type icon, the file's name, and its lines added and removed, which the header totals.
  When files share a name, muted parent folders distinguish them.
  The tooltip shows the full path, whether the session created, edited, or deleted the file, how often it changed, and how long ago.
  As in the session's changes, a count of zero is left out, so a file the agent only added to shows `+12` alone.
  A path inside the session's working directory shows relative to it.
  Click a file to open the [session's changes](session-changes.md) at that file, or **Review** at the first file.
  A subagent has no changes of its own checkout and no **Review** button.
  Clicking its file opens the changes omp recorded instead, newest first, with each change's kind, time, line counts, and numbered diff.
  Each recorded edit uses a Kobra-inspired diff card with old and new line numbers, syntax colors, and a horizontal code scroller.
  Added lines have a green tint and solid edge mark; removed lines have a red tint and hatched edge mark.
  The signs distinguish additions and removals without color, and an ellipsis separates hunks where omp omitted unchanged lines.
  That dialog follows the file while the agent keeps editing it, and Esc closes it.
  A write replaces the whole file and records no diff, so it shows how many lines it wrote instead.
  A write counts as creating the file when the session had not read or changed that path before, since omp does not record whether the file existed; a created file counts every line it wrote as added, and a later write over it counts none.
  A failed call, and a write to something other than a file, such as an `agent://` message, count for nothing.
  The file list scrolls within the card, keeping its header visible.
- Subagents are not listed here; open one from its link in the transcript, under the call that spawned it.
- **Images** shows a horizontal thumbnail strip of the images that the agent's tools returned and those of its subagents at any depth, newest first: browser screenshots from `eval`, and image files that `read` opened.
  It also shows the image files the session wrote that a tool call or its result named, such as the `page.png` a script saved; a named file counts as written when it changed after the session started, so paths in source code and older files stay out.
  Each file shows once, at the first time a tool named or returned it.
  On a session that is every image of the session; on a subagent it is that subagent's and its own subagents'.
  Images you attached to your own prompts are left out, since the transcript shows them.
  Each thumbnail's tooltip names the agent and tool, the image's age, and its file path when it has one.
  Click one to see it large, with the tool, its file's name, and what the call said it did; the arrows, or the Left and Right keys, step to newer and older images.
  **Open agent** opens the live agent that took it, unless the pane already shows that agent, and the external-link button opens the image in your default browser.
  New images show up while the agents run.
  Hover or focus a thumbnail to show its checkbox; once one image is selected, every checkbox shows and a click on a thumbnail selects it instead of opening it.
  The bar above the images counts the selection and sends it, in the order you selected it.
  **Add to PR description** lists the session's pull requests by number and title, and appends the images to the one you pick with `gh pr edit --attach`; it takes PNG, JPEG, GIF, WebP, and SVG images of up to 10 MB, 50 at a time.
  An image with a file on this computer goes as that file, under its name and with its name as alt text; any other goes as shown, with the call's summary as alt text.
  **Attach to Linear issue** lists the session's issues, and attaches each image to the one you pick, as the new-issue dialog attaches files; the images Linear refused stay selected.
  Either button is disabled, with a tooltip saying why, when the session has no pull request or no issue; **Clear** empties the selection.
- **Sources** lists the web pages and remote items the agent and its subagents at any depth opened, each address once, oldest first.
  It counts a `read` or fetch of a web address, a page the browser opened from `eval`, a GitHub pull request or issue read through `pr://` or `issue://`, and the web addresses in the arguments of an MCP call that gets, reads, fetches, finds, or analyzes something.
  A failed call, a page on this computer such as a dev server, and search results the agent never opened are left out, and so are the session's own pull requests and Linear issues, which the [session details sidebar](session-details-sidebar.md) shows.
  Each row shows the site's icon, the site, and the page's path; its tooltip names the full address, the agent and tool, what the call said it did, and how long ago.
  The dashboard's server fetches the icons from the sites themselves, so no outside icon service learns which sites a session opened; a site without one shows a globe.
  Click a row to open the page in your browser; the list scrolls within the card.
