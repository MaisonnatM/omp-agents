# HTTP API: Gmail

`GmailClient` in `src/gmail.ts` reads one account's Gmail REST API (`https://gmail.googleapis.com/gmail/v1/users/me`) with the token omp holds for that account's Gmail MCP server, so the Inbox page needs no sign-in of its own; `GmailAccounts` merges every signed-in account's inbox and routes each thread read and write by its `account`.
Gmail's MCP tools answer only for OAuth clients enrolled in Google's Workspace Developer Preview Program, while the API answers any client that requested `gmail.modify`.
The client reads, replies, and moves conversations to Trash; it never deletes mail for good, labels it otherwise, or marks it read.
`GET /api/gmail/inbox` answers an `InboxAnswer` from `src/shared/gmail.ts`, `{ accounts, threads }`: each signed-in account with the error its read failed with, or `null`, and the `MailThread`s of every account's inbox merged newest first, the latest 50 threads of each (`threads?labelIds=INBOX&maxResults=50`).
The page names each account by the address its integration account holds, the one source of an account's address.
An account whose read fails keeps its error while the others answer; only when every account fails is the answer an error.
Each thread is read with `format=metadata` and only its `From` and `Subject` headers, eight at a time.
A `MailThread` holds its `account`, the thread id, the display name of the last message's sender or else its address, the first message's subject, the thread's snippet with its HTML entities decoded, the last message's `internalDate`, whether any message carries the `UNREAD` label, the number of messages, and a link that opens the thread in Gmail under its inbox's address.
A thread without an id, messages, or an arrival time is left out, and one that cannot be read fails its account's read with Google's message, so an account's list never has a silent gap.
The client keeps the answer for a minute, unless `fresh` asks again.
The signed-in address is kept for a minute too, so opening a conversation right after the inbox's read reads no profile.
The Inbox page and its sidebar tab read it through `gmailStore` in `web/reads.ts` every minute while any Gmail account's connection is `ready` or `failing`; otherwise the page shows Gmail's integration row.
The page lists the threads of the accounts `visibleAccounts` keeps for the sidebar's workspace, each tagged with its address while it lists several, and the sidebar's Inbox tab narrows the list to one account.

`GET /api/gmail/thread?account=<account>&id=<thread id>[&fresh]` answers a `ThreadAnswer`, `{ account, id, subject, url, messages }`, from that account's `GmailClient.thread`, which reads `threads/<id>?format=full`; a request without an account or an id is a 400.
Drafts are left out as the inbox leaves them out, the subject is the first message's, and the link is the inbox's.
Each `MailMessage` holds its id, the people its `From`, `To`, and `Cc` headers name, split at commas outside quoted names and angle brackets, its `internalDate`, its `UNREAD` label, its snippet with entities decoded, its body, and its attachments.
An HTML body is only `{ kind: "html" }` in the answer: `GmailClient` keeps the HTML beside the conversation's read, by message id, and the page loads it on its own, so the conversation's JSON stays small.
The body comes from a walk of the message's MIME tree: in `multipart/alternative` the `text/html` version wins over `text/plain`, any other multipart reads as its first part with a body, and a part that names a file is never a body.
Each text part is decoded from base64url in the `charset` its `Content-Type` names, and in UTF-8 when no decoder knows that charset.
Every part that names a file becomes an attachment, with its name, MIME type, and size; nothing downloads it.
A message without an id or an arrival time is left out, and each conversation is kept for a minute per id.
The page keeps the conversations it read in memory only, by id, through `readMailThread` and `useMailThread` in `web/reads.ts`, since bodies are large and private.
It reads a conversation once, reads the next and previous ones of the list ahead while one shows, and reads one again from Gmail on **Refresh**, or when the inbox lists a message that arrived after the last read.

Each `MailMessage` also holds the people its `Reply-To` names, so the page addresses a reply itself: `recipientsOf` in `src/shared/gmail.ts` answers as Gmail does, to the `Reply-To`, else the sender, or to the recipients of a message you sent; replying to all copies everyone else in its `To` and `Cc`, and your address is never a recipient.
The page's editor, `MailEditor` in `web/components/inbox/mail-editor.tsx`, is Lexical with rich text, lists, links, and history; it sends the HTML `$generateHtmlFromNodes` writes and the root's text content.
The draft it shows has one owner, `useMailDraft` in `web/mail-draft.ts`: a `MailDocument` of people, subject, and the editor's document as JSON, `""` while it holds no text, which changes only on the events `mailDraftAfter` takes, such as editing a field, choosing **Reply** or **Reply all**, and beginning or ending.
`useReplyDraft` captures a reply's people from the conversation's last message when the reply begins and again only when you choose the other mode, so a refreshed or newly arrived message leaves the draft as it is.
The hook keeps the draft in localStorage under `omp-agents.mail-draft.thread.<thread id>`, or `omp-agents.mail-draft.new` for a new mail, while any field differs from how it began, as `draftUnchanged` compares them, and removes it once none does.
`decodeMailDraft` in `web/mail-draft.ts` reads a kept draft at that boundary: a draft with a missing or mistyped field, or a body Lexical cannot restore, reads as none.
Sending goes through the same hook, as `sendMailDraft` in `web/mail-draft.ts` runs it: the draft's phase moves from editing to sending, in which `mailDraftAfter` refuses every edit and the editor disables its fields, toolbar, and Lexical's editable, so the document submitted is the one shown.
A failed delivery moves it back to editing with the error, and a delivered one closes the draft first and only then removes its localStorage copy, so a removal that throws is logged and leaves the mail sent instead of offering to send it again.
`PUT /api/gmail/reply` takes a `MailReply`, `{ account, thread, to, cc, bcc, html, text }`, and `PUT /api/gmail/send` a `MailSend`, `{ account, to, cc, bcc, subject, html, text }`, whose `account` is the one it sends from, checked by `parseMailReply` and `parseMailSend` in `src/server/wire.ts`: at most `MAX_RECIPIENTS` people, each with a valid address, at least one of them, a text that is not blank, bodies of at most `MAX_MAIL_BODY` characters, and a subject of at most 1000 with its line breaks dropped; each answers `{}`.
`GmailClient.reply` reads the conversation again with `format=metadata` and the `Subject`, `Message-ID`, and `References` headers, and answers its last message other than a draft.
`mailOf` writes the RFC 2822 message: `To`, `Cc`, and `Bcc`, RFC 2047 encoded words for a name or subject outside ASCII, and a `multipart/alternative` body of base64 UTF-8 `text/plain` then `text/html`; `replyOf` adds `Re: ` before a subject that lacks it and `In-Reply-To` and `References` from the answered message so Gmail threads it.
The client sends it as base64url `raw` to `messages/send`, with the conversation's `threadId` for a reply.
`PUT /api/gmail/trash` takes a `MailTrash`, `{ account, thread }`, and that account's `GmailClient.trash` posts `threads/<id>/trash`; Gmail keeps it 30 days.
Each write drops the kept inbox and that conversation, so the next read asks Gmail.
Google's 403 for insufficient scopes becomes an error that says to sign in to Gmail again in **Settings › Integrations**.

`GET /api/gmail/message?account=<account>&thread=<thread id>&id=<message id>` serves a message's HTML as a document of its own, built by `mailDocument` in `src/server/mail-document.ts`, from that account's `GmailClient.messageHtml`, which reads the conversation's kept read, so opening a conversation asks Gmail nothing more.
A request without all three is a 400, and a message the conversation does not hold, or whose body is not HTML, is a 404.
`mailDocument` drops every tracking pixel from the message, through Bun's `HTMLRewriter`: an `<img>` whose width and height, each the smallest of its attribute and its inline `width`/`max-width` or `height`/`max-height` in pixels, are both at most 3px.
An image that declares only one side, a larger side, or a size in other units stays, so a 1×20 spacer keeps the layout it holds.
The page frames that address, not a `srcdoc`: a `srcdoc` document inherits the page's `Content-Security-Policy` from `web/index.html`, whose `img-src` no message can widen, so a message's images never loaded.
Widening the page's own policy is no answer, since it guards the whole dashboard, rendered transcripts too.
The frame keeps `sandbox="allow-same-origin"` and nothing else.
Without `allow-scripts` the message's scripts and event handlers never run, and the sandbox also blocks its forms, its popups, and a `<meta http-equiv="refresh">`, so it cannot navigate the frame.
That makes `allow-same-origin` safe, and the page needs it to size the frame to the message, to open the message's links in the default browser with no opener or referrer, and to pass keys pressed inside it on to the page's shortcuts.
`MailFrame` sizes the frame once the message's document is parsed, not on `load`, which waits for every image: a tracking pixel whose server never answers kept a message zero pixels tall.
A `ResizeObserver` then grows the frame as images arrive.
The document's response carries the policy `sandbox allow-same-origin; default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:`, so a message loads images, styles, and fonts and nothing else.
Its `sandbox` directive keeps scripts off even when the address opens in a tab of its own.
The response also sends `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`, and the document's head, which comes before the message's markup, holds `<meta name="referrer" content="no-referrer">` too.
The frame sends no header, so its address carries the media key that `mediaSrc` in `web/api.ts` adds, and the route admits it as it does an image.
Remote images still load, so a sender who tracks opens with them sees the dashboard's request, without a referrer.
The frame sits on white in both themes, since mail is written for white.
