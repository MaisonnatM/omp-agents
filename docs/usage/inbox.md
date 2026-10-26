# Inbox

- The **Inbox** tab, G then I, or an `#inbox` address shows the latest 50 conversations of each Gmail inbox the sidebar's workspace shows, merged newest first, in place of the panes.
  The tab and its shortcut show only once a Gmail account is connected in **Settings › Integrations**; see [Integrations](integrations.md).
  The sidebar then shows your Gmail address over one **Inbox** row with how many conversations are unread; with several accounts it shows **All inboxes** and a row for each address, each with its unread count, and picking one narrows the list to that account and leaves an open conversation open, a choice this browser keeps.
  While the workspace shows one account, the list shows it whatever was picked, and the pick comes back in a workspace that shows that account among others.
  While the list holds several accounts, each conversation is tagged with its inbox's address, and a new mail picks the address it is sent **From**.
  A conversation opens at `#inbox/<account>/<thread id>`, and opening such an address while the picker narrows to another account picks the conversation's own; an account that cannot be read says why above the list while the others still show.
- Each row shows, on three lines, who sent the conversation's last message, how many messages it holds when more than one, and when its last message arrived: the time today, the day earlier this year, and the full date before; then its subject; then a snippet.
  An unread conversation's sender and subject are bold, with a blue dot before them, and the header counts them beside your address.
- Click a row, or focus it and press Enter, to open the conversation in a panel beside the list, at its `#inbox/<account>/<thread id>` address; its row shows selected, with a bar on its left edge.
  Arriving at the page, from the **Inbox** tab, G then I, or the Inbox's number, opens the newest conversation.
  Closing it leaves the list with nothing open, and the panel then says how to open one.
  Drag the line between the list and the panel to size the list, which keeps that width; a page too narrow for both shows the panel in place of the list.
  With no conversation open, ↓ and ↑ outside text fields focus the next and previous row, and O opens the focused row's conversation in Gmail in a new tab, signed in as the inbox's address.
- Right-click a row, or focus it and press the context-menu key or Shift+F10, for **Open**, **Open in Gmail**, and **Delete**.
  **Delete** moves the conversation to Gmail's Trash, as the open conversation's **Delete** does; deleting the open one opens its neighbour.
- An open conversation's panel has a bar along its top with where the conversation sits in the list, **3 of 50**, and icon buttons, each naming itself and its key on hover: previous and next conversation, **Reply**, **Reply all**, **Delete**, **Expand all** while a message is folded, **Refresh**, which spins while it reads, **Open in Gmail**, and **Close**.
  Under the bar come its subject in large type and, on a muted line, how many messages it holds, drafts left out, and each person who wrote in it once, `me` for your own address.
  Opening another conversation scrolls the panel back to its top.
  The conversation fills the panel's width, and an HTML message grows with it.
- Messages follow each other with a thin line between them, each with a round avatar of the first letter of its sender's name past a leading `the`, `a`, or `an`, in a colour that sender's address always takes.
  As in Gmail, the last message and every unread one show in full and earlier ones on one line with their avatar, sender, snippet, and date, the sender bold while unread; three or more of those in a row after the first fold into a line with an **N older messages** pill on it.
  Click a line or the pill to unfold it, click a full message's header to fold it again, and **Expand all** unfolds every message.
- A full message shows its sender's name and address, when it arrived, with the full date and time on hover, and whom it went to, then under the name its attachments by name and size, and its text.
  An HTML message shows as its sender wrote it, on white in both themes, with its scripts, forms, and popups blocked; it may load images, styles, and fonts, never sends the dashboard's address as the referrer, and its links open in a new tab.
  A plain text message keeps its line breaks, and its web addresses are links.
  The dashboard does not download attachments; **Open in Gmail** opens them there.
- While a conversation is open, ↓ and ↑ or the bar's arrows open the next and previous conversation of the list and focus its row, which the list scrolls into view; the page reads those neighbours ahead so they show at once.
  Esc or **Close** closes the panel with that conversation's row focused, and O opens the focused row's conversation in Gmail, else the open one.
  The keys work after a click inside an HTML message too.
  **Refresh** reads it from Gmail again, and the page also does once the list shows a message that arrived after it read the conversation.
- **Reply**, the **Reply to…** line under the messages, or R outside text fields, docks an editor at the bottom of the conversation, which scrolls above it, to answer its last message: to its `Reply-To` or sender, or, for a message you sent, to whom you sent it.
  **Reply all**, or A, also copies everyone else that message named; your own address is left out of both.
  The recipients are chips you can edit: type an address and press Enter, a comma, a semicolon, or Tab to add it, Backspace in an empty field to remove the last, and **Cc** or **Bcc** to show those rows.
  The editor takes its recipients when the reply begins: a refresh, or a message that arrives while you write, leaves them as they are, and only choosing the other of **Reply** and **Reply all** addresses the reply again, to the conversation's last message, keeping **Bcc** and what you wrote.
  The editor writes rich text: its toolbar and Cmd+B, Cmd+I, and Cmd+U make bold, italic, and underline, a link, bulleted and numbered lists, and a quote, and a pasted web address becomes a link.
  The expand button grows the editor over the conversation, and shrinks it back.
  Cmd+Enter or **Send** sends the mail as HTML with a plain text copy, in the conversation, which then shows in the conversation and the list.
  While it sends, the editor shows **Sending…** and takes no edit, so what you see is what goes; a failed send reopens it as it was, with **Cannot send** and why, and a mail Gmail took stays sent and closes the editor even when the browser cannot forget its draft.
  Esc closes the editor and keeps the draft in the browser, per conversation, until you reopen it, as long as anything in it differs from how it began, recipients included; **Discard draft** drops it.
- **Compose**, in the header, or C outside text fields, opens a new mail at `#inbox/new` in the panel, in the same editor, with a **Subject** row, focused on **To**; it keeps its draft the same way, and sending it goes back to the list.
- **Delete**, or #, moves the conversation to Gmail's Trash, where Gmail keeps it 30 days, with no confirmation, and opens the next conversation of the list, else the previous one.
- The page never labels a conversation or marks it read, so opening one here leaves it unread, in Gmail and in the list, until you read it in Gmail.
- The page reads Gmail again every minute while it is open, and **Refresh** asks Gmail at once; the server keeps each read for a minute.
  While Gmail is not connected, or its sign-in stops working, the page shows Gmail's row from **Settings › Integrations** to connect from there.
