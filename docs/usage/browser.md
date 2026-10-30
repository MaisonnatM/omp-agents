# Browser

The **Browser** shows the app a live session runs, its dev server, in the right sidebar beside the conversation, so you can look at a change and point at what to fix next.
It is in the [desktop app](desktop-app.md) only; the dashboard in a web browser has none.

- The **Browser** tab, after **Tickets** in the [session details sidebar](session-details-sidebar.md), shows it for the live session or subagent the sidebar follows; a past session has none.
  The page stays loaded while you switch to another tab and back, and starts again when the sidebar follows another session.
  Drag the sidebar's edge to make the Browser wider or narrower, up to 960 pixels; with two or more panes side by side the sidebar hides, and with it the Browser.
- The Browser opens on the address you last loaded for that session in the last 30 days, else on the first dev server the session runs.
  A dev server is a job or a service of the session, as the status bar's CPU card lists them, that listens on a port; omp's shared browser is never one.
  The server button lists every dev server the session runs, with its port, and picking one loads it.
  With none, the Browser says so; start one with **Start dev server** below, or type its address.
  **Start dev server**, under that message and at the bottom of the server menu, starts the project's dev server itself, in the worktree the session works in, as a service the session owns, and loads it in the Browser.
  It runs the `dev` script of the project's `package.json`, else its `start` script, with the package manager its lockfile names, bun, pnpm, yarn, or else npm, on a free port from 20000 to 39999, passed as `PORT` and, to a server that takes it, such as Vite, Next, Astro, or Nuxt, as `--port`.
  A message says what it ran, such as `bun run dev --port 23456`; a server that starts but does not listen within 30 seconds still counts as started, and the server menu lists it once it listens.
  The server is a service of the session, named `dev-` and its port, so the status bar's CPU card lists it, its **Stop** stops it, and the idle stop and the session's end stop it as any other.
  While it starts, the button shows it is busy and the menu item reads **Starting dev server…**.
  It leaves the start to the session when the script sets its own port, such as `--port 3000`, or runs several servers, such as with `concurrently` or `&`, since that port may be another checkout's or one you use.
  It does the same when the project's `.env`, `.env.local`, `.env.development`, or `.env.development.local` points the app at a server on this computer, such as `PUBLIC_API_URL=http://localhost:8000`, since the app would then talk to whatever runs there, maybe the API of another checkout; the session is asked to start that server from the same worktree on its own port too.
  When it cannot, because the project has no `package.json` or no `dev` or `start` script, for one of those reasons, or the server exits as it starts, it asks the session to run its dev server instead, with the reason and the server's last output, and a message shows the reason; a running turn gets it as a follow-up, and the Browser finds the server once it listens.
- The address field loads what you type when you press Enter; `localhost:5173` reads as `http://localhost:5173`.
  The address field loads only addresses on this computer, `localhost`, `127.0.0.1`, and `[::1]`.
  The app itself can go anywhere on the web, so a sign-in that goes through Google or another provider and comes back finishes in the Browser, and a sign-in popup opens as a small window of the app with the same sign-ins.
  When a sign-in comes back to `localhost` on the port the app runs on day to day, such as `3000`, the Browser loads the same address on the session's server instead, so the sign-in lands in the app you are testing; this happens when nothing listens on that port or another copy of the same app does.
  A sign-in that comes back to another server of yours, such as the app's API on `8000`, goes there as is.
  A link that opens a new tab opens in your default browser.
  An address that fails to load says why under the address.
- Back, Forward, and Reload work as in a browser, and the arrow button opens the current address in your default browser.
- **Maximize Browser**, the expand button, fills the app's window below its title bar with the Browser, toolbar included, and hides the rest of the page from Tab and screen readers until **Restore Browser**, the same button, or Escape, pressed in the app too, puts it back in the sidebar.
- **Pick in the app**, the pointer button, starts picking, as in T3 Code: a **Select**, **Region**, **Draw**, and **Erase** switch floats at the top of the app, and the button or Escape stops it.
  **Select**, where picking starts, outlines the element under the pointer, and a click selects it without pressing it in the app; Shift+click adds another, and a click on a selected element drops it.
  Each outline is labeled with the element's React component, else its tag with its id and first two classes, as in T3 Code.
  **Region** drags a box over part of the app, and **Draw** draws a line on it; selected elements and marks add up across modes, and **Erase** removes the box, line, or selected element you click.
  A card beside them takes a comment; **Attach**, or Enter, adds one chip to the session's composer, named after the comment, else the first element's React component or tag, else the page's title, with a picture of the marked part, and stops picking.
  The chip holds the comment, the page's address, and each element's HTML, React component with its file, and selector; hover it to read them.
  It goes after what the composer already holds, and nothing is sent until you send it.
  Escape drops the selection and the marks.
  V, R, D, and E switch to **Select**, **Region**, **Draw**, and **Erase** while picking, as in T3 Code, pressed in the app too.
- **Screenshot**, the camera button, attaches a picture of all the app shows to the composer at once.
- **Pick in the app**, **Screenshot**, and **Review visuals** carry small violet sparkles on their icon's corner, since what they make goes to the agent or comes from it.
  A picture needs the session's conversation open, since attachments live in its composer.
  When the picture cannot be taken or the conversation is closed, **Attach** adds nothing and keeps picking, with the selection and the marks, so you can try again.
- The Browser keeps its own cookies and storage across launches, apart from the dashboard's, so an app you signed in to stays signed in.

## Review visuals

- A session the dashboard started ends a reply with a list of pages to review after it changes something you should look at; the reply shows the list as a card, with each page's name and how to reach it.
- **Review visuals · N**, in the conversation's header once a reply lists pages, opens the right sidebar on the **Browser** with one tab per page, up to 8, after the session's own **App** tab, and shows the first; its tooltip names the pages.
- The tabs look like a browser's: the shown tab joins the toolbar below it, the **App** tab is pinned at the start as its icon alone, and each review tab has the sparkles the page marks the agent's work with, then its name.
- Hover a review tab, or tab to it, to show its close button; a middle click closes it too, and closing the shown tab shows the one after it, else the one before.
- Each tab keeps its page loaded while another shows, and a page's note, such as "Open the Sync tab", shows above it.
- Picking and **Screenshot** work on the tab shown, as on the **App** tab.
- A review tab does not change the address the **App** tab opens on next time.
- Clicking **Review visuals** again opens the session's latest list in place of the review tabs open.
- Only pages on this computer open; a listed address elsewhere is left out.
