# HTTP API: Linear tickets

`GET /api/tickets`, or `GET /api/tickets?fresh` to skip the server's 30-second cache, answers the tickets page with `{ tickets }`.
A failed read is the API's usual `{ error }` with status 500, and the page keeps showing the last tickets it has with the error above them.
The server reads Linear through Linear's MCP server, with the OAuth sign-in that omp keeps for it, through `src/omp/mcp.ts`: it loads omp's own MCP config for the enabled server whose `url` has the `mcp.linear.app` host, and gets an access token for its `auth.credentialId`, or for the id omp files a sign-in for that URL under, from `omp token <credentialId>`, which refreshes the token through omp's credential owner.
The token stays in memory for five minutes and is dropped when Linear answers 401, which the page reports as a hint to reconnect Linear in Settings › Integrations or run `/mcp reauth <name>`; it is never logged.
Linear's GraphQL API refuses that token, so the server calls the MCP endpoint's `list_issues` tool through omp's `callMCP`, a stateless JSON-RPC `tools/call` POST.
It asks for each open state type in full, following the cursor, and for completed, canceled, and duplicate issues updated in the last seven days, in parallel, then drops repeats by identifier.
Each issue carries its `parentId`, the parent's identifier, from which the page nests a listed sub-issue under its listed parent.
`list_issues` and `get_issue` name an issue's labels without their colors, so the server reads each team's labels with `list_issue_labels`, by the team key that prefixes the identifier, and keeps them for five minutes; `?fresh` reads them again too.

`GET /api/ticket?id=<identifier>`, such as `?id=ENG-2368`, answers the tickets page's main content with that issue in full: the row's fields, the assignee, the team's id, the description, who opened it and when, the links Linear attaches to it, its comment threads, its parent, and its sub-issues.
The server calls `get_issue`, `list_comments`, and `list_issues` with `parentId` for the sub-issues, in parallel, through the same MCP sign-in, with no cache, so each opening reads the issue again.
For a sub-issue it then reads the parent with `get_issue`, asking only for the fields its row shows.
It rewrites Linear's `<issue>` mentions as markdown links, its `<linear-image>` tags as image links, its `<linear-embed node-type="video">` tags as `<video>` elements, and other `<linear-embed>` tags as links.
It threads the comments by `parentId`, oldest first.
An identifier that is not a team key, a dash, and a number answers 400.

Linear hands out its files as `uploads.linear.app` addresses whose `signature` JWT expires five minutes after the read.
`loadTicketDetail` reads the raw texts of `get_issue` and `list_comments`, and `rememberUploads` in `src/linear-uploads.ts` keeps the latest signed address of each upload path found in them, in memory, under the issue they were read for.
It drops an address once it expires, and the oldest past 256 addresses, since signing one anew costs one read of its issue.
`linearMarkdown` is a pure text rewrite: it turns each upload address in the description and comments into `GET /api/ticket/media?issue=<identifier>&path=<upload path>`.
That route fetches the kept address, passing the `Range` header on, and streams Linear's answer back with its type, length, range, and validators.
When the kept address is within 30 seconds of expiring, missing after a restart, or refused by Linear, the route reads the issue again and remembers its uploads anew, which signs every file in it; requests for one issue within 10 seconds share that read.
Only paths that a read of the issue named are fetched, so the route reaches nothing but Linear's own uploads, and a path that one issue names is not served under another's identifier.
It serves each file with `Content-Security-Policy: sandbox` and `nosniff`, and anything other than an image, a video, or audio as an attachment, since a file that someone uploaded to Linear is served from the dashboard's origin.
The page's CSP stays `'self'` for media.
`message-markdown.tsx` lets Linear's text load images and play `<video>` only from that route and `GET /api/github-media`.

`GET /api/ticket/options?team=<team id>` answers `TicketOptions` for the issue detail's field pickers: the team's workflow states (`list_issue_statuses`) as `{ status, statusType }` in the order Linear lists them, the workspace's active members (`list_users`), the team's and the workspace's live labels (`list_issue_labels`), and the names of the team's projects (`list_projects`, 50 a page), each paged to its end.
The issue detail's status picker orders the states with the same `statusOrder` as the tickets page's groups.
The server keeps each team's answer for five minutes.
`PUT /api/ticket` takes a `TicketEdit`, `{ id, state?, assignee?, priority?, labels?, project?, dueDate? }`, checked by `parseTicketEdit` in `src/server/wire.ts`, where `state` and `project` name the status and the project as the issue shows them, `assignee` is a user's id, `null` clears a field, and `labels` replaces the whole set by name.
It calls `save_issue` with those fields, drops the cached tickets list, and answers the issue as `GET /api/ticket` reads it after the change.
The issue detail shows a change at once and sends its changes one at a time, and once every change sent has answered, it reads the issue again if Linear refused one.

`PUT /api/todo/ticket` takes a `TodoTicketRequest`, `{ todoId, team }`, checked by `parseTodoTicket`, and `createTicketForTodo` in `src/server/todo-ticket.ts` opens an issue from that top-level todo's title and notes, assigned to the viewer, then links it to the todo through the same list change a socket `user-todo` makes.
It answers 409 without opening an issue when the todo is not a top-level todo outside the archive, has no title, or already links an issue.
Once the issue exists, it answers a `TodoTicketAnswer`: `{ identifier, linked: true }` when the server's todo list holds the link, else `{ identifier, linked: false, error }`, such as when the todo was removed while Linear opened the issue.
Linear and `todos.json` are not one transaction, so the page shows an unlinked issue by its identifier and offers to link it rather than open another.
