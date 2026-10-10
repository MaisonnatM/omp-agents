# Dashboard patches to vendored registry files

Files in `web/components/ui/`, `web/lib/`, and `web/hooks/` come from the Fluid registry, and files in `web/components/kibo-ui/` from Kibo UI's.
This list holds every change the dashboard makes to them, so an upgrade is a merge that checks each entry.
Dashboard behavior that can live outside these files does: the composer's queued rows are `web/components/composer-queue.tsx`, and its suggested prompts are `web/components/composer-suggestions.tsx`.
A session's question is `web/components/question-card.tsx`, a dashboard card in the look of Fluid's `ask-user-questions`, which the dashboard no longer vendors.

## `ui/input-message.tsx`

- The text field is `PromptEditor` (`web/components/prompt-editor.tsx`), a contenteditable that shows each skill, command, file, ticket, pull request, todo, and session reference as a chip, instead of a `<textarea>`.
  Its height follows `minRows` and `maxRows` in CSS, so the JS autoresize is gone.
  `textareaProps` is `editorProps`, and `editorRef` exposes the caret and focus that callers read from the textarea before.
- `editorProps.onKeyDown`: runs first, in the capture phase, and a key it prevents goes no further, not even to the editor.
  The completion list and the dashboard's composer shortcuts need the key before the submit and history handling.
- `editorProps.onPaste`: runs first in the paste handler, and a pasted file that `accept` takes attaches instead of pasting its name as text.
  A screenshot or a copied file is the common paste.
- `accept` takes `*/*` as any file, as the browser's file picker does; the dashboard's composer reads or refuses each file itself.
- `stopShortcut`: the keys that press Stop, shown in its tooltip.
- `stopping`: the Stop button shows its spinner while the consumer's stop runs.
- The send button shows its current action and Enter in a tooltip; Stop keeps its caller-provided shortcut.
- Send button mode: while `status` is `"streaming"`, the button is Stop only when the draft is empty, and a draft sends at once.
  The dashboard steers a running turn with it.
- The built-in queue (`queue`, `onQueueChange`, `showQueue`, `QueuedRow`, the auto-dispatch on the streaming-to-idle edge, the Queue button mode, and `onSend`'s `meta`), history recall (`history`), the Tab-filled `placeholderSuggestion`, and the built-in `suggestions` list are removed.
  The dashboard renders its own queue and suggestions in `beforeEditor` and `afterActions`.
- `clickToFocus`, `maxFiles`, and `filePreviewSize` are removed, since the dashboard never set them: a click on the frame always focuses the text field, any number of files attach, and previews are 80px.
- `sending`: keeps the send button loading and disabled until the consumer's send settles.
- `beforeEditor`: a slot above the text field and below the attached files, where the dashboard renders its queued rows.
- `afterActions`: a slot under the action bar, inside the composer's frame, where the dashboard renders its suggested prompts.
- `useRegionHeight` and `useIsTouch` move to `hooks/use-region-height.ts` and `hooks/use-is-touch.ts`, and `FilePreviewTile` to `ui/file-preview-tile.tsx`, so the dashboard's rows in the slots animate and reveal their × as the attachments do.
- `InputMessage` is wrapped in `memo` around its `forwardRef`, so a parent's render that leaves its props unchanged skips the composer.
- The default export and the `InputMessageProps`, `InputMessageSlotContext`, and `QueuedMessage` type exports are removed, since nothing imports them.

## `ui/chat-message.tsx`

- `files`: the names of the files a sent prompt carried as text, shown as chips above the bubble, in place of the registry's `File`s held in the browser and its `thumbnailSize`.
- `images`: the addresses of the images a sent prompt carried, shown above the bubble.
- The hover group is named `group/message`, so a nested `group` inside a message does not reveal its actions.
- The bubble is `max-w-full`, so wide code blocks stay inside it.

## Others

- `ui/button.tsx`: `loading` also sets `aria-busy`; otherwise the caller's `aria-busy` is preserved.
- `ui/tooltip.tsx`: `shortcut`, the keys that run the trigger's action, drawn as chips after `content`.
  Long labels wrap at 16rem.
- `ui/tabs.tsx`: `tooltip` names compact tabs without needing a shortcut; `shortcut` adds keys and keeps the tab's `data-state`, since the tooltip trigger stamps its own.
  `badge` on `TabItem` draws a count after the label, which the Sessions tab uses for the sessions waiting on you and the Pull requests tab for the pull requests that wait on your move.
- `ui/thinking-steps.tsx`: `icon` takes a component as well as a name, and `iconClassName` styles it.
  Its layout effect is React's `useLayoutEffect`, since the dashboard never renders on a server; the same goes for `hooks/use-merge-split.tsx`, `ui/sidebar-group.tsx`, and the sidebar menu files.
- `hooks/use-fluid-hover.ts`: `remeasure` called again before its frame runs does nothing, so a list of rows registering drops readiness and queues one measurement instead of one per row.
- `hooks/use-fluid-hover.ts`: a click in the gap beside a row reaches the row with the click's modifier keys, instead of as a plain `element.click()`.
  A Cmd+click there marks a suggested prompt instead of sending it.
- `ui/sidebar.tsx`: `scroll-fade-once-scrolled` on the scroll areas, so the fade shows only once scrolled.
- `ui/sidebar-menu.tsx`: `gap-0.5` between rows, and the `FluidHoverHighlight` import points at `ui/fluid-hover-highlight.tsx`.
- `ui/sidebar-menu.tsx`: `SidebarMenuActions`, `SidebarMenuSkeleton`, `SidebarMenuSub`, `SidebarMenuSubItem`, and `SidebarMenuSubButton` are removed, since nothing renders them.
  `sidebarMenuButtonVariants` and the `SidebarMenu*Props` types are no longer exported.
  `useMenuRow`'s `isSubRow` and `MenuActionsClusterContext` stay, and now always take their default.
- `ui/sidebar-menu.tsx` is split: the scope, its overlays and the row helpers are `ui/sidebar-menu-scope.tsx`, and `useMenuRow`, the row contexts and the gutter math are `ui/sidebar-menu-row.ts`.
  The scope batches row registration: rows only mark it dirty, and one flush per commit sorts the rows and registers with the fluid hover hook just the indexes whose element changed.
  The scope's context is two: a stable registration context, and the rows' active state, which changes only when a row registers or turns active; `refreshVisibility`, which only `SidebarMenuSub` called, is removed.
  Hover no longer re-renders the rows: a row's icon, dot and label light from the `data-fluid-hover-active` mark on its button through a `group/menu-button` variant, and `MenuRowLabel` takes `active` instead of `lit` and `emphasized`.
- `ui/sidebar-core.tsx` keeps only `SidebarProvider`, `SidebarInset`, `SidebarInput`, and `SidebarHeader`.
  `SidebarTrigger`, `SidebarFooter`, `SidebarSeparator`, `SidebarGroupContent`, the rail, the shell, the mobile drawer, the cookie, the peek, the `[`/`]` shortcut, drag resizing, `useSidebar`, and the `SIDEBAR_*` constants are removed, since the dashboard turns them off and sizes its sidebars in `web/components/sidebar-panel.tsx`.
  `SidebarProvider` is a plain wrapper with no context and no props of its own, and `SidebarInset` drops its `inset`-variant classes.
  The slot helpers are `ui/sidebar-slot.tsx`, and the `SidebarGroup` family is `ui/sidebar-group.tsx`.
- `ui/sidebar.tsx`: re-exports only the parts the dashboard imports, and `SidebarProps` and `SidebarContentProps` are no longer exported.
  `Sidebar` is always the bordered, non-collapsible panel, sized by its `style`; `variant`, `collapsible`, `bordered`, `rail`, and `railTooltipOpen` are removed.
  `SidebarContent` always scrolls in a `ScrollArea`, since the native-scroll branch served only the mobile drawer.
- `ui/file-thumbnail.tsx`: the PDF worker comes from the page bundle, not a CDN, which the page's Content-Security-Policy blocks.
  The generic glyph shows the file's extension under it, so attached `.md` and `.txt` files tell apart.
- `lib/icon-context.tsx`: the `git-branch` and `file-text` icons.
- `ui/fluid-hover-highlight.tsx` is the registry file unchanged, moved from `web/components/` into `ui/`.

## `kibo-ui/calendar/index.tsx`

The registry file uses shadcn's `button`, `command`, and `popover`; the dashboard keeps Fluid's, so it imports those.

- The month and year pickers' button is `variant="ghost"`, in the semibold month title's size, since Fluid's button has no `outline`, and takes a `ChevronDown` as `trailingIcon`, since Fluid's button puts an icon among its children on a line of its own.
- `CalendarBody`, `CalendarHeader`, `CalendarItem`, `Feature`, and `Status` are removed, along with the provider's `startDay` and the `date-fns` import.
  `web/components/calendar/calendar-page.tsx` draws the month from its own entries, so it needs no generic feature list.
- The month arrows have `aria-label`s, **Previous month** and **Next month**.
