# HTTP API: MCP servers

`GET /api/mcp-servers` answers `McpServersAnswer` from `src/shared/mcp-servers.ts`: `servers`, one `McpServerRow` for every server omp loads for you, and `configPath`, omp's user `mcp.json`.
`listMcpServers` in `src/omp/mcp.ts` reads them with `loadAllMCPConfigs`, project configs off, and adds the servers omp's user file disables, which that call drops.
Each row has the server's name, transport, URL with `${VAR}` references expanded, host, command, `source` (the config file and whether the page may change it: only omp's own user file), whether omp holds a sign-in for its URL, `status`, `signIn`, and `catalogId`, the catalog entry on its host.

`status` is `disabled`, `integration` for a server on one of `MCP_SERVICES`' hosts, whose status [Integrations](http-api-integrations.md) reads, `local` for a command, which only an omp session starts, or the outcome of listing the server's tools.
`listMcpTools` in `src/omp/mcp.ts` is the same discovery operation Integrations uses: it connects through omp's own client, `connectToServer` and `listTools`, so streamable HTTP and SSE servers both work, with the server's headers and a Bearer token when omp holds a sign-in, then disconnects.
A 401, a `http_status` failure from the HTTP transport or an `HTTP 401:` error from the SSE one, throws `McpUnauthorized`, distinct from service HTTP API authorization's `McpRefused`.
`remoteStatusOf` reads discovery's 401 as `signed-out` when omp holds no sign-in and `refused` when it does; any other failure is `failing` with its message and HTTP status, as an integration's is.
A server need not require a sign-in, so one that has none is still listed without a token.
An address that does not parse is `failing` with a `null` status.
Integration-host rows delegate to Integrations without probing a second time.
`McpServerStatus` adds `disabled`, `local`, and `integration` to `McpRemoteStatus`, and an integration's `McpConnection` adds `absent` and the server, so each answer carries only the kinds its section can reach.
While a server's sign-in waits on the browser, `hold` on its `SignIn` answers the status last read.

`PUT /api/mcp-servers/add` takes `{ catalog }`, an id in `MCP_CATALOG` from `src/shared/mcp-catalog.ts`, or `{ name, url, transport?, header? }`, checked by `parseMcpServerAdd` in `src/server/wire.ts`: the address must be HTTPS or loopback HTTP, the transport `http` or `sse`, and a header a token name with a value.
A catalog entry refuses a server already on its host and takes its id as the name, or the first of `id-2`, `id-3`, … that is free; an OAuth entry then starts its sign-in, and the route answers the new row, whose `signIn` the page opens.
A server by address must have a name omp's `validateServerName` accepts and no other server has, and is written with its header in `headers`; it starts no sign-in.
Both go through omp's `addMCPServer` into the user `mcp.json`.

`PUT /api/mcp-servers/sign-in` and `PUT /api/mcp-servers/sign-out`, with `{ name }`, sign in and out as the integrations' routes do, with a `createSignIn` per server name; they refuse a local server and an integration's.
`PUT /api/mcp-servers/enabled`, with `{ name, enabled }`, calls omp's `setMcpServerEnabled`, as `/mcp enable` and `/mcp disable` do, and `PUT /api/mcp-servers/remove`, with `{ name }`, calls `removeMCPServer`, as `/mcp remove` does, keeping omp's sign-in; both refuse a server from any file but omp's user `mcp.json`.
A refusal, such as a taken name, is `McpServerRejected`, which the routes answer as a 400 with its message.
