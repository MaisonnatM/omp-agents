# Activity

Settings › Activity reports how the dashboard is used, so a feature nobody opens can be found and a common path made shorter.
The page records each **activity** event by registry id only: the view it shows, the command that ran, the action it sent, or the tagged control clicked.
A key never holds a title, a path, a session id, or anything the user typed; the server's `ACTIVITY_KEY` in `src/shared/activity.ts` allows only lowercase ids, route paths, and spaces, and refuses the whole batch otherwise.

## What the page records

`web/activity.ts` holds the recorder, which `web/use-dashboard.ts` installs once per page load under a fresh client id from `crypto.randomUUID()`.

- A **view** is `viewOf(cover, layout)`, a key of `VIEWS` in `web/activity.ts` or `settings/<section>`: a page's kind, `<kind>/item` when it opens one item, `pull-requests/files`, or `email/new`; with no page, `home` for no panes, `session` or `past` for one, and `split` for more.
  `viewOf` returns a `ViewKey`, so a view missing from `VIEWS` is a type error, and the hook records it whenever it changes.
- A **command** is a shortcut that took its key, recorded in `dispatch` in `web/shortcuts.ts` with `via: "keyboard"`, or a palette command, recorded in `web/components/command-palette/command-palette.tsx` with `via: "palette"`.
  Its key is the shortcut id in kebab case, `newSession` as `new-session`, so both channels share one key.
- An **action** is a socket message `ACTION_MESSAGES` marks as the user's, keyed by its `t` and recorded by `recordAction`, or a write through `putJson` in `web/api.ts`, keyed by its path without the query, such as `put /api/settings`.
  The page sends `watch`, `complete`, `read`, `list-models`, `notice`, and `activity` on its own, so they are not actions.
  Every `PUT` caller in `web/` runs from a click, a submit, or a paste, so no write is excluded.
- A **control** is a click inside an element tagged with `activityControl(id)`, which one capture-phase listener on `document` reads through `controlOf` from the nearest `[data-activity]` ancestor; ids come from `CONTROLS` in `src/shared/activity.ts`, so a typo is a type error.
- A **presence** event marks the tab coming to the foreground or leaving it, on `visibilitychange`, `focus`, and `blur`.

A browser with `navigator.webdriver` set records nothing, so an agent's smoke run never counts as use.
The browser relay drives your own Chrome without that flag, so a relay-driven session does count; Activity cannot tell it from you.

## Delivery

The recorder keeps each event in an outbox, numbered within its page load, capped at 5,000 with the oldest dropped first.
It saves the outbox to `localStorage` (`omp-agents.activity-outbox`) as each flush starts, after each batch leaves it, and on `pagehide`, not on each event.
It keeps an event only if `isActivityEvent` in `src/shared/activity.ts`, the check the server's parser uses too, passes it, and a kept outbox loads without any entry that check refuses, such as one an older version kept.
Every 10 seconds, when the tab hides, and when the socket opens, it sends each contiguous run of at most 500 events as one acknowledged `activity` message (see [Socket requests](socket-requests.md)).
While the socket is closed, every batch stays for the next flush.
A batch leaves the outbox once the server answers `done`: stored, or refused with an error, so a batch the server refuses never holds back the ones after it.
A page load resends what an earlier one left under that load's own client id and sequence.

## Storage

`src/server/activity-store.ts` keeps the events in `activity.db` in the dashboard's data directory, a SQLite table keyed by client id and sequence, so a batch sent twice is stored once.
Opening the store once renames the old Inbox page's `inbox` views and commands to their `email` keys, in a transaction that sets SQLite's `user_version` to 1, so it never runs again and rows a later page stores under `inbox` keep their keys.
Only the server holding `server.lock` stores events; another server, such as a smoke server on your state, acknowledges a batch and drops it.
That server prunes rows older than 400 days at start and once a day.
Deleting `activity.db` while the server is stopped clears the history; settings sync never carries it.

## The report

`GET /api/activity?range=<range>`, in `src/server/activity-routes.ts` (see [HTTP API](http-api.md)), reads the range's rows and folds them with `foldActivity` in `src/activity.ts`.
Uses count per feature over the range, with the days used and, for a command, the keyboard and palette split.
Each page load's time between two events counts toward the view it showed, up to five minutes a gap and only while in the foreground; a page load's last event counts up to now.
A visit starts after 30 minutes without use or on a new local day.
`lastUsed` is each feature's latest row whatever the range, which the store's `lastUsed()` answers in SQL, so a feature unused in the range still shows when it was last used.
`web/activity-report.ts` builds the inventory from `VIEWS`, `SETTINGS_SECTIONS`, `SHORTCUTS`, `CONTROLS`, `ACTION_MESSAGES`, and the server's `PUT` routes.
It splits it into used, rarely used (once or twice), never used, and not set up, and lists the 20 most used.
A feature is not set up while its tab is one `useSidebarTabs` reports signed out, which is every integration tab until the integrations answer.
The Tickets views, the ticket commands, and the `/api/ticket` routes go with the Tickets tab; the Email views, the Email commands, and the `/api/gmail/` routes go with the Email tab.

## Coverage

One row per bullet of the Interface map in `docs/code-layout.md`, with how Activity observes it and the key it records.
A view key is what `viewOf` returns, a command key is the shortcut or palette command in kebab case, an action key is the socket message type or the `PUT` route, and a control key is an id in `CONTROLS`.
"Not observed" marks a part with nothing to click, or one only dragging or hovering uses.

| Part | Observed by | Key |
| --- | --- | --- |
| Composer | action | `prompt` (sent, steered, or queued), `edit-prompt` |
| Composer's directory, branch, and context ring | control, command, action | `composer.directory`, `composer.branch`, `composer.context-ring`; command `directory`; a move sends action `prompt` (`/move`) |
| Rows above the composer | control, action | `composer-queue.send-now`, `composer-queue.edit`, `composer-queue.remove`, `composer-suggestions.pick`, `composer-suggestions.send-all`; actions `dequeue`, `promote`, `prompt`, `schedule`, `answer` |
| Changes card (Files, Images, and Sources sections, FileChangesDialog) | control, action | `changes-card.files.fold`, `changes-card.images.fold`, `changes-card.sources.fold`, `changes-card.review`, `changes-card.file`, `changes-card.image.select`, `changes-card.image.clear`, `changes-card.image.to-pull-request`, `changes-card.image.to-ticket`, `changes-card.source`; sending images is a `PUT` |
| `/` and `@` menus | control | `completion.pick` (a click; picking by keyboard records nothing) |
| Model and thinking switch | control, command, action | `composer.model`; command `model`; actions `set-model`, `set-thinking`, `set-fast` |
| Conversation pane, pane grid, and divider | view, control | views `session`, `past`, `split`, `home`; maximize and close change the hash, so they show as views; `trajectory.toggle`, `replay-compare.open`; dragging the divider is not observed |
| Desktop link address | not observed | display only |
| Transcript (code blocks, session visuals, minimap, chat history, image viewer) | control | `transcript.activity-group`, `minimap.jump`, `minimap.step`, `prompt-history.toggle`, `prompt-history.jump`, `media-viewer.open`, `media-viewer.step`, `media-viewer.new-tab`; the viewer's arrow keys record nothing; code block copy and session visuals are not observed |
| Trajectory | control | `trajectory.toggle`, `trajectory.turn`, `trajectory.step` |
| Replay from here | control, action | `replay.open`; starting the replay is the dialog's request |
| Replay comparison | control | `replay-compare.open` |
| Scroll-to-bottom arrow | control | `transcript.scroll-to-bottom` |
| Left sidebar | view, command, control | each tab's page view; tab and toggle shortcuts; `sidebar.left.toggle`, `sidebar.workspace`, `shortcuts.open`; untagged roster rows open a session, which records its view |
| Right sidebar (session details, Images) | control | `sidebar.right.toggle`, `session-details.tab.pull-requests`, `session-details.tab.tickets`; images use the `media-viewer.*` controls |
| Pull request details (tabs, composer, header, checkout menu, checks, timeline) | view, control, action | views `pull-requests/item`, `pull-requests/files`; `pr-details.tab.summary`, `pr-details.tab.timeline`, `pr-details.tab.code`, `pr-details.tab.review`, `pr-details.checkout`; on the page the Code tab also sets the hash, so it shows as view `pull-requests/files`; edits, comments, merges, and checkouts are `PUT`s or action `review-draft` |
| Bottom bar | control, command, action | `status-bar.terminal`, `status-bar.cpu`; command `terminal`; a process's Stop is a `PUT`; plan quota is display only |
| Files: the changes card's Files section | control | `changes-card.file`, `changes-card.files.fold` |
| Files: the session changes dialog | control | `changes-dialog.scope.all`, `changes-dialog.scope.session`, `changes-dialog.refresh` |
| Files: Settings › Files | view | `settings/files` |
| File dialog | control | `file-dialog.open`, `file-dialog.source`, `file-dialog.copy-path` |
| Ask about this and the discussion panel | control, action | `ask-about.open`, `discussion.close`; actions `discuss`, `discuss-stop`; Send to session is action `prompt` |
| Command palette | command | the command each item runs |
| Keyboard shortcuts | command, control | each shortcut's command key; `shortcuts.open`, `shortcuts.tab` |
| Dev and Ops switch, command menu button, What's new, notification bell, and Settings button | control, command | `header.group`; `header.command-menu`, which opens the command palette as command `switcher` does; `header.whats-new`, which opens What's new; `notices.open`, `notices.filter`, `notices.read-all`, `notices.item`, `notices.update`, `notices.clear`; the `notice` message is not an action, so these need the tags; `header.settings`, which opens or closes Settings as command `settings` does; `header.back` and `header.forward`, the title bar's Back and Forward, which go back and forward as commands `back` and `forward` do |
| System notifications and Dock badge | presence, action | clicking one brings the window to the foreground (presence); their switches and sound in Settings › Preferences are action `preference` |
| Pages: New session | view | `new` |
| Pages: Pull requests | view, control | `pull-requests`; `pull-requests.view.list`, `pull-requests.view.board`; Rebase N behind is a `PUT` |
| Pages: Tickets | view | `tickets`, `tickets/item` |
| Pages: Todo | view | `todo`, `todo/item` |
| Pages: Notes | view | `notes`, `notes/item` |
| Pages: Calendar | view, control | `calendar`; `calendar.routines.toggle` |
| Pages: Email | view | `email`, `email/new`, `email/item` |
| Pages: Bots | view, control, action | `bots`, `bots/item`, `bots/routine`; `bots.delete`, `bots.details`, `bots.job.revert`, `bots.look`, `bots.routine.new`; `bot` |
| Pages: Settings | view | `settings/<section>` |
| Settings › Analytics' context-source table | view | `settings/analytics` |
| Settings › Integrations' Google account lines | view, action | `settings/integrations`; Add account, Remove, and the workspace picker are `PUT`s |
| Settings › Worktrees | view, action | `settings/worktrees`; Remove merged is a `PUT` |
| Settings › Preferences | view, action | `settings/preferences`; each change to a preference that follows you, the theme, transcript, sidebar tabs, notifications, pinned skill, default merge method, diff, and calendar routine choices, is action `preference`, wherever you change it; Stop idle processes is a `PUT` |
| Settings › Sync | view, action | `settings/sync`; Sync and its switches are `PUT`s |
| ListSplit | not observed | dragging the line is not a click |
| Shared primitives | not applicable | tags go on the component that owns a control, not on the primitive |
| Colors, the font, and tokens | not applicable | no interaction |

The checkout menu lives at `web/components/pull-requests/pr-details/checkout-menu.tsx`, not `pull-requests/checkout-menu.tsx` as the plan lists.
`CommandPicker`, `DirectoryPicker`, and `ModelPicker` take an optional `control`, so the same picker on Settings or the replay dialog records nothing.
`DetailsTab` takes a required `control`, so every new right-sidebar tab must name one.
