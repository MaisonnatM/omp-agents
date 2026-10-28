# Preview

The **Preview** shows the app a live session runs, its dev server, in the right sidebar beside the conversation, so you can look at a change and point at what to fix next.
It is in the [desktop app](desktop-app.md) only; a browser tab has no Preview.

- The **Preview** tab, next to **PRs** in the [session details sidebar](session-details-sidebar.md), shows it for the live session or subagent the sidebar follows; a past session has none.
  The page stays loaded while you switch to another tab and back, and starts again when the sidebar follows another session.
  Drag the sidebar's edge to make the Preview wider or narrower, up to 560 pixels; with two or more panes side by side the sidebar hides, and with it the Preview.
- The Preview opens on the address you last loaded for that session in the last 30 days, else on the first dev server the session runs.
  A dev server is a job or a service of the session, as the status bar's CPU card lists them, that listens on a port; omp's shared browser is never one.
  The server button lists every dev server the session runs, with its port, and picking one loads it.
  With none, the Preview says so; start one with **Start dev server** below, or type its address.
  **Start dev server**, under that message and at the bottom of the server menu, asks the session to run its dev server as a long-lived service in the worktree it works in; a running turn gets it as a follow-up, and the Preview finds the server once it listens.
- The address field loads what you type when you press Enter; `localhost:5173` reads as `http://localhost:5173`.
  The Preview loads only addresses on this computer, `localhost`, `127.0.0.1`, and `[::1]`.
  A link in the app to any other address, and any link that opens a new window, opens in your default browser.
  An address that fails to load says why under the address.
- Back, Forward, and Reload work as in a browser, and the arrow button opens the current address in your default browser.
- **Select element**, the pointer button, turns on react-grab's picking in the app, and a click on an element adds it to the session's composer: its HTML, the React component around it with its file, and a selector.
  React-grab's **Comment** adds the element with a note you type first; the composer gets the note and then the element.
  Each pick goes after what the composer already holds, and a message confirms it; nothing is sent until you send it.
- The Preview keeps its own cookies and storage across launches, apart from the dashboard's, so an app you signed in to stays signed in.
