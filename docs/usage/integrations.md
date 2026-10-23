# Integrations

- **Integrations** is a section of [Settings](settings.md): a row for each service omp's sessions reach through an MCP server, Linear, Slack, Google Calendar, and Gmail so far.
  **Connected** lists the services that hold a sign-in, working or not, and **Available** lists the rest.
- Each MCP row shows whether omp is connected, by listing the server's tools with omp's sign-in: **Connected** with the server's host and the number of tools, which unfolds to their names, each with its description on hover, **Needs reconnecting** when the server refuses the sign-in, **Unreachable** with the server's error and **Check again**, or **Not connected** or **Signed out** when omp has no server or no sign-in for it.
  When Google's MCP server answers HTTP 403, the Google Calendar or Gmail row says the MCP API is most often off in the OAuth client's Google Cloud project, and adds **Enable Calendar MCP API** or **Enable Gmail MCP API**, which opens Google's page that turns it on in that project, the number the client ID starts with.
  An unconfigured Slack, Google Calendar, or Gmail row says **Not set up** until its OAuth client is saved.
  The section checks again every minute while it is open, and **Refresh** checks at once.
- Google Calendar and Gmail each hold several accounts.
  Once the OAuth client is saved, **Connect** signs in the first account and **Add account** opens Google's account chooser for another; each account then has its own line with its address, its status, **Reconnect** and **Remove** in its menu, and its tools.
  **Add account** and **Reconnect** refuse an address another account of the service already holds; a refused or abandoned **Reconnect** keeps the account's old sign-in, and an add that fails or is abandoned leaves no server behind.
  An account whose address Google will not say shows why on its line, after its status.
  Addresses match whatever their case, so `Ana@example.com` in Gmail and `ana@example.com` in Google Calendar are one address.
  **Remove** takes the account's server and sign-in out of omp; the last account on a service stays as a signed-out server, since it keeps the OAuth client.
  A new OAuth client ID or secret removes every added account and signs out the remaining one, since Google ties sign-ins to the client.
- Each Google account's workspace picker links its address to workspaces, which covers that address's Gmail and Google Calendar accounts; a pick made before the one before it is saved adds to it rather than replacing it.
  While the sidebar picks a workspace, the Inbox, the Calendar, and the `@` menu show the accounts linked to it and those linked to none; with **All workspaces** they show every account.
  With the starter kit's `extensions/google-accounts.ts` installed (`bun run omp-template`), an omp session whose service has two or more accounts is told at each prompt each account's address and tool prefix, and, when its workspace has linked addresses, to use those for its mail and calendar unless you name another account.
  A session in a linked worktree counts as in its repository's main checkout when its own directory is in no linked workspace; every account's tools stay available to it.
- omp's own `/mcp reauth` or `/mcp unauth` on an added account writes it back under its URL and can merge two accounts into one; reconnect it from this page instead.
- **Connect** signs in the way omp's `/mcp reauth` does, saves the sign-in in omp's credentials, and adds the service's MCP server, such as `https://mcp.linear.app/mcp`, `https://mcp.slack.com/mcp`, `https://calendarmcp.googleapis.com/mcp/v1`, or `https://gmailmcp.googleapis.com/mcp/v1`, to `~/.omp/agent/mcp.json` when omp has none, so new omp sessions can use its tools too.
  Linear sends the browser back to `localhost:3000`, so that port must be free while you sign in.
  Slack sends the browser to the HTTPS redirect saved for the app, and omp listens for HTTP on the saved callback port.
  Google Calendar and Gmail send the browser back to `localhost` on the saved callback port, 3119 unless you change it.
  While it waits, the row says so, links to the sign-in page again, and hides its other buttons.
- A connected Linear or Slack row's ⋯ menu holds **Reconnect**, which signs in again over a sign-in that the server refused or that still works, and **Sign out**.
  **Sign out** asks first, then removes the sign-ins omp manages for the service, as omp's `/mcp unauth` does, so omp's sessions lose its tools too; the server stays in `mcp.json`.
  When the sign-out fails, the question stays with the reason, to try again or cancel.
- Slack shows **Not set up** and **Set up** until its app settings are saved.
  **Set up** is for a new internal app from [Your Slack apps](https://api.slack.com/apps).
  Leave any existing production app unchanged.
  In the new app, open **Agents** and turn on **Slack Model Context Protocol (MCP) Server**.
  Add the user scopes for the conversations omp may search, read, and send.
  The form lists every scope it accepts, and you can save a smaller read-only set.
  Canvas, list, file, and reaction scopes are not part of that set.
  Turn on token rotation on that new app before you connect.
  Token rotation is irreversible, and Slack cannot turn it off later.
  omp refuses a Slack sign-in that comes back without a refresh token.
  It does not keep a grant that stops working when the access token expires.
  Register an HTTPS redirect URL on the app.
  A TLS terminator you trust must forward that URL to the HTTP callback on this machine.
  The callback port is 3000 unless you change it.
  An HTTP localhost address does not work as the redirect.
  If the redirect is HTTPS on localhost, choose a callback port other than the redirect's port.
  Slack requires confidential OAuth with the app's client ID and secret.
  Paste the client ID and the client secret.
  omp stores the client secret in that server's entry in `~/.omp/agent/mcp.json`.
  The Integrations section does not show the saved secret.
  Leave the secret blank to keep the saved secret when the client ID stays the same.
  A new client ID needs its own secret.
  A saved row shows the registered redirect and the callback listener, such as `localhost:3000`.
  **Connect**, **Reconnect**, **Sign out**, and the tool list then match the other MCP rows.
  **Reconnect** and **Sign out** keep the app settings.
  **Replace app settings** in the ⋯ menu opens the form again.
  Changing the client ID or the secret signs omp out of Slack and drops the old credentials.
  Saving a different scope selection changes the next **Connect** or **Reconnect**, not the existing sign-in.
- Google Calendar shows **Not set up** and **Set up** until its OAuth client is saved.
  In a [Google Cloud project](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), turn on the Google Calendar API.
  Under [Credentials](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type **Web application**, and add `http://localhost:3119/callback`, with your callback port, as an authorized redirect URI.
  Paste the client ID and secret, then **Connect**; Google asks you to grant reading and editing your events, reading your calendar list, and free/busy.
  omp stores the secret in that server's entry in `~/.omp/agent/mcp.json`, and the secret, client-change, and **Replace OAuth client** rules are Slack's.
  Once connected, each account lists the calendars checked in its Google Calendar list, in their colors, with why the last read of one failed; one you unchecked in the Calendar page's sidebar shows muted and says **Hidden on the Calendar page**.
  An account whose list could not be read this time says why above the calendars it last listed, and a list that could never be read says why once above the accounts.
  Google Calendar's MCP tools also need the Calendar MCP API on in that project; the row links to it when Google refuses them.
  The Calendar page reads Google's Calendar API and does not need the MCP API.
- Gmail shows **Not set up** and **Set up** until its OAuth client is saved, and its form is Google Calendar's.
  In a [Google Cloud project](https://console.cloud.google.com/apis/library/gmail.googleapis.com), turn on the Gmail API.
  Under [Credentials](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type **Web application**, and add `http://localhost:3119/callback`, with your callback port, as an authorized redirect URI; the client you made for Google Calendar works too.
  Paste the client ID and secret, then **Connect**; Google asks you to grant reading, sending, and deleting your email, which lets the Inbox page reply and move conversations to Trash.
  A Gmail sign-in made before the Inbox page could reply only reads mail; **Reconnect** asks Google for the wider grant.
  omp stores the secret in the Gmail server's entry in `~/.omp/agent/mcp.json`, apart from Google Calendar's, and the secret, client-change, and **Replace OAuth client** rules are Slack's.
  Gmail's MCP tools also need the Gmail MCP API on in that project; the row links to it when Google refuses them.
  The Inbox page reads Google's Gmail API and does not need the MCP API.
