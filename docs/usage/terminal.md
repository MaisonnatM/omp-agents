# Terminal

- The terminal is a panel under the panes, between the two sidebars, with a tab for each shell.
  **Terminal** in the bottom strip, Ctrl+\` on every platform, or **Toggle terminal** in the command menu shows or hides it.
  Ctrl+\` works from inside the terminal too, and on macOS so does every Cmd shortcut, since a shell reads no Cmd key; on Linux and Windows every other Ctrl key goes to the shell.
- Each tab runs your login shell (`$SHELL -l`) on the dashboard server, in the focused session's worktree, else its directory, else the sidebar's workspace, else your home directory.
  The tab is named by that directory; hover it for the full path.
  `+` opens another tab in the same place, and the shell gets neither the server's `PORT` nor `OMP_AGENTS_PARENT`, so a dev server it starts does not reach for the dashboard's port.
  A new tab shows **Starting shell…** until the server opens its shell.
  The server refuses a new shell in a directory that no longer exists, such as a removed worktree, and while 16 shells already run; that tab reads that the server hung up on it.
- A shell keeps running while the panel is hidden and across a page reload: the reloaded page reopens a tab for each shell with its last megabyte of output.
  If the page cannot read which shells run, the panel says so with **Try again** and starts no shell, so a running shell is never left without its tab.
  It ends when you type `exit`, when the tab's × hangs up on it, or when the server stops; the last tab closing hides the panel.
  The close button spins until the tab closes, and closing a tab that still shows **Starting shell…** ends the shell the server opens for it.
  A tab whose server stopped reads **(disconnected)** until you close it.
- Drag the panel's top edge, or focus it and press ↑ or ↓, to change its height; double-click the edge to reset it.
  Its height, and whether it shows, is saved in the app.
