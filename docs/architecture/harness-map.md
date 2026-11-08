# Harness map

Five diagrams of how the dashboard, omp, and the starter kit fit together on one computer.
Each subsystem's own file in this directory holds the details; this page is where to start before you open one.

## Processes

The desktop window starts the server, the page talks to the server, and the server reaches every omp session either through a keeper or as a Collab guest.

```mermaid
flowchart LR
  desktop["Desktop window<br/>desktop/"] -->|starts| server["Bun server<br/>src/server.ts<br/>127.0.0.1:4317 by default"]
  page["Page<br/>web/"] -->|"REST /api/* and WS /ws, bearer token"| server
  server -->|"Unix socket per session"| keeper["Session keeper<br/>src/keeper.ts"]
  keeper -->|"spawns, RPC over stdio"| rpc["omp --mode rpc-ui<br/>dashboard session"]
  server -->|"Collab guest omp-agents"| term["omp in a terminal<br/>terminal session"]
  rpc --> home["~/.omp/agent<br/>config, kit, sessions"]
  term --> home
  server -->|"reads session files"| home
```

[Desktop shell](desktop-shell.md) covers the window, [Session keepers](dashboard-sessions.md#session-keepers) the keepers, and [Terminal sessions](terminal-sessions.md) the Collab join.

## What a dashboard session loads

omp loads the user's config and the starter kit from `~/.omp/agent`, the project's own files from the workspace, and the extras the dashboard passes when it starts the session.

```mermaid
flowchart TD
  start["Dashboard starts a session"] --> args["omp --mode rpc-ui<br/>plus -e extensions and host tools"]
  args --> agent["~/.omp/agent"]
  agent --> cfg["config.yml and models.yml<br/>model roles, fallbacks, task isolation"]
  agent --> ctx["AGENTS.md and APPEND_SYSTEM.md<br/>user context"]
  agent --> ext["extensions/<br/>starter kit extensions"]
  agent --> skills["skills/, agents/, commands/"]
  agent --> mcp["mcp.json"]
  agent --> plugins["plugins/<br/>marketplace plugins"]
  args --> dash["Dashboard extensions<br/>session visuals, bots, personal, designer, shepherd"]
  args --> host["Host tools<br/>move_session, save_review_draft"]
  start --> project["Workspace<br/>AGENTS.md, .omp/, project skills"]
```

[Dashboard sessions](dashboard-sessions.md) says which extensions and host tools each kind of session gets.

## A message from the page to the model

A prompt typed on the page travels over the socket to the server, through the keeper to omp, and the events come back the same way.

```mermaid
sequenceDiagram
  participant P as Page
  participant S as Server
  participant K as Keeper
  participant O as omp rpc-ui
  participant M as Model provider
  P->>S: prompt over WS /ws
  S->>K: RPC command on the session socket
  K->>O: stdin frame
  O->>M: request on the role's model, then its fallback chain
  M-->>O: streamed reply and tool calls
  O-->>K: events on stdout
  K-->>S: events
  S-->>P: session events, transcript, roster row
```

[Socket requests](socket-requests.md) lists the messages, and the model-routing doc in the starter kit says how roles and fallbacks pick a model.

## Unattended work and file inboxes

Only the server that holds the owner lock runs the unattended work, and sessions hand facts to it by writing files into inbox directories it alone reads and applies.

```mermaid
flowchart LR
  subgraph sessions["omp sessions"]
    kit["Starter kit extensions<br/>todos, notes, events, end-session, google-accounts"]
    dashx["Dashboard extensions<br/>bots, routines, shepherds"]
  end
  subgraph inboxes["~/.config/omp-agents/*-inbox/"]
    i1["todo-inbox, note-inbox, event-inbox,<br/>end-inbox, sign-in-inbox"]
    i2["bot-inbox, routine-inbox, shepherd-inbox"]
  end
  kit -->|writes a file| i1
  dashx -->|writes a file| i2
  i1 --> owner["Owner server<br/>only writer of the stores"]
  i2 --> owner
  owner --> tick["Tick every 60 s<br/>routines, scheduled sends, merges,<br/>cleanup, isolation sweep, idle stop"]
  tick -->|starts or prompts| sessions
```

[One server runs the unattended work](routines.md#one-server-runs-the-unattended-work) covers the owner lock, [Isolation sandboxes](routines.md#isolation-sandboxes) the sweep, and [The idle stop](session-processes.md#the-idle-stop) the stop.

## How the starter kit reaches ~/.omp/agent

The repository's `templates/omp/` is the starter kit, and the installer copies it into `~/.omp/agent` while it keeps the files and settings the user changed.

```mermaid
flowchart TD
  kit["templates/omp/<br/>agent/ and maintainer/"] --> install["bun run omp-template<br/>templates/omp/install.ts"]
  update["Update dashboard<br/>install.ts --files"] --> install
  install -->|"copies files the user never edited"| agent["~/.omp/agent"]
  install -->|"omp config set, keys the user never set"| cfg["config.yml"]
  install -->|"adds missing servers"| mcp["mcp.json"]
  install -->|"marketplace and plugins"| plugins["plugins/"]
  install --> record["starter-kit-installed.json<br/>what the kit installed"]
  record -->|"tells an edited copy from a stale one"| install
  agent <-->|"Settings sync"| sync["~/.local/share/omp-agents/settings-sync.git"]
```

[Starter kit and docs](../code-layout/starter-kit-and-docs.md) covers the installer, [Updating the dashboard](updating-the-dashboard.md) the update, and [Settings sync](settings-sync.md) the sync repository.
A file the kit stops shipping stays in `~/.omp/agent` until the user deletes it, since the installer only adds and updates files.
