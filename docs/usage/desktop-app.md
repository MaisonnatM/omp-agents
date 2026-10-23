# Desktop app

The packaged app, or `bun run desktop` from a checkout, shows the dashboard in its own window; see the [README](../../README.md#desktop-app) to install it.

- The window is the same page as a browser tab, on the same address, `http://127.0.0.1:<port>`.
  It keeps its own localStorage, so folded sections, the sidebar widths, the theme, and the pinned skill start fresh in the window and stay apart from a browser's.
- At launch, the app asks the port for the dashboard's sign-in.
  When an omp-agents server answers, the window uses it, and quitting the app leaves it running.
  When nothing listens, the app starts the server, the one it ships or its checkout's, and stops it when you quit.
  When something else answers, the window says that the port is taken, with **Retry**.
  When the server that the app started stops on its own, or fails to start, the window shows the end of its output, with **Retry**.
  When the dashboard does not load, for example on a reload after the server it used stopped, the window says so, with **Retry**.
- On macOS, closing the window hides it: the server, the sessions it started, and its Collab guests keep running.
  Click the app in the Dock, or run `bun run desktop` again, to show it.
  Cmd+Q quits the app; when the app started the server, it waits for the server to write what it keeps and let go of its sessions.
  The sessions it started keep running, a running turn included, and show live again when the app opens; **End session** is how a session stops.
  Off macOS, closing the window quits.
- In the packaged app on macOS, **omp agents › Open at Login** starts the app, and with it the server, when you log in.
  The app reads `PATH` and the rest of its environment from your login shell at each start, so a change to your shell profile applies at the next launch.
- In the packaged app, **omp agents › Check for Updates…** checks GitHub Releases now; the app also checks on its own, downloads an update in the background, and shows **Restart to Install** once it is ready.
  **Install omp Starter Kit…** installs the starter kit from `templates/omp/` into omp's agent directory.
- Every link to another site opens in the default browser, and so does an integration's sign-in page.
  The window never leaves the dashboard.
- Cmd+W closes the window, Cmd+R reloads it, Cmd+Q quits, Cmd+M minimizes, and Cmd+0, Cmd++, and Cmd+- set the zoom.
  The menu takes none of the dashboard's own shortcuts.
  Right-click in a text field for cut, copy, paste, and spelling suggestions, and on an image, such as one in the **Images** section's viewer, for **Copy Image**.
- The window remembers its size and position.
- The window title follows what the page shows, and a browser tab's title does too: the focused session's name, a subagent's name ahead of its session's, `Pull requests`, `Tickets` or the open ticket's identifier, `Todo`, `Settings`, or `New session`, then `omp agents`.
  A session without a name reads as its workspace, and nothing open reads `omp agents`.
- The Dock, the menu bar, and Cmd+Tab show `omp agents` and the dashboard's icon, not Electron's.
- Alt+Shift+Cmd+T, from any app, brings the window up with the command menu's **Create todo** open, so you can type a title and press Enter to create a todo.
  When another app holds the keys, the app logs so and the shortcut does nothing.
- The Dock icon's badge counts the sessions waiting on you: each that asks you something, or finished a turn you have not looked at since, a project's workers left out, and goes away at none.
  The **Todo** page's header still counts the open todos.
