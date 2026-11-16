# HTTP API: Integrations

`MCP_SERVICES` in `src/shared/accounts.ts` holds the services whose MCP server the **Integrations** page signs omp in to, keyed by the ids in `MCP_INTEGRATIONS`.
`integrationOn(host)` there names the service whose server is on a host, which is how the MCP servers page tells an integration's server from one it manages itself.
Linear and Slack are the two.
Each names its label, the host omp's server for the service is on, and the name and URL of the server a sign-in adds when omp has none.
Each also names its `client`, where its sign-in gets its OAuth client: `none` for Linear, which registers its own, and `slack-app` for Slack.
Its `requireRefresh` says whether a sign-in refuses a grant without a refresh token, which only Slack's does.
`src/integrations.ts` reads these fields for every service rather than naming one, keeps one sign-in at a time per service, and signs in to the first server on the service's host.
The page adds each service's brand mark and what it gives.
`SLACK_USER_SCOPES` is the chat, history, search, and user set a dedicated Slack app may grant.
Canvas, list, file, reaction, and channel-creation scopes are not requested.

`signOutMcp` in `src/omp/mcp.ts` removes only a server's own credential id, and the URL-keyed ids only when its own id is one of them, as `/mcp unauth` does.

`GET /api/integrations` answers `{ integrations }`, one `McpIntegration` under each service's id, `{ id, connection, signIn, setup }`.
`setup` is the one its `client` decides, through `clientSetup` in `src/mcp-clients.ts`: `null` for Linear, which registers its own OAuth client, without reading `mcp.json`.
For Slack it is a `SlackSetup` with the client ID, whether a client secret is stored, the redirect URI, the callback port, the scope string, and `configured`.
The client secret is absent from that body.
`GET /api/settings` does not read `mcp.json` either.
Its file list comes from omp's context, prompt, command, rule, skill, hook, and agent discovery.
Before the app is saved, Slack's setup uses callback port 3000 and the full scope list, with `configured: false`.
`configured` is true only when the user MCP file has a client ID, a client secret, a nonempty subset of `SLACK_USER_SCOPES`, an HTTPS redirect, and a callback port.
An HTTPS loopback redirect must use a different port from the local HTTP callback.

A `connection` is `absent` while omp's user-level MCP config has no enabled server on the service's host, and `signed-out` while omp's credential store, read again on each call, holds no OAuth sign-in for its server.
A Slack server that already has a sign-in is still probed when the saved client settings are incomplete.
`listMcpTools` in `src/omp/mcp.ts` discovers their tools through omp's client, with the configured transport and headers and the same token as the tickets' calls, following every cursor.
`remoteStatusOf` in `src/mcp-status.ts` turns the outcome into one `McpRemoteStatus` from `src/shared/mcp-status.ts`, which both sections share: `ready` with each tool's name and description, `refused` on discovery's `McpUnauthorized` while omp holds a sign-in, or `failing` with any other error and the HTTP status the server answered, `null` when it answered none.
Every service requires a sign-in, so a service that has none is `signed-out` without listing its tools.
One cache keeps discovery lists for a minute and never a failure, keyed by server name, expanded config, credential id, and whether discovery sends omp's token; `?fresh` lists again.
Config writes invalidate that name, and sign-in, sign-out, and discovery or service API 401 invalidate every list using that credential id plus its token.
While a service's sign-in waits on the browser, `hold` on its `SignIn` answers the connection read during that sign-in, without listing the tools again, and a new sign-in starts holding nothing.
The page shows the **Tickets** tab while Linear's connection is `ready`, `refused`, or `failing`, and keeps the last read in localStorage.
`integrationsStore` in `web/reads.ts` drops a cached answer in which an integration has no connection, or a `ready` one lists its tools as anything but objects, as answers did before tools carried descriptions.
Each gated tab names its service as the `integration` of its row in `SIDEBAR_TABS` in `web/routing.ts`, and `tabsSignedOut` in `web/sidebar-tabs.ts` turns those rows into the tabs omp holds no sign-in for. `useSidebarTabs` keeps the layout, the signed-out set, and the tabs shown; the bar draws those of the header's group, and a group with none shown disables its side of the switch.
The dashboard calls Linear only while its connection is `ready` or `failing`: the tickets page shows Linear's integration row instead of the issues otherwise, and the Todo page's **Create Linear ticket** waits on it too.

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

`PUT /api/integrations/sign-in`, with `{ id }`, starts a sign-in to the service's first server the way omp's `/mcp reauth` does.
Linear still reads the OAuth endpoints from metadata, registers a client when the authorization server offers registration, and listens on `localhost:3000`.
Slack refuses to start until `setup.configured` is true, so it does not open an authorization URL that has no client ID.
The flow then receives the saved client ID, client secret, scope, redirect, callback port, callback path, and prompt.
It answers the integration once the flow has the service's authorization address, as `signIn: { phase: "waiting", url }`, which the page opens in the default browser.
When the browser comes back, the server stores the tokens under the server's credential id, where `omp token` finds them.
The stored client secret is the one dynamic registration issued, or the configured secret when registration did not issue one.
That is the secret a later refresh sends.
A Slack grant with no refresh token is not stored.
The Slack app has to enable token rotation, which Slack does not let an app turn back off.
omp otherwise treats a missing token lifetime as one hour, so a refresh-less grant would stop working with no error at save time.
A sign-in adds the service's HTTP server to the user `mcp.json` only when discovery found no enabled server on the service's host.
A new sign-in abandons the one under way.
A failure, or no return within five minutes, shows as `signIn: { phase: "failed", error }` until the next sign-in.
`createSignIn` in `src/sign-in.ts` holds that state, and the status `hold` repeats, for every MCP integration.

`PUT /api/integrations/remove`, with `{ id }`, abandons a sign-in under way to that service and removes the sign-ins omp manages for its server, as omp's `/mcp unauth` does, through `signOutMcp`.
The server stays in `mcp.json` and, unlike `/mcp unauth`, keeps its `auth` block.
A sign-in that omp does not manage stays, and the route answers an error that says so.
`parseIntegrationTarget` in `src/server/wire.ts` checks both bodies.

