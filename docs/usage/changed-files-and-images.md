# Changed files and images

- A changes card sits directly above each live session's or subagent's composer, and below a past session's transcript.
  It has separate **Files** and **Images** sections, each shown only when it has items.
  Click a section's header to fold or unfold it.
  Both start open, and the browser's localStorage keeps each choice across sessions and reloads.
- **Files** lists the files the agent's `edit` and `write` calls changed, in the order it first touched them.
  Each row shows a file-type icon, the file's name, and its lines added and removed, which the header totals.
  When files share a name, muted parent folders distinguish them.
  The tooltip shows the full path, whether the session created, edited, or deleted the file, how often it changed, and how long ago.
  As in the session's changes, a count of zero is left out, so a file the agent only added to shows `+12` alone.
  A path inside the session's working directory shows relative to it.
  Click a file to open the [session's changes](session-changes.md) at that file, or **Review** at the first file.
  A subagent has no changes of its own checkout and no **Review** button.
  Clicking its file opens the changes omp recorded instead, newest first, with each change's kind, time, line counts, and numbered diff.
  That dialog follows the file while the agent keeps editing it, and Esc closes it.
  A write replaces the whole file and records no diff, so it shows how many lines it wrote instead.
  A write counts as creating the file when the session had not read or changed that path before, since omp does not record whether the file existed; a created file counts every line it wrote as added, and a later write over it counts none.
  A failed call, and a write to something other than a file, such as an `agent://` message, count for nothing.
  The file list scrolls within the card, keeping its header and the composer visible.
- Subagents are not listed here; open one from its link in the transcript, under the call that spawned it.
- **Images** shows a horizontal thumbnail strip of the images that the agent's tools returned and those of its subagents at any depth, newest first: browser screenshots from `eval`, and image files that `read` opened.
  It also shows the image files the session wrote that a tool call or its result named, such as the `page.png` a script saved; a named file counts as written when it changed after the session started, so paths in source code and older files stay out.
  Each file shows once, at the first time a tool named or returned it.
  On a session that is every image of the session; on a subagent it is that subagent's and its own subagents'.
  Images you attached to your own prompts are left out, since the transcript shows them.
  Each thumbnail's tooltip names the agent and tool, the image's age, and its file path when it has one.
  Click one to see it large, with the tool, its file's name, and what the call said it did; the arrows, or the Left and Right keys, step to newer and older images.
  **Open agent** opens the live agent that took it, unless the pane already shows that agent, and the external-link button opens the image in a new tab.
  New images show up while the agents run.
  Hover or focus a thumbnail to show its checkbox; once one image is selected, every checkbox shows and a click on a thumbnail selects it instead of opening it.
  The bar above the images counts the selection and sends it, in the order you selected it.
  **Add to PR description** lists the session's pull requests by number and title, and appends the images to the one you pick with `gh pr edit --attach`; it takes PNG, JPEG, GIF, WebP, and SVG images of up to 10 MB, 50 at a time.
  An image with a file on this computer goes as that file, under its name and with its name as alt text; any other goes as shown, with the call's summary as alt text.
  **Attach to Linear issue** lists the session's issues, and attaches each image to the one you pick, as the new-issue dialog attaches files; the images Linear refused stay selected.
  Either button is disabled, with a tooltip saying why, when the session has no pull request or no issue; **Clear** empties the selection.
