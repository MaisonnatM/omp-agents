# Front-end components

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`.
The roster uses `sidebar`, and its **Pull requests**, **Tickets**, **Sessions**, **Todo**, **Calendar**, **Email**, and **Settings** switch uses `tabs`, installed from `https://www.fluidfunctionalism.com/r/radix/tabs.json`.
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

The sidebar rows' and pull request rows' menus use Base UI's `ContextMenu` for right-click and its `Menu` for the **⋯** button, wrapped in `web/components/ui/menu.tsx` with the look of the `popover` and `command` items.
Both share Base UI's menu items, so each row builds one item list and both menus render it.
The wrapper also opens the context menu on the context-menu key and Shift+F10 at the focused row, because not every platform sends a `contextmenu` event for them.
It leaves a right-click inside a popup the row portals out, such as a picker's search field, to the browser, since React passes that event up to the row.

A session's PRs sidebar holds the PR it shows and its detail tab in `SessionPullRequestsTab`'s component state, keyed by the session, so nothing is stored.
Only the main PR detail registers the copy-number and copy-link shortcuts.

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
The grammars are a chunk of their own, which the first code the page shows loads through `loadedOnce` in `web/loaded-once.ts`; until it lands, code shows uncolored, and each highlighting component renders again in color once it does.
In agent text, raw HTML is escaped, unsafe link schemes are filtered, and an image renders as a link unless it is a `data:` URL or a path to an image or video on this computer, which `LocalMedia` in `web/components/local-media.tsx` shows through `GET /api/media`.
In agent text, `remarkFilePaths` in `web/file-paths.ts` turns a path to a text, image, or video file into a link, and that link, like a `file://` one, renders as a `FileLink` from `web/components/file-link.tsx`, which opens the file dialog through the dashboard context.
It then ends the text with a `figure` naming the images and videos those links name, each once, but for those an image already shows; `MediaStrip` draws it as thumbnails, each dropping out when its file does not load.
A `file://` address whose escapes do not decode renders as a link with no address, and text from GitHub keeps no `file://` path, since it renders through the default filter.
A relative path resolves against `FileBaseContext`: the pane's session worktree, from `SessionFacts.worktree`, else its directory, or the directory of the file the dialog shows.
Text from GitHub, which means pull request descriptions and comments, and Linear issues' text, renders its raw HTML through `rehype-raw` and then `rehype-sanitize` with its default schema, which follows GitHub's, plus a `<video>` and its `<source>`, each with only a `src`.
Those two plugins are `RAW_HTML` in `web/components/raw-html.ts`, a chunk of its own that `MessageMarkdown` loads for the first such text, which renders nothing until it lands, so its HTML never shows as escaped text; should the chunk fail to load, the text renders with its HTML escaped.
It shows GitHub's avatars and images from the route for a Linear issue's files, and shows images and plays videos uploaded to GitHub through `GET /api/github-media`; a video from anywhere else, and any other image, renders as a link.
`web/index.html` sets the page's `Content-Security-Policy`.

## Session visuals

A session's conversation renders through `SESSION_AGENT_PRESET` and `SESSION_PROMPT_PRESET`, which `MessageRow` in `web/components/transcript.tsx` passes for a settled reply and for a prompt; a streaming reply keeps `AGENT_PRESET`, so its fences stay code until the whole source has arrived.
Every other Markdown, such as GitHub's and Linear's text, the file dialog, and a turn's reasoning, keeps its preset, with no visuals.
In those two presets a `mermaid` or `chart` fence renders as `SessionVisual` from `web/components/session-visual.tsx`, and any other fence as the code block above.
`src/shared/session-visuals.ts` holds the rules both sides share: `mermaidKind` reads a diagram's first line as beautiful-mermaid's `detectDiagramType` does and accepts only flowcharts, sequence, state, class, and ER diagrams, in at most `MAX_MERMAID_SOURCE` characters, and `parseChartSpec` turns a chart's JSON into a `ChartSpec` or the first rule it breaks.
A chart's keys must be letters, digits, `_`, and `-`, since `ChartStyle` in `web/components/ui/chart.tsx`, shadcn's chart, writes each series key into a CSS custom property, `--color-<key>`.
A chart renders through that component and `recharts`, its series colored `var(--chart-1)` to `var(--chart-5)` from `web/globals.css`.
`ChartView` lives in `web/components/session-chart.tsx`, which `SessionVisual` loads with `React.lazy`, so `recharts` loads with the first chart, as it does for the Analytics tab's `ProviderTrend`.
A diagram renders with `renderMermaidSVGAsync` from `beautiful-mermaid`, which the page imports on first use; `buildPage` in `src/server/page.ts` builds with `splitting`, so the library and its ELK layout are a chunk of their own.
The SVG never enters the page's DOM: it shows as an `<img>` whose source is a blob URL, revoked when the source or theme changes or the block unmounts, so its markup cannot script the page, and the CSP already allows `blob:` images.
An image cannot read the page's CSS variables, so the diagram takes the concrete colors of `--background`, `--foreground`, and `--muted-foreground` where the `.dark` class stands, read through a probe element, and renders again when `useDarkClass` in `web/theme.ts` sees the class change.
A render that a newer source or theme outdated is dropped, and a render that throws shows the fence's text with the error.

The model learns the two formats from `src/omp/session-visuals-extension.ts`, whose `before_agent_start` handler appends a paragraph, built from the same limits, to the system prompt.
`DashboardSession` passes it with `-e` when it starts, forks, or resumes a session (`withSessionVisuals` in `src/dashboard-session.ts`), but not for a replay, or for a resumed replay, whose requests the replay guard compares with the original's, system prompt included.
The extension sits outside `templates/omp/agent/`, so the starter kit never installs it and a terminal session never loads it, and it types the part of omp's API it uses by hand, as `tsc` cannot resolve omp's package.
`sessionVisualsExtension` in `src/server/resources.ts` names the file, and the packaged app ships it bundled as `session-visuals-extension.js`, as it ships the keeper.
