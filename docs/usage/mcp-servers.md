# MCP servers

- **MCP servers** is a section of [Settings](settings.md), at `#settings/mcp-servers`: every MCP server omp loads for you, then **Discover**, a catalog of remote servers to add.
  It lists the servers in omp's user `~/.omp/agent/mcp.json` and the user-level servers omp reads from other tools' configs, but not a project's `.mcp.json`.
  The section checks the servers every minute while it is open, and **Refresh** checks at once.
- **Installed** shows each server with its vendor's mark, or its initial, its transport, and its host or command.
  A remote server shows whether omp can use it, by listing its tools with omp's sign-in: **Connected** with the number of tools, which unfolds to their names, each with its description on hover, **Signed out** with **Connect** when it asks for a sign-in omp lacks, **Needs reconnecting** when it refuses omp's sign-in, or **Unreachable** with its error and **Check again**.
  A local server, which runs a command, says **Not checked**, as only an omp session starts it.
  A server whose config lives in another tool's file says **From** that tool, and the section does not change it.
  Linear, Slack, Google Calendar, and Gmail are not listed as rows: one line under the list names the ones omp loads, and **Open Integrations** goes to [Integrations](integrations.md) to sign in or out.
- **Connect** and **Reconnect** sign in the way omp's `/mcp reauth` does, in your default browser, and the row waits for you there as an integration's does.
  The **⋯** menu holds **Reconnect** and **Sign out** for a server omp holds a sign-in for, and **Disable** and **Remove** for a server in omp's own file.
  **Disable** keeps the server in `mcp.json` but stops new omp sessions loading it, as `/mcp disable` does, and **Enable** turns it back on.
  **Remove** asks first, then deletes the server from `mcp.json`, as `/mcp remove` does; omp keeps its sign-in.
- **Discover** lists vetted remote servers, each its vendor's own, by category, with **Search** to filter them.
  Each card says whether the server signs in with OAuth or needs no sign-in.
  **Add** writes the server to `mcp.json` under the card's name, such as `sentry`, or `sentry-2` when that name is taken; for an OAuth server it opens the vendor's sign-in in your default browser at once.
  A card whose server is already installed, matched by its host, says **Added as** with the server's name instead.
- **Add server** adds a remote server by its name and address, over streamable HTTP or the older SSE transport.
  The address must be `https://`, or `http://` on this computer.
  An optional header, such as `Authorization: Bearer …`, goes into the server's entry in `mcp.json`; write `${VAR}` as its value to read it from your environment instead.
  A server added this way does not start a sign-in; when it asks for one, its row says **Signed out** with **Connect**.
- New omp sessions load the servers added here, and a running session loads them after `/mcp reload`.
