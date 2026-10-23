# Session changes

- A click on a file in the sidebar's **Files** tab shows the files the session changed as an editor does, in a dialog over the page, at that file; Esc or the close button closes it.
- The dialog knows two sets of files.
  One is what the session's git checkout changed: its worktree, else its directory, against the commit its branch forked from the remote's default branch, else against `HEAD`, else against nothing before the first commit, with uncommitted and untracked files included.
  The other is what the session's own `edit` and `write` calls changed, from its transcript, including files outside the checkout and files changed back to how they were.
  The header names the branch and the base it compares against, and totals the files and the lines added and removed.
- The dialog opens on **This session**, which keeps only the files the session's own calls changed, as the Files tab lists them; **All changes** shows both sets; edits that a subagent or a shell command made count only under **All changes**.
- The explorer on the left shows the files as folders, a folder holding only one folder joined with it, such as `web/components/changes`.
  Click a folder to close or open it.
  Each file shows its lines added and removed, a blue dot when the session's own calls changed it, and a letter for what git says happened: **A** added, **U** untracked, **M** modified, **D** deleted, and **S** for a file only the session's calls name, outside the checkout or no different from the base.
  A file outside the checkout shows under a `~` or `/` folder.
  ↓ and ↑ move to the next and previous file in the explorer's order, outside text fields, and open the folders above it; the explorer marks the file at the top of the diffs as you scroll them.
  Drag the line between the explorer and the editor, or focus it and use the left and right arrow keys, to size the explorer between 180 and 560 px; double-click it to reset, and the browser's localStorage keeps the width.
- The editor shows the open file's path above it, with **Diff** and **File** to choose how; the choice is remembered.
  **Diff**, the default, lists every file's changes in one scroll, as GitHub does, each under a header that stays on top while its diff scrolls under it; click a file in the explorer to jump to it, and the chevron on its header to hide or show its diff.
  Each diff shows both line numbers, removed lines red and added lines green, and three unchanged lines around each change; click **Show N unchanged lines** to unfold a run.
  A file reads only once it scrolls near the view, and one changing more than 2000 lines waits for **Load diff**.
  **File** shows the open file whole as it is now: a green bar beside added lines, a blue bar beside lines that replaced others, and a red notch where lines were removed.
  Click anywhere on a bar, or on a notch, to show the removed lines above the change, struck through.
  The strip on the right maps every change in the file, lines removed at its end at the bottom; click a mark to scroll to it.
- Both views color the code by its language.
  A binary file, a file over 1 MB, and a file git cannot compare show why instead.
  A file only the session's calls name shows whole, with nothing marked, since there is no base to compare it with.
- The dialog reads the changes again each time the session's own calls change a file, and when a turn starts or ends, since a shell command or a subagent changes files without telling the dashboard; the round arrow in the header reads them again now.
  Clicking a file in the explorer, or ↓ and ↑, jumps to it in place.
