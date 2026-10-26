# Panes, splits, and links

- Select a row to open it.
  The selection is in the URL hash, so a reload or a bookmark returns to it.
  A past session's hash is `#past/<session id>`.
  A live session's hash names its host, so it stops working when the host ends.
  `#session/<session id>` names the session itself: it opens the live session when a host runs it, else its saved transcript.
- Cmd-click a row (Ctrl-click on Linux and Windows), or choose **Open in split** from its menu, to open it in another pane.
  Up to four conversations share the page: one fills it, two sit side by side, and three or four form a 2x2 grid.
  Each pane scrolls on its own, and its composer sends to its own session or subagent.
  A plain click on a row outside the split opens it alone, full width, and the page remembers the split.
  A plain click on any session of that split later brings the split back, in the same order and sizes, with that session focused.
  Closing a pane, or ending its session, forgets the split it belonged to, and a new split that shares a session replaces the older one.
  Back and forward return to the exact panes in the hash.
  Click or tab into a pane to focus it.
  A new session or a fork opens in the focused pane.
  With four panes open, Cmd-click and **Open in split** replace the focused pane.
  A row that is already open focuses its pane instead of opening a second copy.
  The **×** in a pane's header closes it.
  Closing the second-to-last pane returns to a single conversation.
- Right-click a row in the sessions sidebar, or focus it and press the context-menu key or Shift+F10, for its quick actions.
  Every row offers **Open** and, when the row is not on screen yet, **Open in split**.
  A running session adds **Pin** (**Unpin** once pinned), its pull requests on GitHub, **Workspace settings**, **Copy path**, **Copy session ID**, and **End session** when the dashboard can end it.
  A past session adds **Resume**, which opens its transcript and continues it as the header's **Resume** does, then the same pin, links, and copies.
  An interrupted session adds **Move to past** after **Resume**.
  Elsewhere on the page, right-click shows the window's own menu, as [Desktop app](desktop-app.md) describes.
- Drag the line between the columns, or between the rows, to resize the panes; each side keeps at least 320 px of width or 160 px of height.
  The lines also take focus: the arrow keys move them, Shift with an arrow moves them further, and Home and End move them to either limit.
  Double-click a line to return it to the middle.
  Each split keeps its own sizes while the page is open, and the sizes of the split on screen are stored in the app, so they survive a reload.
- The maximize button in a pane's header makes that pane fill the page.
  The other panes keep running behind it, with their drafts and scroll positions, and the restore button or Esc brings the split back exactly as it was.
  A plain click on a row outside the split opens it alone, as above; a remembered split comes back unmaximized.
  Cmd-click and **Open in split** bring the split back.
  Closing the maximized pane brings the split back too.
- The hash holds every pane, in order, separated by commas, and `@<n>` names the focused pane counting from 0, for example `#7c51f77b,past/01a0f6a5@1`.
  A maximized pane adds `;max`, for example `#7c51f77b,past/01a0f6a5@1;max`, so back, forward, and reload return to it.
  With one pane the hash is the single-view form above, so older links still open.
  **Settings** takes over the page and leaves the panes behind it.
  Select **Sessions** to return to them.
- A part of the hash that does not decode, such as `#todo/%E0`, names nothing: the page opens without it, and a pane it names drops.
- When a pane's view fails to render, that pane shows **This view failed to render.** with the error under it, and the other panes and the sidebar keep working; the pane's header buttons still close or maximize it.
  A page that fails shows the same in its place, and opening another view clears it.
- Session conversations, their composers, and the new-session composer are at most 48rem wide.
- A session header shows its **Copy session ID** and trajectory buttons only while the pointer is over the title, while one of them has keyboard focus, or always on a touch screen.
- Pointing at or tabbing to a link shows its address at the bottom left of the window.
