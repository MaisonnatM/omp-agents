# Inbox

The **Inbox** row at the top of the Sessions sidebar, G then I, or `#inbox` opens everything that waits on you, across workspaces.
The row counts the items.

Items come in groups, in this order: **Agents asking**, **Agents finished**, **Pull requests**, **Messages**, and **Stopped**.
Within a group, the longest-waiting item comes first; questions keep the sidebar's order and show no age.
A session that asks something appears once, under **Agents asking**, even when it also finished a turn you have not read.
Each row shows a status mark, a title, the project, repository, or channel, and the wait, then a second line: the question, the first suggested prompt after ↳, or the notice's preview.
**All**, **Agents**, **Pull requests**, and **Messages** at the top filter the list, each with its count; a filter with no items says so.

The open item shows on the right, under a bar with its status mark, title, place, and wait, the previous and next buttons with the item's place in the list, and its buttons: **Mark read** or **Clear**, **End session**, and **Open session** or **Open**.
A question or a finished turn shows the session's own conversation, as its pane does: the transcript, scrolled to its end, the question card, and the composer with its model, attachments, **Stop**, queue, and numbered suggested prompts.
A message sent from that composer, or a question answered in its card, goes to the session, and the Inbox opens the next item once the session's item leaves the list.
Showing a session's item does not mark its turn read; **Mark read** or D does.
A notice shows its preview and the same button as in the notices bell: a pull request's quick action or **Merge**, or a stopped-sessions notice's **Continue all**.
Using that button clears the notice from the Inbox and opens the next item.

Outside text fields:

- J and K, or ↓ and ↑, open the next or previous item.
- 1 to 9 answer the question, or send that suggested prompt.
- 0 sends every suggested prompt as one list.
- R focuses the composer.
- D marks a finished turn read or clears a notice.
- E ends the session.
- Enter, with nothing focused, opens the session or the notice's link.

While the server works on **Mark read**, **Clear**, or **End session**, that button shows a spinner, and while it sends a suggested prompt, the bar shows **Sending…**; meanwhile the item takes no other action.
Once the server confirms, the next item opens, so you can work down the list without picking.
If it fails, a toast says why and the item stays open.
`#inbox?open=<key>` addresses one item.
The divider resizes the list, and the app remembers its width.
