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
  A live session mounts it in `web/components/conversation.tsx`, and the new-session page in `web/components/new-session.tsx`.
- Gray strip under the composer, with the directory and the context ring: `ComposerTray` in `web/components/composer.tsx`; the ring is `ContextRing` in `web/components/context-ring.tsx`.
- Rows above the composer: queued prompts in `web/components/composer-queue.tsx`, suggested prompts in `web/components/composer-suggestions.tsx`, scheduled sends in `web/components/scheduled.tsx`, and the open question, `UserRequestCard` in `web/components/user-request.tsx`, drawn by `question-card.tsx`.
- Changed files and images above the composer: `ChangesCard` in `web/components/changes-card.tsx`, mounted by `conversation.tsx`, and below a past session's transcript by `past-conversation.tsx`.
  Its **Files** section is `ChangedFileList` in `changed-files-section.tsx`; its **Images** section is `MediaStrip` in `media-section.tsx`, with the selection bar that sends images to a pull request or Linear issue.
  The sections fold independently, with closed sections kept by `useStoredKeys`.
- `/` and `@` menus: `CompletionPopup` in `web/components/completion-popup.tsx`, over `web/mentions.ts`.
- Model and thinking switch: `ModelSlot` in `web/components/model-slot.tsx`, whose menu is `web/components/model-picker.tsx`.
- Conversation pane: `web/components/pane.tsx`, laid out by `PaneGrid` in `web/components/pane-grid.tsx`, with the panes' divider in `web/components/split-resize-handle.tsx`.
  Its header is `ConversationHeader` in `web/components/conversation-header.tsx`, and a past session's view is `web/components/past-conversation.tsx`.
  Which split a plain click brings back, and each split's sizes, live in `web/pane-navigation.ts`, which `web/dashboard-state.ts` runs for every pane change.
- Desktop link address at the bottom left: `DesktopLinkPreview` in `web/components/desktop-link-preview.tsx`, mounted by `web/app.tsx`.
- Transcript: `web/components/transcript.tsx`, with message bubbles from `web/components/ui/chat-message.tsx` and tool calls and thinking as `ActivityGroup`, on shadcn's `Trace` from `web/components/ui/trace.tsx`.
  A message's code block is `CodeBlock` from `web/components/ui/code-block.tsx`, which `web/components/message-markdown.tsx` renders for each fence.
  In a session's conversation, a `mermaid` or `chart` fence is `SessionVisual` from `web/components/session-visual.tsx` instead, through the `SESSION_AGENT_PRESET` and `SESSION_PROMPT_PRESET` that `MessageRow` passes, and its chart is shadcn's `web/components/ui/chart.tsx`.
  The turn minimap on its left edge is `TranscriptMinimap` in `web/components/transcript-minimap.tsx`, with its turns from `outline` in `web/transcript-view.ts`.
  A tool row's image thumbnails open one viewer that the transcript owns, `ImageViewer` from `web/components/media-viewer.tsx`, over every tool image of the conversation.
- Trajectory, a pane's turn-by-turn view: `Trajectory` in `web/components/trajectory.tsx`, which the road-icon toggle after the session's title in `web/components/pane.tsx` swaps for the transcript.
- Replay from here: the sibling prompt-row action in `web/components/trajectory.tsx` opens `ReplayDialog` in `web/components/replay-dialog.tsx`; `FormDialog` provides its focus, escape, and pending-submit behavior.
- Replay comparison: **Compare replay** in `web/components/pane.tsx` opens `ReplayCompareDialog` in `web/components/replay-compare.tsx`, with ordered tools, complete final text, request hashes and bodies, tokens, and cost.
- Scroll-to-bottom arrow: `MessageScrollerButton` in `web/components/ui/message-scroller.tsx`, placed by `web/components/transcript.tsx`; button variants live in `web/components/ui/button.tsx`.
- Left sidebar: `Roster` in `web/components/roster.tsx`, wired by `web/components/app-sidebar.tsx`, inside `DashboardSidebar` from `web/components/sidebar-panel.tsx`, which slides it open and shut and draws its toggle over the header's corner; the Sessions tab is `web/components/session-list.tsx` and a row is `web/components/session-row.tsx`.
- Right sidebar, the session details: `SessionDetails` in `web/components/session-details.tsx`, inside `DashboardSidebar` from `web/components/sidebar-panel.tsx`, which `web/app.tsx` mounts; a project's coordinator shows `web/components/project-details.tsx` instead.
  Its tabs are **PRs** in `session-pull-requests-tab.tsx` and **Tickets** in `session-tickets-tab.tsx`, both in `web/components/`.
  The **Images** section and the transcript share `ImageViewer` from `web/components/media-viewer.tsx`, with the image, its caption, `N of M`, previous and next buttons and arrow keys, open in a new tab, and Close.
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
  The open `#N` strip above the page's details is `PullRequestTabsStrip` in `web/components/pull-requests/pr-tabs.tsx`, backed by `web/pull-request-tabs.ts`; the sidebar's **PRs** tab has none.
- Bottom bar, with plan quota, the **Terminal** button, and CPU, memory, and disk: `StatusBar` in `web/components/status-bar.tsx`; the terminal panel is `web/components/terminal/terminal-panel.tsx`.
- The three things called Files:
  - The changes card's **Files** section, a session's changed files: `ChangedFileList` in `web/components/changed-files-section.tsx`.
  - The session changes dialog that a file or **Review** opens: `web/components/changes/session-changes-dialog.tsx`, with its explorer in `changes-explorer.tsx` and tree in `file-tree.tsx` beside it.
  - Settings › Files, omp's own config files: `Files` in `web/components/settings/files-tab.tsx`.
- A file opened from a path in agent text: `web/components/file-dialog.tsx`.
- **Ask about this**, the button on selected text and the discussion panel at the top right: the button is `AskAboutSelection` in `web/components/ask-about-selection.tsx`, which wraps the transcript in `conversation.tsx` and `past-conversation.tsx` and the explorer in `web/components/pull-requests/pr-details/code.tsx`; the panel is `DiscussionPanel` in `web/components/discussion-panel.tsx`, which `web/app.tsx` mounts, over `web/discussions.ts`.
- Command palette (Cmd+K): `web/components/command-palette/`, over `web/command-palette.ts`.
- Keyboard shortcuts: the table in `web/shortcuts.ts`, the page-wide handlers in `web/use-page-shortcuts.ts`, and the reference dialog in `web/components/shortcuts-dialog.tsx`.
- Notification bell: `NoticesBell` in `web/components/notices.tsx`; toasts come from `web/components/toaster.tsx`.
- System notifications of sessions that ask or finish, and the desktop app's Dock badge: `useAttention` in `web/use-attention.ts`, shown by `desktop/attention.ts` in the desktop app; their switch is `SessionNotifications` in `web/components/settings/preferences-tab.tsx`.
- Pages, each routed by `web/routing.ts`:
  - New session: `web/components/new-session.tsx`, also used for todo drafts and scheduled starts.
  - Pull requests: `web/components/pull-requests/pull-requests-page.tsx`, its board view `PullRequestsKanban` in `pull-requests-kanban.tsx` with each card `PullRequestCard` in `pr-row.tsx`, and one pull request in `pr-page.tsx` beside it.
  - Tickets: `web/components/tickets/tickets-page.tsx`.
  - Todo: `web/components/todo/page.tsx`.
  - Calendar: `web/components/calendar/calendar-page.tsx`.
  - Inbox: `web/components/inbox/inbox-page.tsx`.
  - Routines: `web/components/routines/routines-page.tsx`.
  - Projects: `web/components/projects/projects-page.tsx`; a project's **Project** and **User** notes trees are `ProjectNotesList` in `project-parts.tsx` beside it, over `noteRows` in `web/notes-model.ts`.
  - Settings: `web/components/settings/settings-page.tsx`, one `*-tab.tsx` per section listed in `SETTINGS_SECTIONS` in `web/routing.ts`.
    Settings › Analytics' context-source table: `ContextSources` in `web/components/settings/context-sources.tsx`.
    Settings › Integrations' Google account lines, with **Add account**, **Remove**, and the workspace picker: `GoogleAccountsRow` in `web/components/integrations/google-accounts.tsx`.
    Settings › Worktrees, with its **Merged** marks and **Remove merged**: `WorktreesTab` in `web/components/settings/worktrees-tab.tsx`.
    Settings › Sync, with its remote, **Sync** button, last outcome, conflict choices, and item switches: `SyncTab` in `web/components/settings/sync-tab.tsx`.
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
- [Routines, scheduled sends, projects, usage, settings, and tests](code-layout/server-routines-and-settings.md)

## Page

The page lives in `web/`.
`src/server/page.ts` bundles `web/index.html` and `web/main.tsx` with `Bun.build`, and `bun-plugin-tailwind` compiles Tailwind v4.
Its files, listed by area:

- [Shell, state, and models](code-layout/page-core.md)
- [List models, sidebar tabs, model menu, and mentions](code-layout/page-models.md)
- [Status bar, terminal, HTTP reads, shortcuts, and theme](code-layout/page-reads-and-chrome.md)
- [Sidebar, Todo, Routines, Projects, Calendar, and Inbox](code-layout/page-pages.md)
- [Panes, session details, and changes](code-layout/page-panes.md)
- [Pull requests, tickets, settings, integrations, and primitives](code-layout/page-pull-requests-and-settings.md)
