# Page: shell, state, and models

- `web/app.tsx`: the page shell.
  It builds the two dashboard contexts and lays out the sidebars, the page, the command palette, and the dialogs, and leaves each slice of state to a hook of its own.
  `web/use-workspace-scope.ts` holds the visible sessions, the workspaces, the selected workspace, which localStorage keeps, and its pull request poll.
  `web/use-focused-session.ts` holds the focused pane's session, the document title, and the sidebar following a `/move`.
  `web/use-session-lists.ts` holds the Sessions tab's lists and search, the session `latestSession` from `web/sessions.ts` picks from the selected workspace's rows, and pins and unpins through the server's pins, and `web/use-sidebar-tab.ts` the tab and `showTab`, whose Sessions tab opens that session when no pane shows one, and the header's group with `showGroup`, which reopens the tab a group was left on.
  `web/use-overlays.ts` holds the shortcuts dialog, the command palette, the file dialog, and the new-ticket dialog.
  `web/use-transcript-display.ts` holds how transcripts show tool calls and thinking, and `web/use-page-shortcuts.ts` the page-wide shortcuts and the commands the palette runs.
  `web/components/app-sidebar.tsx` wires the roster to the page, `web/components/page-switch.tsx` picks the page or the panes, and `web/components/pane-grid.tsx` lays out the panes.
  `#pull-requests` alone shows the Pull requests page, and the sidebar's Pull requests tab then lists its sections.
- `web/use-dashboard.ts`: the socket, the page state, and the URL hash.
  One exhaustive switch in the socket's `onmessage` sends each server message to the pane store or the reducer, and the hash is read once into a `Route` (a page, a `#session/<id>` link, or the panes).
  `web/starts.ts` holds the sessions the page is starting, whether new, forked, resumed, resumed all at once, or started by a quick action on a pull request, a Linear issue, or a todo, which runs in the background.
  `request` resolves or rejects on `done` and keeps waiting across a reconnect, whose `resume` hands the server every request still waiting.
  Ending sessions stay in a separate set until their requests settle, even if they have already left the roster.
- `web/use-action.ts`: guards a control against repeated activation, exposes its pending state, and shows failures through the toast manager.
- `web/use-hover-popover.ts`: `useHoverPopover`, the props for a popover a mouse opens by hovering its trigger without moving focus, and a click or Enter opens with focus inside, so its buttons stay reachable by keyboard; the status bar's CPU and a pull request's out-of-date base branch use it.
- `web/use-open-latest.ts`: `useOpenLatest` opens a list's first item once you arrive at it with nothing open, replacing the list's history entry; the Todo page passes its top row, and the Inbox page its newest conversation.
- `web/open-pull-request.tsx`: a live session's **Open PR**: its prompt, `offeredPrompt`, which sessions offer it, `pressAfter`, where a press stands, in flight until the queue or the transcript's last prompt shows the session took it, then seen until the session is next idle, `useOpenPullRequest`, which keeps the press per session id for the command menu's **Open pull request** in `web/app.tsx` and the header's `OpenPullRequestButton`, and sends with the delivery `deliveryOf` in `web/components/subject.ts` gives the composer.
- `web/pane-store.ts`: each open view's transcript, changed files, images, turns, and completions, outside the page state.
  `useShowTrajectory` registers a view whose Trajectory a component shows, and `web/use-dashboard.ts` sends those views in `watch`; `retainTrajectories` drops the turns of a view no longer shown.
  A component reads one field through a selector hook (`useTranscript`, `useChangedFiles`, `useMedia`, `useComposerData`, …), built on `useSelect` in `web/keyed-store.ts`, which `web/polled-store.ts` shares, one snapshot and subscription per key, and renders again only when that field changes, so a streamed token renders the transcript and what reads `items`, and not the pane, the composer, or the details.
  `toBlocks` in `web/transcript-view.ts` keeps the blocks that a token leaves alone as the same objects, and the transcript's rows are memoized on them.
  It and the page state apply the server's list updates, the roster's and the past sessions', through `applyDelta` in `web/keyed-list.ts`, which keeps every entry an update leaves alone as the same object.
- `web/discussions.ts`: the open **Ask about this** discussion, kept in memory for the page load, which `DiscussionPanel` reads with `useDiscussion`.
  `discussionRequest` builds what a question sends, the passage, its source, and the finished answers before it, and `withEvent` applies a `discussion` message, which `web/use-dashboard.ts` routes there; `web/components/ask-about-selection.tsx` opens it on a selection, and `web/components/discussion-panel.tsx` draws it.
- `web/dashboard-state.ts`: the page state and its reducer, which `web/use-dashboard.ts` runs.
- `web/routing.ts`, `web/sessions.ts`, `web/labels.ts`, `web/pull-requests-model.ts`, `web/tickets-model.ts`, `web/routines-model.ts`, `web/calendar-model.ts`, `web/inbox-model.ts`, and `web/transcript-view.ts`, and `web/document-title.ts` (the tab and window title): the pure transforms from server messages to what the page renders, and the hash routes.
  `web/inbox-model.ts` folds a conversation's messages into open, closed, and stacked rows with `foldMessages` and `foldsAfter`, words its recipients and lists who wrote in it with `participants`, picks an avatar's letter past a leading English article with `initialOf` and the avatar's colour from the address with `colorIndex`, cuts plain text into links, and builds a message's sandboxed document.
  `src/shared/every-word.ts` holds `everyWord` and `searchWords`, the search rule the sidebar's sessions, the Todo page, the model search, the `@` menu, the command palette's todos, tickets, and pull requests, and the server's conversation search share: every word typed, in any order and any case.
