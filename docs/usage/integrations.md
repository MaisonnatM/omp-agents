# Integrations

- **Integrations** is a section of [Settings](settings.md): a row for each service omp's sessions reach through an MCP server, Linear and Slack so far.
  **Connected** lists the services that hold a sign-in, working or not, and **Available** lists the rest.
- Each MCP row shows whether omp is connected, by listing the server's tools with omp's sign-in: **Connected** with the server's host and the number of tools, which unfolds to their names, each with its description on hover, **Needs reconnecting** when the server refuses the sign-in, **Unreachable** with the server's error and **Check again**, or **Not connected** or **Signed out** when omp has no server or no sign-in for it.
  An unconfigured Slack row says **Not set up** until its app settings are saved.
  The section checks again every minute while it is open, and **Refresh** checks at once.
- **Connect** signs in the way omp's `/mcp reauth` does, saves the sign-in in omp's credentials, and adds the service's MCP server, such as `https://mcp.linear.app/mcp` or `https://mcp.slack.com/mcp`, to `~/.omp/agent/mcp.json` when omp has none, so new omp sessions can use its tools too.
  A service whose server omp's `/mcp disable` turned off is turned back on by **Connect**, which skips the browser while omp still holds its sign-in.
  Linear sends the browser back to `localhost:3000`, so that port must be free while you sign in.
  Slack sends the browser to the HTTPS redirect saved for the app, and omp listens for HTTP on the saved callback port.
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
