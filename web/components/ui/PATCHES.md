# Dashboard patches to vendored Fluid files

Files in `web/components/ui/`, `web/lib/`, and `web/hooks/` come from the Fluid registry.
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

## `ui/chat-message.tsx`

- `images`: the addresses of the images a sent prompt carried, shown above the bubble, since `files` takes only `File`s held in the browser.
- The hover group is named `group/message`, so a nested `group` inside a message does not reveal its actions.
- The bubble is `max-w-full`, so wide code blocks stay inside it.

## `ui/ask-user-questions.tsx`

- `header`: replaces the `Question N of M` line.
  The dashboard shows the question's status and **Dismiss** there.
- `description` on a question: shows a confirm's message under its title.
- The `FluidHoverHighlight` import points at `ui/fluid-hover-highlight.tsx`.

## Others

- `ui/sheet.tsx`: the close button uses the shared tooltip with an Esc keycap instead of a native `title`.

- `ui/tooltip.tsx`: `shortcut`, the keys that run the trigger's action, drawn as chips after `content`, and the exported `TooltipKbd` chip.
  Long labels wrap at 16rem.
  `ui/sidebar-core.tsx` uses both for the sidebar toggle.
- `ui/tabs.tsx`: `tooltip` names compact tabs without needing a shortcut; `shortcut` adds keys and keeps the tab's `data-state`, since the tooltip trigger stamps its own.
  `badge` on `TabItem` draws a count after the label, which the Sessions tab uses for the sessions waiting on you and the Inbox tab for the pull requests ready to merge.
- `ui/thinking-steps.tsx`: `icon` takes a component as well as a name, and `iconClassName` styles it.
- `ui/sidebar.tsx`: `scroll-fade-once-scrolled` on the scroll areas, so the fade shows only once scrolled.
- `ui/sidebar-menu.tsx`: `gap-0.5` between rows, and the `FluidHoverHighlight` import points at `ui/fluid-hover-highlight.tsx`.
- `ui/file-thumbnail.tsx`: the PDF worker comes from the page bundle, not a CDN, which the page's Content-Security-Policy blocks.
- `lib/icon-context.tsx`: the `git-branch` icon.
- `ui/fluid-hover-highlight.tsx` is the registry file unchanged, moved from `web/components/` into `ui/`.
