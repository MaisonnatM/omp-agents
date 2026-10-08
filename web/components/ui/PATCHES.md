# Dashboard patches to vendored registry files

Files in `web/components/ui/`, `web/lib/`, and `web/hooks/` come from the Fluid registry, and files in `web/components/kibo-ui/` from Kibo UI's.
This list holds every change the dashboard makes to them, so an upgrade is a merge that checks each entry.
Dashboard behavior that can live outside these files does: the composer's queued rows are `web/components/composer-queue.tsx`, and its suggested prompts are `web/components/composer-suggestions.tsx`.

## `ui/input-message.tsx`

- `textareaProps.onKeyDown`: runs first in the textarea's key handler, and a key it prevents goes no further.
  The completion list and the dashboard's composer shortcuts need the key before the submit and history handling.
- `textareaProps.onPaste`: runs first in the paste handler, and a pasted file that `accept` takes attaches instead of pasting its name as text.
  A screenshot or a copied image file is the common paste.
- `stopShortcut`: the keys that press Stop, shown in its tooltip.
- Send and queue buttons show their current action and Enter in a tooltip; Stop keeps its caller-provided shortcut.
- Send button mode: while `status` is `"streaming"`, the button is Stop only when the draft is empty, and a draft sends at once.
  The dashboard steers a running turn with it, and has no queue inside this component.
- `beforeTextarea`: a slot above the textarea and below the attached files, where the dashboard renders its queued rows.
- `afterActions`: a slot under the action bar, inside the composer's frame, where the dashboard renders its suggested prompts.
- `useRegionHeight` and `useIsTouch`: exported, so the dashboard's rows in those slots animate and reveal their × as this component's own regions do.
- The `FluidHoverHighlight` import points at `ui/fluid-hover-highlight.tsx`.
- `InputMessage` is wrapped in `memo` around its `forwardRef`, so a parent's render that leaves its props unchanged skips the composer.
- The default export and the `InputMessageProps`, `InputMessageSlotContext`, and `QueuedMessage` type exports are removed, since nothing imports them.

## `ui/chat-message.tsx`

- `images`: the addresses of the images a sent prompt carried, shown above the bubble, since `files` takes only `File`s held in the browser.
- The hover group is named `group/message`, so a nested `group` inside a message does not reveal its actions.
- The bubble is `max-w-full`, so wide code blocks stay inside it.

## `ui/ask-user-questions.tsx`

- `header`: replaces the `Question N of M` line.
  The dashboard shows the question's status and **Dismiss** there.
- `description` on a question: shows a confirm's message under its title.
- The `FluidHoverHighlight` import points at `ui/fluid-hover-highlight.tsx`.
- The default export is removed, and `AskUserOption` and `AskUserQuestionsProps` are no longer exported, since nothing imports them.

## Others

- `ui/tooltip.tsx`: `shortcut`, the keys that run the trigger's action, drawn as chips after `content`, and the exported `TooltipKbd` chip.
  Long labels wrap at 16rem.
  `ui/sidebar-core.tsx` uses `TooltipKbd` for the sidebar rail's tooltip.
- `ui/tabs.tsx`: `tooltip` names compact tabs without needing a shortcut; `shortcut` adds keys and keeps the tab's `data-state`, since the tooltip trigger stamps its own.
  `badge` on `TabItem` draws a count after the label, which the Sessions tab uses for the sessions waiting on you and the Inbox tab for the pull requests ready to merge.
- `ui/thinking-steps.tsx`: `icon` takes a component as well as a name, and `iconClassName` styles it.
- `ui/sidebar.tsx`: `scroll-fade-once-scrolled` on the scroll areas, so the fade shows only once scrolled.
- `ui/sidebar-menu.tsx`: `gap-0.5` between rows, and the `FluidHoverHighlight` import points at `ui/fluid-hover-highlight.tsx`.
- `ui/sidebar-menu.tsx`: `SidebarMenuActions`, `SidebarMenuSkeleton`, `SidebarMenuSub`, `SidebarMenuSubItem`, and `SidebarMenuSubButton` are removed, since nothing renders them.
  `sidebarMenuButtonVariants` and the `SidebarMenu*Props` types are no longer exported.
  `useMenuRow`'s `isSubRow` and `MenuActionsClusterContext` stay, and now always take their default.
- `ui/sidebar-core.tsx`: `SidebarTrigger`, `SidebarFooter`, `SidebarSeparator`, and `SidebarGroupContent` are removed, since nothing renders them, along with the unused `Button` import.
  `SidebarRail`, the `SIDEBAR_*` constants, and the prop types are no longer exported; `SidebarShell` still renders the rail.
- `ui/sidebar.tsx`: re-exports only the parts the dashboard imports, and `SidebarProps` and `SidebarContentProps` are no longer exported.
- `ui/file-thumbnail.tsx`: the PDF worker comes from the page bundle, not a CDN, which the page's Content-Security-Policy blocks.
- `lib/icon-context.tsx`: the `git-branch` icon.
- `ui/fluid-hover-highlight.tsx` is the registry file unchanged, moved from `web/components/` into `ui/`.

## `kibo-ui/calendar/index.tsx`

The registry file uses shadcn's `button`, `command`, and `popover`; the dashboard keeps Fluid's, so it imports those.

- The month and year pickers' button is `variant="ghost"`, in the semibold month title's size, since Fluid's button has no `outline`, and takes a `ChevronDown` as `trailingIcon`, since Fluid's button puts an icon among its children on a line of its own.
- `CalendarBody`, `CalendarHeader`, `CalendarItem`, `Feature`, and `Status` are removed, along with the provider's `startDay` and the `date-fns` import.
  `web/components/calendar/calendar-page.tsx` draws the month from its own entries, so it needs no generic feature list.
- The month arrows have `aria-label`s, **Previous month** and **Next month**.
