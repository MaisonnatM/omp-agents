# HTTP API: Integrations

`MCP_SERVICES` in `src/shared/accounts.ts` holds the services whose MCP server the **Integrations** page signs omp in to, keyed by the ids in `MCP_INTEGRATIONS`.
`integrationOn(host)` there names the service whose server is on a host, which is how the MCP servers page tells an integration's server from one it manages itself.
Linear, Slack, Google Calendar, and Gmail are the four.
Each names its label, the host omp's server for the service is on, and the name and URL of the server a sign-in adds when omp has none.
Each also names its `client`, where its sign-in gets its OAuth client: `none` for Linear, which registers its own, `slack-app` for Slack, and `google-oauth` for Google Calendar and Gmail.
Its `requireRefresh` says whether a sign-in refuses a grant without a refresh token, which only Slack's does.
Its `accounts` says whether it signs in to the first server on its host (`one`, Linear and Slack) or holds an account per server on its host (`many`, Google Calendar and Gmail).
`src/integrations.ts` reads these fields for every service rather than naming one, keeps one sign-in at a time per service, and picks each service's kind once: a single server for `one`, or the accounts `src/google-accounts.ts` keeps for `many`, each answering the same load, sign-in, remove, and drop of every sign-in.
The page adds each service's brand mark and what it gives.
`SLACK_USER_SCOPES` is the chat, history, search, and user set a dedicated Slack app may grant.
Canvas, list, file, reaction, and channel-creation scopes are not requested.

Google's MCP endpoints answer only their bare URL, so omp would file every account's sign-in under that URL; each account is a server on the service's host instead, and every sign-in to one, the first included, lands on a new credential id `mcp_oauth_omp_agents_<hex>` that its server's `auth.credentialId` names, a prefix `omp token` refreshes and `removeManagedMcpOAuthCredentials` removes.
A server that held a sign-in before accounts keeps omp's URL-keyed credential id until its next sign-in, so no sign-in moves on upgrade.
An added account's server is named `<serverName>-<n>`, the first `n` from 2 that names no server omp loads.
An add asks Google with `prompt: "select_account consent"`, so Google shows its account chooser.
`signInAccount` in `src/google-accounts.ts` writes the server to name the new id only after the grant is stored and its address claimed, since omp answers a server whose own sign-in is missing with the one filed under its URL, another account's.
Its claim asks Google for the address, lowercased, and refuses one that another account of the service already holds.
A refused, unreadable, or failed sign-in removes the new grant and leaves the server, its old sign-in, and its address as they were, so a failed add leaves neither a server, an address, nor a sign-in; a kept one removes the server's old grant.
A read of the integrations may learn a missing address, lowercased, and never signs out; when Google will not say it, the account's `addressError` says why.
While the only server on a host holds no sign-in, an add signs in to that server instead of adding one.
`signOutMcp` in `src/omp/mcp.ts` removes only a server's own credential id, and the URL-keyed ids only when its own id is one of them, as `/mcp unauth` does for Linear's and Slack's servers, so signing out an added account never signs out a server still filed under its URL.
Removing an account removes its server first, then its row; the last server on a host stays, signed out, because it holds the OAuth client, which `saveClient` writes to every server on the host.
`google-accounts.json` beside the access token (`src/server/google-accounts-file.ts`) keeps each account's lowercased address by server name, learned from Gmail's profile or the Calendar list's primary entry, and each lowercased address's linked workspaces, so a Gmail and a Calendar account whose addresses differ only in case share one link; `visibleAccounts` in `src/shared/accounts.ts` is the one rule the Inbox, the Calendar, and the `@` menu filter by.
Reading the integrations forgets the address of an account whose server is gone from the servers that read listed.
Forgetting an address keeps its links on purpose, so an account added again as the same address is linked as before.
`accountClients` makes one `GmailClient` or `GoogleCalendarClient` per signed-in account, keyed by its server's credential id, so a sign-in makes it again and it never answers from another account's caches; it drops a client once its server is gone, and `GmailAccounts` and `GoogleCalendars` merge their reads with one failing account kept apart from the others.
The starter kit's `extensions/google-accounts.ts` reads `google-accounts.json` and omp's user `mcp.json` at each prompt; while a service has two or more accounts, it tells the session each account's server name, address, and tool prefix, and the addresses linked to the session's workspace.
It finds that workspace as the deepest linked one the session's real directory is in, else the one its repository's main checkout, the parent of `git rev-parse --git-common-dir`, is in, so a linked worktree outside the repository takes the main checkout's links.

`GET /api/integrations` answers `{ integrations }`, one `McpIntegration` under each service's id: `{ id, connection, signIn, setup }` for Linear and Slack, and `{ id, accounts, signIn, setup }` for Google Calendar and Gmail.
Each `GoogleAccount` there is `{ name, address, addressError, connection, workspaces }`, its server's name, the address learned for it or `null`, why the latest read of that address failed or `null`, where omp stands with its server, and the workspaces its address is linked to.
`signIn` also names the `account` it signs in to, `null` while it adds one.
`setup` is the one its `client` decides, through `clientSetup` in `src/mcp-clients.ts`: `null` for Linear, which registers its own OAuth client, without reading `mcp.json`.
For Slack it is a `SlackSetup` with the client ID, whether a client secret is stored, the redirect URI, the callback port, the scope string, and `configured`.
For Google Calendar and Gmail, the `GOOGLE_SERVICES` in `src/shared/accounts.ts`, the services whose `client` is `google-oauth`, it is a `GoogleSetup` with the client ID, whether a client secret is stored, the callback port, and `configured`.
The client secret is absent from that body.
`GET /api/settings` does not read `mcp.json` either.
Its file list comes from omp's context, prompt, command, rule, skill, hook, and agent discovery.
Before the app is saved, Slack's setup uses callback port 3000 and the full scope list, with `configured: false`.
`configured` is true only when the user MCP file has a client ID, a client secret, a nonempty subset of `SLACK_USER_SCOPES`, an HTTPS redirect, and a callback port.
An HTTPS loopback redirect must use a different port from the local HTTP callback.
Google Calendar's and Gmail's setups use callback port 3119 until a client is saved, and are `configured` only when their server has a client ID, a client secret, and a callback port.

A Linear or Slack `connection` is `absent` while omp's user-level MCP config has no enabled server on the service's host, where a Google service's `accounts` is empty instead, and a connection is `signed-out` while omp's credential store, read again on each call, holds no OAuth sign-in for its server.
A Slack, Google Calendar, or Gmail server that already has a sign-in is still probed when the saved client settings are incomplete.
`listMcpTools` in `src/omp/mcp.ts` discovers their tools through omp's client, with the configured transport and headers and the same token as the tickets' calls, following every cursor.
`remoteStatusOf` in `src/mcp-status.ts` turns the outcome into one `McpRemoteStatus` from `src/shared/mcp-status.ts`, which both sections share: `ready` with each tool's name and description, `refused` on discovery's `McpUnauthorized` while omp holds a sign-in, or `failing` with any other error and the HTTP status the server answered, `null` when it answered none.
Every service requires a sign-in, so a service that has none is `signed-out` without listing its tools.
One cache keeps discovery lists for a minute and never a failure, keyed by server name, expanded config, credential id, and whether discovery sends omp's token; `?fresh` lists again.
Config writes invalidate that name, and sign-in, sign-out, and discovery or service API 401 invalidate every list using that credential id plus its token.
While a service's sign-in waits on the browser, `hold` on its `SignIn` answers the connection read during that sign-in of the account it signs in to, without listing the tools again; the sign-in names its target account, and a new one starts holding nothing.
The page shows the **Tickets** tab while Linear's connection is `ready`, `refused`, or `failing`, and the **Inbox** tab while any Gmail account's is, and keeps the last read in localStorage.
`integrationsStore` in `web/reads.ts` drops a cached answer in which an integration has no connection, or a `ready` one lists its tools as anything but objects, as answers did before tools carried descriptions.
Each gated tab names its service as the `integration` of its row in `SIDEBAR_TABS` in `web/routing.ts`, and `tabsSignedOut` in `web/sidebar-tabs.ts` turns those rows into the tabs omp holds no sign-in for. `useSidebarTabs` keeps the layout, the signed-out set, and the tabs the bar shows, which Cmd+1 through Cmd+8 go to, and the tab row fits its width by how many tabs show.
The dashboard calls Linear only while its connection is `ready` or `failing`: the tickets page shows Linear's integration row instead of the issues otherwise, and the Todo page's **Create Linear ticket** and the Calendar's tickets wait on it too.

`PUT /api/integrations/slack/client` takes `{ clientId, clientSecret?, redirectUri, callbackPort, scope }`.
`parseSlackClient` accepts a nonempty subset of `SLACK_USER_SCOPES`, with commas or whitespace as separators, and an HTTPS redirect.
It answers 400 for an HTTP redirect, an unknown scope, a bad port, or an HTTPS loopback redirect that reuses the callback port.
The save writes the existing user server on `mcp.slack.com`, or a new `slack` server, through omp's locked config writer.
The writer keeps owner-only file permissions and leaves every other server, top-level list, header, timeout, `callbackPath`, and `prompt` in place.
An omitted or empty client secret stays only when the client ID is unchanged.
A new client ID without a new secret is a 400 and does not write.
Saving cancels a Slack sign-in that is waiting.
Changing the client ID or the secret also removes the OAuth credentials omp manages for that server.
Credentials are removed before changing the app identity, so a failed config write cannot leave the old app signed in under the new settings.
If that write fails, the old settings remain, but Slack needs a new sign-in.
Config and credentials have separate native owners, not a shared transaction.
Saving scopes changes the next authorization request, not an existing grant.
Sign-out and a later sign-in leave the saved app in the file.

`PUT /api/integrations/google-calendar/client` and `PUT /api/integrations/gmail/client` take `{ clientId, clientSecret?, callbackPort }` of a Google OAuth client of type Web application, and one client may serve both.
`parseGoogleClient` answers 400 for a client ID that does not end in `.apps.googleusercontent.com` or a bad port.
`saveGoogleClient(id, input)` in `src/integrations.ts` writes every user server on the service's host, `calendarmcp.googleapis.com` or `gmailmcp.googleapis.com`, or a new `google-calendar` or `gmail` server when there is none, the way Slack's save does.
It sets the scope to the service's `GOOGLE_SCOPES` in `src/shared/accounts.ts`, events, the calendar list read-only, and free/busy for Google Calendar and `gmail.modify` alone for Gmail, `prompt: "consent"` so Google issues a refresh token, the callback port, and the redirect `http://localhost:<port>/callback`, which the client must list as an authorized redirect URI.
A sign-in to Google Calendar or Gmail first rewrites a saved server's `oauth.scope` that differs from `GOOGLE_SCOPES`, through `planGoogleScope`, so a client saved when Gmail asked only for `gmail.readonly` asks for the wider grant on its next **Reconnect**.
The same secret, client-change, and credential rules as Slack's apply, since Google ties a refresh token to its client: a new client ID or secret removes every account's server but the first with its sign-in, and signs out of the first.
The workspace links are kept by address, so the accounts added again take their old links.

`PUT /api/integrations/sign-in`, with `{ id, account }`, starts a sign-in the way omp's `/mcp reauth` does: to the Google account `account` names again, to a new Google account when it is `null`, and to Linear's or Slack's one server, which take `null`.
Linear still reads the OAuth endpoints from metadata, registers a client when the authorization server offers registration, and listens on `localhost:3000`.
Slack, Google Calendar, and Gmail refuse to start until `setup.configured` is true, so they do not open an authorization URL that has no client ID.
The flow then receives the saved client ID, client secret, scope, redirect, callback port, callback path, and prompt.
It answers the integration once the flow has the service's authorization address, as `signIn: { phase: "waiting", url }`, which the page opens in a new tab.
When the browser comes back, the server stores the tokens under the server's credential id, where `omp token` finds them.
The stored client secret is the one dynamic registration issued, or the configured secret when registration did not issue one.
That is the secret a later refresh sends.
A Slack grant with no refresh token is not stored.
The Slack app has to enable token rotation, which Slack does not let an app turn back off.
omp otherwise treats a missing token lifetime as one hour, so a refresh-less grant would stop working with no error at save time.
A Linear or Slack sign-in adds the service's HTTP server to the user `mcp.json` only when discovery found no enabled server on the service's host; a Google service gets its first server from its client save.
A new sign-in abandons the one under way.
A failure, or no return within five minutes, shows as `signIn: { phase: "failed", error }` until the next sign-in.
`createSignIn` in `src/sign-in.ts` holds that state, and the status `hold` repeats, for every MCP integration.

`PUT /api/integrations/remove`, with `{ id, account }`, abandons a sign-in under way to what it names and removes the sign-ins omp manages for the server, as omp's `/mcp unauth` does, through `signOutMcp`.
Linear and Slack keep their server in `mcp.json` and, unlike `/mcp unauth`, its `auth` block; a Google account's server leaves `mcp.json` with its sign-in, unless it is the last on its host.
A sign-in that omp does not manage stays, and the route answers an error that says so.
`parseIntegrationTarget` in `src/server/wire.ts` checks both bodies.

`PUT /api/integrations/google-links`, with `{ address, workspaces }`, checked by `parseGoogleLinks`, replaces the absolute workspace directories a Google address's accounts are linked to, none to show them in every workspace, and answers every integration.
The route replaces the whole list, so `toggleLink` in `web/components/integrations/google-accounts.tsx` sends an address's writes one after another, each built on the list the one before saved, and a second toggle before the first answer keeps both.
