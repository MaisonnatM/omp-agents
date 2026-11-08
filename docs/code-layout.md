# Code layout

Where each part of the code lives and what each file does.
Start at the [Interface map](#interface-map), then open the file below that lists the path you need; each lists one area's files in `docs/code-layout/`.
For the server's design, protocols, and HTTP API, see [How omp-agents works](architecture.md); for the interface, see [Using omp-agents](usage.md).

- [Interface map](#interface-map): a part of the screen, by the name you would call it, and the component and file that draw it.
- [Server](#server): `src/`.
- [Page](#page): `web/`.
- [Starter kit and docs](code-layout/starter-kit-and-docs.md): `templates/omp/` and `docs/`.
- [Desktop](code-layout/desktop.md): `desktop/`.

## Interface map

Each part of the screen, by the name you would call it, with the component that draws it.
Start a UI change here, then read that file's entry under [Page](#page).

- Composer, the box you type a prompt in: `InputMessage` in `web/components/ui/input-message.tsx`, with its text field, `PromptEditor`, in `web/components/prompt-editor.tsx`.
  A live session mounts it in `web/components/conversation.tsx`, and the new-session page in `web/components/new-session.tsx`, whose `PrivatePill` draws the header's **Private** pill.
- The composer's directory, branch, and context ring: the directory is `DirectoryPicker` in `web/components/workspace-picker.tsx`, with the **Personal** item first, or `DirectoryLabel` in `web/components/composer.tsx` where the session cannot move, in the composer's `leftSlot`, followed in a scheduled start's draft by `BranchPicker` in `web/components/git.tsx`; a new session's draft puts both in a row above the composer instead; the ring is `ContextRingMenu` for dashboard sessions and read-only `ContextRing` for terminal sessions in `web/components/context-ring.tsx`, in its `rightSlot`.
- Rows above the composer: queued prompts in `web/components/composer-queue.tsx`, suggested prompts in `web/components/composer-suggestions.tsx`, scheduled sends in `web/components/scheduled.tsx`, and the open question, `UserRequestCard` in `web/components/user-request.tsx`, drawn by `question-card.tsx`.
- `/` and `@` menus: `CompletionPopup` in `web/components/completion-popup.tsx`, over `web/mentions.ts`; it opens above the composer, through `useCompletion`.
- Model and thinking switch: `ModelSlot` in `web/components/model-slot.tsx`, whose menu is `web/components/model-picker.tsx`.
- Session goal: `SessionGoalControl` in `web/components/session-goal.tsx` mounts in the conversation header; `App` owns its `GoalDialog` and the shared `editGoal` action, which the focused-session palette command runs through `use-page-shortcuts.ts`.
- Conversation pane: `web/components/pane.tsx`, laid out by `PaneGrid` in `web/components/pane-grid.tsx`, with the panes' divider in `web/components/split-resize-handle.tsx`.
  Its header is `ConversationHeader` in `web/components/conversation-header.tsx`, which draws a private session's lock, and a past session's view is `web/components/past-conversation.tsx`.
  The session title in either header, which a click turns into a field that renames the session, is `SessionTitle` in `web/components/session-title.tsx`.
  Which split a plain click brings back, and each split's sizes, live in `web/pane-navigation.ts`, which `web/dashboard-state.ts` runs for every pane change.
- Desktop link address at the bottom left: `DesktopLinkPreview` in `web/components/desktop-link-preview.tsx`, mounted by `web/app.tsx`.
- Transcript: `web/components/transcript.tsx`, with message bubbles from `web/components/ui/chat-message.tsx` and tool calls and thinking as `ActivityGroup`, on shadcn's `Trace` from `web/components/ui/trace.tsx`.
  A message's code block is `CodeBlock` from `web/components/ui/code-block.tsx`, which `web/components/message-markdown.tsx` renders for each fence.
  In a session's conversation, a `mermaid` or `chart` fence is `SessionVisual` from `web/components/session-visual.tsx` instead, through the `SESSION_AGENT_PRESET` and `SESSION_PROMPT_PRESET` that `MessageRow` passes, and its chart is shadcn's `web/components/ui/chart.tsx`.
  The turn minimap on its left edge is `TranscriptMinimap` in `web/components/transcript-minimap.tsx`, with its turns from the `outline` of the `transcriptModel` in `web/transcript-view.ts` that `Transcript` builds.
  The **Todos** card, the agent's own todo list followed by its subagents and its changed files, images, and sources, is `SessionTodosCard` in `web/components/session-todos-card.tsx`.
  It shows as one strip above the messages, with the /ship stage or the task in progress and each section's count from `stripSummary` in `web/todos-strip-model.ts`, and a click opens its sections over the messages.
  `TodosCardToggle` from the same file, the checklist toggle in the session header before End session, or before **Resume** in a past session's, hides it, as **Show todos card** in Settings › Preferences does; it shows only while the view's card has a section to show.
  Its **Subagents** section is `SubagentsSection` in `web/components/todos-card-subagents.tsx`, over `subagentTree` in `web/todos-card-subagents-model.ts`, from the `SubagentLinks` context of `web/components/subagent-links.tsx` that `ViewConversation` in `web/components/pane.tsx` provides, with the same `CancelAgentButton` as a `task` row's subagent links.
  Its **Files**, **Images**, and **Sources** sections are `ChangesSections` in `web/components/todos-card-changes.tsx`, from the `changes` that `conversation.tsx` and `past-conversation.tsx` pass `Transcript`.
  Its **Files** section is `ChangedFileList` in `changed-files-section.tsx`; its **Images** section is `MediaStrip` in `media-section.tsx`, with the selection bar that sends images to a pull request or Linear issue; its **Sources** section is `SourceList` in `sources-section.tsx`.
  The sections fold independently, with closed sections kept by `useStoredKeys`.
  A subagent's recorded edits open `FileChangesDialog` in `changed-files-section.tsx`, with Kobra-inspired cards from `web/components/file-diff.tsx`.
  **Chat history**, the blurred column of the session's prompts over it, is `PromptHistory` in `web/components/prompt-history.tsx`, opened by `PromptHistoryButton` from the same file in the live composer's `rightSlot` in `web/components/conversation.tsx`.
  A tool row's image thumbnails open one viewer that the transcript owns, `ImageViewer` from `web/components/media-viewer.tsx`, over every tool image of the conversation.
  A grey notice line in the transcript comes from omp's `notice` events, turned into notice items by `applyEvent` in `src/transcript.ts`, which also drops the sources the dashboard hides; [Transcripts](architecture/transcripts.md) lists them.
- Routine run card in a conversation: `RoutineRunCard` in `web/components/routines/routine-run-card.tsx`, rendered by `web/components/transcript.tsx` from a routine message snapshot.
- Bot message card in a conversation: `BotMessageCard` in `web/components/bots/bot-message-card.tsx`, rendered by `web/components/transcript.tsx` from a `bot-message` item.
  Its folded row shows the name, task icon, trigger logos, time, status, and command duration.
  Its open fold reuses `CommandOutput` and `TriggeredBy` from `web/components/routines/routine-open.tsx`, with **Open routine** and the prompt or command's copy button.
- Trajectory, a pane's turn-by-turn view: `Trajectory` in `web/components/trajectory.tsx`, which the road-icon toggle after the session's title in `web/components/pane.tsx` swaps for the transcript.
- Browser, a live session's app in the right sidebar: `BrowserPanel` in `web/components/browser-panel.tsx`, the **Browser** tab that `sessionWorkTabs` in `web/components/session-details.tsx` adds; `web/use-webview.ts` drives its `<webview>`, `web/components/browser-capture.tsx` holds `usePicking`, its picking session and **Screenshot**, and `Picking`, the pick mode switch and the layer that Region, Draw, and Erase mark with its **Attach** card, `web/browser-model.ts` picks its dev servers and holds the marks' geometry, and the desktop side is in [Desktop shell](architecture/desktop-shell.md).
  Its tabs, the session's **App** and one per page to review, are `BrowserPanel` there, each page a `BrowserPage` beside it.
- **Review visuals** in the Browser's toolbar: `BrowserPage` in `web/components/browser-panel.tsx`, which reads the latest reply's `review-pages` list from the session's transcript with `latestReviewPages` in `web/review-pages.ts`; the reply's card for that list is `ReviewPagesCard` in `web/components/message-markdown.tsx`.
- Trust this project's agent code?: `ProjectTrustDialog` in `web/components/project-trust-dialog.tsx`, which `web/app.tsx` mounts while `refusedStart` in `web/starts.ts` finds a start in the page state's `starts` that carries `trust`; the Trusted projects list is `TrustedProjects` in `web/components/settings/workspaces-tab.tsx`.
- Scroll-to-bottom arrow: `MessageScrollerButton` in `web/components/ui/message-scroller.tsx`, placed by `web/components/transcript.tsx`; button variants live in `web/components/ui/button.tsx`.
- Left sidebar: `Roster` in `web/components/roster.tsx`, wired by `web/components/app-sidebar.tsx`, inside `DashboardSidebar` from `web/components/sidebar-panel.tsx`, which slides it open and shut and draws its toggle over the header's corner; the Sessions tab is `web/components/session-list.tsx` and a row is `web/components/session-row.tsx`.
- Right sidebar, the session details: `SessionDetails` in `web/components/session-details.tsx`, inside `DashboardSidebar` from `web/components/sidebar-panel.tsx`, which `web/app.tsx` mounts.
  Its tabs are **PRs** in `session-pull-requests-tab.tsx`, **Browser** in `browser-panel.tsx`, **Tickets** in `session-tickets-tab.tsx`, and a personal session's **Memory**, drawn by `MemoryList` in `memory-list.tsx`, all in `web/components/`.
  The **Images** section, the transcript, and a pull request's Markdown share `ImageViewer` from `web/components/media-viewer.tsx`, with the image, its caption, `N of M`, previous and next buttons and arrow keys, zoom, open in the default browser, and Close.
  Zoom is `ZoomPane` and `ZoomControls` from `web/components/zoom-pane.tsx`, which the expanded chart or diagram and the file dialog's image use too: −, the level, which fits again, and +, the same on the − + 0 keys, a pinch or ⌘/Ctrl+wheel around the pointer, and a drag to pan; the desktop menu keeps ⌘+ and ⌘− for the whole window.
- Pull request details, with the **Summary**, **Timeline**, **Code**, and **Review draft** tabs: `PullRequestDetailContent` in `web/components/pull-requests/pr-details/index.tsx`, with **Summary** in `summary.tsx` and **Review draft** in `review-draft.tsx` beside it.
  The floating comment and review composer at its bottom right, on the Pull requests page only, is `PullRequestComposer` in `pr-details/composer.tsx`.
  `header.tsx` draws T3's crumbs, **Check out** menu, inline-confirmed primary action, title editor, base freshness warning, copyable command and branch, stack menu, and linked-sessions count; the **Check out** menu is `CheckoutMenu` in `checkout-menu.tsx`.
  The Reviewers and Labels pickers and collapsible Description, Checks, and Comments sections live in **Summary**.
  `web/components/segmented-tabs.tsx` provides its T3-styled 24px tabs with Radix keyboard navigation and tab-panel semantics.
  `checks.tsx` draws the checks status line and grouped popover, over the pure summary and grouping in `web/pull-request-checks.ts`.
  **Timeline** in `web/components/pull-requests/pr-timeline.tsx` draws T3's activity rail, conversation and reply disclosures, review verdicts, lifecycle markers, and commit links, over pure grouping and ordering in `web/pull-request-timeline.ts`.
  `code.tsx` holds the **Code** tab's commit scope and which files are folded, and composes `code-toolbar.tsx`, its toolbar, `diff-preferences.ts`, the diff options it keeps on this computer, `viewed-files.tsx`, GitHub's viewed state and the **Viewed** checkbox, `code-files.tsx`, the diffs and file tree, and `diff-controls.tsx`, the line comment box.
  A pull request row's **Review draft** tag is `ReviewDraftTag` in `web/components/pull-requests/pr-row.tsx`.
  The same details show in two places, so reproduce a layout bug in the one the user means: the Pull requests page's `pr-page.tsx`, and the right sidebar's **PRs** tab, a much narrower column.
  A table row's or card's review cell, which asks for reviews, is `ReviewPicker` in `pr-row.tsx`, over `ReviewersField` in `pr-fields.tsx`, the **Summary**'s Reviewers picker.
  A row's or card's right-click menu is `RowContextMenu` in `pr-row.tsx`, which lists the `⋯` menu's `PullRequestMenuItems` from `pr-menu.tsx`, with its **Reviewers** submenu.
- Bottom bar, with plan quota, the **Terminal** button, and CPU, memory, and disk: `StatusBar` in `web/components/status-bar.tsx`, whose CPU card lists every live session's processes with **Stop**; the terminal panel is `web/components/terminal/terminal-panel.tsx`.
  The disk card's **Clean up…** link opens Settings › Storage.
  Its plan quota, each plan's windows and the **API credits** row with its grant and its red `used up` once a provider refuses requests for lack of credit, is `PlanUsageList` in `web/components/plan-usage.tsx`.
- The three things called Files:
  - The Todos card's **Files** section, a session's changed files: `ChangedFileList` in `web/components/changed-files-section.tsx`.
  - The session changes dialog that a file or **Review** opens: `web/components/changes/session-changes-dialog.tsx`, with its explorer in `changes-explorer.tsx` and tree in `file-tree.tsx` beside it.
  - Settings › Files, omp's own config files: `Files` in `web/components/settings/files-tab.tsx`.
  - Settings › Decisions, a workspace repository's decision records: `DecisionsTab` in `web/components/settings/decisions-tab.tsx`.
- A file opened from a path in agent text: `web/components/file-dialog.tsx`.
- Dictation, the composer's microphone and the status row above its text field: `DictationButton` and `DictationRow` in `web/components/composer-dictation.tsx`, which `conversation.tsx` and `new-session.tsx` mount, over the page's one capture in `web/dictation.ts`.
- Command palette (Cmd+K): `web/components/command-palette/`, over `web/command-palette.ts`.
- Keyboard shortcuts: the table in `web/shortcuts.ts`, the page-wide handlers in `web/use-page-shortcuts.ts`, and the reference dialog in `web/components/shortcuts-dialog.tsx`.
- Notes, Calendar, Email, and Sport buttons, command menu button, What's new, notification bell, and Settings button: `HeaderControls` in `web/components/header-controls.tsx`, in the desktop app's title bar, `DesktopTitleBar` there, else at the end of each page's `Header`; What's new is `WhatsNew` in `web/components/whats-new.tsx`; the bell is `NoticesBell` in `web/components/notices.tsx`; toasts come from `web/components/toaster.tsx`.
  The title bar's Back and Forward buttons, at its top left after the window's buttons, are `HistoryButtons` in the same file.
- System notifications of sessions that ask or finish, and the desktop app's Dock badge: `useAttention` in `web/use-attention.ts`, shown by `desktop/attention.ts` in the desktop app; their switches and sound picker are `SessionNotifications` in `web/components/settings/preferences-tab.tsx`.
- Pages, each routed by `web/routing.ts`:
  - Get started: `web/components/get-started.tsx`, the step-by-step setup dialog and its bottom-right bubble under the toasts, mounted in `web/app.tsx` and open at `#get-started` and on a vacant home's first run, with each step's body in `web/components/get-started-steps.tsx` and its facts and surface choice in `web/get-started-model.ts`.
  - The empty home, with **New session** and **Get started**: `EmptyHome` in `web/components/empty-home.tsx`, which `PageSwitch` draws.
  - New session: `web/components/new-session.tsx`, also used for todo drafts and scheduled starts, which docks the composer at the page's bottom with a new session's directory and branch pickers above it and lists the starters that `rankedStarters` in `web/starters.ts` fills in and ranks in the composer's suggestion list, `useSuggestions` from `web/components/composer-suggestions.tsx`, or in their place a private draft's `PrivateFacts` from `web/components/new-session-modes.tsx`.
  - Pull requests: `web/components/pull-requests/pull-requests-page.tsx`, with the **Rebase N behind** button at its top, its board view `PullRequestsKanban` in `pull-requests-kanban.tsx` with each card `PullRequestCard` in `pr-row.tsx`, and one pull request in `pr-page.tsx` beside it.
  - Tickets: `web/components/tickets/tickets-page.tsx`.
  - Todo: `web/components/todo/page.tsx`.
  - Notes: `web/components/notes/page.tsx`, with its sidebar lists in `web/components/notes/nav.tsx`.
  - Calendar: `web/components/calendar/calendar-page.tsx`, with **Show routines** in `web/components/calendar/calendar-nav.tsx`, both reading the saved display preference in `web/use-calendar-display.ts`.
  - Email: `web/components/email/email-page.tsx`.
  - Sport: `web/components/sport/page.tsx`, with its sidebar tab in `web/components/sport/nav.tsx`, the week in `week.tsx` and `day-detail.tsx`, the demos in `demo-dialog.tsx`, the Fait dialog in `log-form.tsx`, the journal in `journal.tsx`, and the progress in `progress.tsx`, all in `web/components/sport/`.
  - Bots: the gallery of every Bot at `#bots` in `web/components/bots/bots-gallery.tsx`, a Bot's page and the New Bot form with its job templates in `web/components/bots/bot-page.tsx`, the Bot's details in the right sidebar in `web/components/bots/bot-details.tsx`, the card of its routines from `web/components/routines/routines-card.tsx` in place of the conversation, with each row in `web/components/routines/routine-row.tsx` and an open row's rest in `web/components/routines/routine-open.tsx`, the sidebar's **Bots** tab in `web/components/bots/bots-nav.tsx`, each Bot's face in `web/components/bots/bot-avatar.tsx`, and its shape and color choice in `web/components/bots/bot-look-picker.tsx`.
    The New Bot form's type picker starts on Bot designer and fills each type's starting name and job from `BOT_KIND_START` in `web/bots-model.ts`.
    The right-click menu of a Bot's row and card, which pins it and moves it between sections, is in `web/components/bots/bot-menu.tsx`.
    Dragging a Bot's row onto a group in the Bots tab is in `web/components/bots/bots-nav.tsx`, with the changes a drop sends from `botMovesTo` in `web/bots-model.ts`.
  - Settings: `web/components/settings/settings-page.tsx`, one `*-tab.tsx` per section listed in `SETTINGS_SECTIONS` in `web/routing.ts`.
    Settings › Analytics' context-source table: `ContextSources` in `web/components/settings/context-sources.tsx`.
    Settings › Extensions, with Installed, Discover, Preview, and Sources: `ExtensionsTab` in `web/components/settings/extensions-tab.tsx`, a full-height split library over native package operations.
    Settings › Workflows, the skills tagged `workflow` with how each starts: `Workflows` in `web/components/settings/workflows-tab.tsx`, which opens authored skills in `FileView` from `files-tab.tsx` and packaged skills as read-only source, over `workflowsOf` in `src/omp/workflows.ts`.
    Settings › omp settings, omp's own settings by its tabs with search, a control per row, **Reset**, and the workspace lock: `OmpSettingsTab` in `web/components/settings/omp-settings-tab.tsx`, with the `SettingRow` and controls shared with Agents in `editor.tsx`, over `shownTabs` and `OWNED_SETTINGS` in `web/omp-settings.ts`, and `readAgentSettings` in `src/omp/agent-settings.ts`.
    Settings › omp memory, the backend bar with **Auto-learn**, what a new session gets, and the store with its edit and forget actions: `OmpMemoryTab` in `web/components/settings/omp-memory-tab.tsx`, over `loadOmpMemory` in `src/memory.ts` and the omp access in `src/omp/memory.ts`.
    Settings › Activity, with its never-used, most-used, navigation, and active-time reports: `ActivityTab` in `web/components/settings/activity-tab.tsx`.
    Settings › Integrations' Google account lines, with **Add account**, **Remove**, and the workspace picker: `GoogleAccountsRow` in `web/components/integrations/google-accounts.tsx`.
    Settings › Providers' account lines, with each account's place, its up and down arrows, and **Sign out**: `AccountLine` and `ProviderRow` in `web/components/settings/providers-tab.tsx`, over `orderableAccounts` in `src/shared/providers.ts` and `src/omp/account-order.ts`.
    Settings › Worktrees, with its totals, filters, **Merged** and blocker badges, selection bar, and **Remove N merged**: `WorktreesTab` in `web/components/settings/worktrees-tab.tsx`, with the removal queue and its toasts in `web/worktree-removals.ts`.
    Settings › Sync, with its remote, **Sync** button, last outcome, conflict choices, and item switches: `SyncTab` in `web/components/settings/sync-tab.tsx`.
    Settings › Storage, with allocated usage, native cleanup previews, phase progress, and global cleanup rules: `StorageTab` in `web/components/settings/storage-tab.tsx`, with phase presentation and the sequential run driver in `web/storage.ts`.
- List on the left with the open item on the right, split by a line you drag: `ListSplit` in `web/components/list-split.tsx`, over `web/components/drag-separator.tsx`.
- Shared primitives (buttons, menus, dialogs, tooltips): `web/components/ui/`, from the Fluid registry and some from shadcn's, with the shadcn utilities they need in `web/shadcn.css`; change them only as `web/components/ui/PATCHES.md` describes.
- Colors, the font, text sizes, and the `surface-glass` utility: the tokens in `web/globals.css`, which are T3 Code's light and dark values for every token the two apps share, with the system font stack and T3's `text-2xs` (11px) and `text-3xs` (10px); the `--surface-*`, `--shadow-*`, `--hover`, `--active`, `--selected`, `--tint`, and `--focus-ring` tokens stay Fluid's, since T3 has none of them.

## Server

The server lives in `src/`; its files, listed by area:

- [Entry point, routes, sockets, and session registry](code-layout/server-core.md)
- [Shared types, omp facades, analytics, and subprocesses](code-layout/server-shared-and-omp.md)
- [Sessions and transcripts](code-layout/server-sessions.md)
- [Git, worktrees, pull requests, merges, and sync](code-layout/server-git-and-pull-requests.md)
- [Linear, Google, todos, shared lists, and inboxes](code-layout/server-integrations-and-inboxes.md)
- [Routines, scheduled sends, usage, settings, and tests](code-layout/server-routines-and-settings.md)

## Page

The page lives in `web/`.
`src/server/page.ts` bundles `web/index.html` and `web/main.tsx` with `Bun.build`, and `bun-plugin-tailwind` compiles Tailwind v4.
Its files, listed by area:

- [Shell, state, and models](code-layout/page-core.md)
- [List models, sidebar tabs, model menu, and mentions](code-layout/page-models.md)
- [Status bar, terminal, HTTP reads, shortcuts, and theme](code-layout/page-reads-and-chrome.md)
- [Sidebar, Todo, Notes, Bots, Routines, Calendar, Email, and Sport](code-layout/page-pages.md)
- [Panes, session details, and changes](code-layout/page-panes.md)
- [Pull requests, tickets, settings, integrations, and primitives](code-layout/page-pull-requests-and-settings.md)
