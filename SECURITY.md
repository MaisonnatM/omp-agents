# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.
Report it privately through [GitHub's vulnerability reporting](https://github.com/MaisonnatM/omp-agents/security/advisories/new) and include the steps to reproduce it, the affected version or commit, and its impact.
Expect an acknowledgement within a week.

Only the latest commit on `main` receives fixes.

## Threat model

A control link gives full control of the session.
Anyone who holds it can read the whole conversation, prompt the agent, and message its subagents.
The agent runs tools on your machine.
The dashboard treats it that way:

- The server listens on `127.0.0.1` only.
- Links and room keys exist only in server memory, inside the function that opens the room.
  The server never writes them to disk, never logs them, and never sends them to the page.
- The page names a past session by its id and a subagent by the id its host registered.
  The server reads only files from omp's own session listing, the paths omp reports over RPC, and subagent files under those sessions' directories.
  The settings endpoints read and write only the files that omp's discovery reports for the workspace, and their `cwd` must be a directory that a live or saved session ran in.
  The exception is `GET /api/file`, which the file dialog reads: it takes any absolute path, but answers only a regular file whose real path, after symlinks, ends in a text extension such as `.md` or `.tsv`, at most its first 1 MB, and only when that is UTF-8.
  The access token file has no extension, so this route cannot read it, nor an SSH key or a `.env` file.
- Every `/api/` route, the WebSocket, and the page itself need the access token.
  It is 32 random bytes, kept in `~/.config/omp-agents/token` (`$XDG_CONFIG_HOME/omp-agents/token` when that is set).
  The server creates the file with mode `0600` in a directory of mode `0700`, and tightens the mode if it finds it looser, so only your account can read it.
  The token survives restarts.
  The sign-in address that the server prints carries it; opening that address sets an `HttpOnly; SameSite=Strict` cookie that lasts a year, and every later request from that browser carries the cookie.
  Without it, `/` answers a 401 page that tells you to use the printed address, `/api/` answers a 401 JSON error, and the WebSocket upgrade is refused.
  To rotate the token, delete the file and restart the server.
- On top of the token, every request must name `127.0.0.1:<port>` or `localhost:<port>` as its `Host`, so DNS rebinding does not get around the checks.
  The WebSocket and the writes also need an `Origin` that matches it, and the writes require a `Content-Type: application/json` body, which a cross-site form cannot send.
  Every `/api/` request, reads included, is refused when its `Sec-Fetch-Site` header is present and not `same-origin`, so a page on another site cannot make your browser start a pull request or model lookup.
- Session addresses such as `http://127.0.0.1:<port>/#session/<session id>` carry no token.
  Clicking one in a browser that has signed in opens the session: the cross-site click arrives without the `Strict` cookie, so `/` answers a small page, with no data, that sends the browser on to `/` from the dashboard's own origin, with the cookie and the `#session` hash.
  In a browser that never signed in, it shows the 401 page.
- Agent text cannot load remote images: Markdown images in transcripts render as links unless they are `data:` URLs, so a prompt-injected reply cannot send data out through an image URL.
  Text from GitHub keeps images only from GitHub's own image hosts.
  The page's `Content-Security-Policy` limits scripts, connections, and workers to the dashboard itself, and images to the dashboard, `data:`, `blob:`, and those GitHub hosts.
- The token stops web pages and other user accounts, not a program that runs as you: it can read the token file, and it can read your omp files itself.
  Run the dashboard only on a machine that you alone use, and do not expose the port through a tunnel or a proxy.
