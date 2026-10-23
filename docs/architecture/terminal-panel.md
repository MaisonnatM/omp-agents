# Terminal panel

The panel's shells run on the server, in pseudo-terminals from Bun's `terminal` spawn option, so the dashboard needs no native module.
`src/terminals.ts` owns them: `Terminals.open` starts `$SHELL -l` (else `/bin/sh -l`) in a directory with `TERM=xterm-256color`, without the server's `PORT` and `OMP_AGENTS_PARENT`, and a shell lives until it exits, its tab hangs up on it, or the server's shutdown calls `Terminals.dispose`.
At most `MAX_TERMINALS` (16) shells run at once; `Terminals.open` refuses another until one exits, so a page cannot fork shells without bound.
Each shell keeps its last megabyte of output in `Scrollback`, which drops whole chunks from the front, and replays it to every socket that attaches, so a reloaded page shows what the shell printed.

- `GET /api/terminals` answers the running shells as `TerminalInfo[]`, `{ id, cwd, cwdDisplay }`, from which a reloaded page reopens its tabs.
- Each tab opens its own socket, `/ws/terminal?cwd=<dir>&cols=<n>&rows=<n>` for a new shell or `/ws/terminal?id=<id>` to attach to one; `terminalSocketPath` in `src/shared/terminals.ts` builds both.
  `parseTerminalQuery` in `src/server/wire.ts` checks the query, holding the size to 1–1000; `terminalFor` in `src/server/terminal-socket.ts` resolves `cwd` through `directoryOf` and answers 404 for one that is no directory, such as a removed worktree, 404 for an unknown `id`, and 429 past the cap, all before any shell starts.
  A reloaded page reattaches to its shells by `id`, which starts none.
  The upgrade passes the same guards as `/ws`, and a shell opened for an upgrade that fails is killed.
- Binary frames carry the shell's bytes both ways.
  Text frames carry JSON control messages: the server sends `TerminalServerMsg`, `opened` with the `TerminalInfo` once and `exit` with the shell's code, then closes the socket; the page sends `TerminalClientMsg`, `resize` or `kill`, which `parseTerminalMsg` checks.
  The page shows **Starting shell…** until `opened` and a close spinner until the socket closes.
  Closing the socket detaches without ending the shell, so closing a tab, even one still starting, sends `kill`, which the page's `terminalSender` holds until the socket opens, and the tab stays until the socket closes.
- `src/server.ts` serves both socket kinds from one `Bun.serve`, its data typed as the union of `SocketData` and `TerminalSocketData`, and `isTerminalSocket` routes each handler to `src/server/terminal-socket.ts` or the `Dashboard`'s session socket.
