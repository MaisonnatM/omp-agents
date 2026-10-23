# Front-end components

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`.
The roster uses `sidebar`, and its **Pull requests**, **Tickets**, **Sessions**, **Todo**, **Calendar**, **Inbox**, and **Settings** switch uses `tabs`, installed from `https://www.fluidfunctionalism.com/r/radix/tabs.json`.
User and assistant turns use `chat-message`, and the composer uses `input-message`.
Tool calls and the model's thinking use shadcn's Base UI `trace`, vendored as `web/components/ui/trace.tsx` on `web/components/ui/collapsible.tsx`, and code blocks in messages its `code-block`, vendored as `web/components/ui/code-block.tsx`.
The utilities both use from shadcn's `tailwind.css`, such as `shimmer` and `scroll-fade-x`, are copied into `web/shadcn.css`, since that file's `scroll-fade` would clash with the page's own.
`thinking-indicator` shows while the agent works.
`Button`'s `loading` prop preserves its label's width, shows a spinner, disables the control, and sets `aria-busy`.
`InputMessage` takes `sending` and `stopping` for its send and Stop controls.
shadcn's `message-scroller` follows streaming content, preserves the reader's scroll position, and supplies the jump-to-latest button.
The model, thinking, and workspace pickers use shadcn's `popover` and `command` combobox pattern, and the Calendar page's day cards shadcn's `hover-card`.
Fluid's sidebar rail, mobile drawer, cookie, and toggle shortcut are removed from the vendored sidebar, which keeps only the bordered panel.
The dashboard sizes and toggles each sidebar in `web/components/sidebar-panel.tsx`, which gives each its own width and open state, because Fluid's provider held only one of each.
Sidebar widths and the split between panes share `web/components/drag-separator.tsx`: `useDragSeparator` owns the pointer capture, arrow keys, and double-click reset, and `Separator` is the element.
Each call site still clamps its own domain, pixels for a sidebar and a ratio for a split.

The pull request detail tabs use `web/components/segmented-tabs.tsx`, a reusable Radix Tabs wrapper with T3's 24px segmented styling.
Radix owns automatic arrow-key selection, roving focus, and the tab-to-panel ARIA links.
`presentChecks` in `web/pull-request-checks.ts` derives the status line and attention, running, and completed groups from `PullRequestDetail.checkRuns`.
The check transport remains `{ name, state, url }`, with no timing or separate workflow-approval fields.
Skipped checks stay in the completed group but never count as passed.

The sidebar rows' menus use Base UI's `ContextMenu` for right-click and its `Menu` for the **⋯** button, wrapped in `web/components/ui/menu.tsx` with the look of the `popover` and `command` items.
Both share Base UI's menu items, so each row builds one item list and both menus render it.
The wrapper also opens the context menu on the context-menu key and Shift+F10 at the focused row, because not every platform sends a `contextmenu` event for them.

Open pull request tabs use `web/pull-request-tabs.ts` and the same `useStoredState` localStorage mechanism as the sidebar layout.
The main Pull requests page shares one ordered strip between windows and stores no active tab, since its route says which PR shows.
Each session's or project's PRs sidebar keeps its own tabs and active tab, and keeps navigation local to that sidebar; one key holds them by the session's ID, which stays the same from its live view to its past one, or by the project's ID, for the 20 sidebars whose tabs changed last.
Only the main PR detail registers the copy-number, copy-link, and close-tab shortcuts.
While `PullRequestDetailPage` is mounted it tells the desktop shell through `window.ompDesktop.ownsClose`, and the Electron window's `before-input-event` then bypasses native menu shortcuts for Cmd+W, so the page can prevent the native Close action without the shell knowing the dashboard's routes.

Every fixed list of choices uses shadcn's Base UI `select`, vendored as `web/components/ui/select.tsx` with the menu's popup and row look, in place of the browser's `<select>`.
`FormDialog` is Base UI's `Dialog`, so a `Select` in its form opens and takes focus there; Esc in one of the form's Radix pickers closes only the picker.

Toasts use Base UI's `Toast` through one manager in `web/components/toaster.tsx`, since the page has no Fluid or shadcn toast; they stack at the bottom right in the `popover` look.

Questions use `web/components/question-card.tsx`, the dashboard's own card in the look of Fluid's `ask-user-questions`, which `web/components/user-request.tsx` fills from omp's request.
A select is one row per omp option, and a confirm is **Yes** and **No** rows, both in `question-options.tsx`, which reuses Fluid's hover highlight and merged selection backgrounds; an input or an editor is a free-text field.
A terminal session's select takes its checked rows from the request, since omp sends a multi-select pick back as a new request with the row checked.
A dashboard session's `ask` request holds every question; `AskCard` keeps the picks and typed text of each, shows multi-select rows as checkboxes, and sends one `ask` answer after the last question.

Changes the dashboard makes to Fluid's components are listed in `web/components/ui/PATCHES.md`, each with its reason, so an upgrade is a merge that checks each entry.
The dashboard keeps them mechanical where it can.
`InputMessage`'s text field is `PromptEditor` instead of a `<textarea>`, and gets an `onKeyDown` and `onPaste` passthrough, so the completion list and the composer shortcuts see a key before the submit handling and a pasted file attaches, and a `stopShortcut`.
It also gets two slots, `beforeEditor` and `afterActions`: `composer-queue.tsx` renders the queued rows that omp or the server holds into the first, and `composer-suggestions.tsx` into the second the prompts that the last turn's reply ends on, which `splitSuggestions` in `src/transcript.ts` splits off the reply into the assistant item's `suggestions`.
Its own queue, history recall, and suggested prompts are removed, since those slots replace them.
`ChatMessage` gets `files`, the names of the files a sent prompt carried as text, and `images`, the addresses of the images it carried.

Markdown uses `react-markdown` and `remark-gfm` (`web/components/message-markdown.tsx`).
A fenced code block renders as a `CodeBlock`, colored line by line by `highlightLines` in `web/code-highlight.ts`, the `lowlight` grammars the changes view uses, rather than shadcn's `shiki` hook, so the page bundles one highlighter.
In agent text, raw HTML is escaped, unsafe link schemes are filtered, and an image renders as a link unless it is a `data:` URL or a path to an image or video on this computer, which `LocalMedia` in `web/components/local-media.tsx` shows through `GET /api/media`.
In agent text, `remarkFilePaths` in `web/file-paths.ts` turns a path to a text, image, or video file into a link, and that link, like a `file://` one, renders as a `FileLink` from `web/components/file-link.tsx`, which opens the file dialog through the dashboard context.
It then ends the text with a `figure` naming the images and videos those links name, each once, but for those an image already shows; `MediaStrip` draws it as thumbnails, each dropping out when its file does not load.
A `file://` address whose escapes do not decode renders as a link with no address, and text from GitHub keeps no `file://` path, since it renders through the default filter.
A relative path resolves against `FileBaseContext`: the pane's session worktree, from `SessionFacts.worktree`, else its directory, or the directory of the file the dialog shows.
Text from GitHub, which means pull request descriptions and comments, and Linear issues' text, renders its raw HTML through `rehype-raw` and then `rehype-sanitize` with its default schema, which follows GitHub's, plus a `<video>` and its `<source>`, each with only a `src`.
It shows GitHub's avatars and images from the route for a Linear issue's files, and shows images and plays videos uploaded to GitHub through `GET /api/github-media`; a video from anywhere else, and any other image, renders as a link.
`web/index.html` sets the page's `Content-Security-Policy`.
