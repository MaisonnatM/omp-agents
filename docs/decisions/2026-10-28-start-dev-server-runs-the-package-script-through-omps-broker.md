---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# Start dev server runs the package script through omp's broker

In the context of the Browser's **Start dev server**, facing a button that only asked the session's model to start the server, which costs a turn, waits behind a running one, and starts whatever the model picks, we chose to run the project's `dev` or `start` script ourselves as a service the session owns in omp's project broker, with the old prompt as the fallback, over keeping the prompt alone and over a child process the dashboard spawns.
We get a server in seconds that the Browser loads at once and that lists, stops, and idles out with the session's other services, accepting a fixed guess at the command, from `package.json` and the lockfile, that misses projects without a script, monorepos whose script starts several servers, and servers that ignore both `PORT` and `--port`.

## Context

A session's dev server has to be one of its services, so the Browser offers its port, the status bar's CPU card lists it, the idle stop ends it, and the cleanup stops it once the session's omp exits.
`SessionProcessWatch` counts a broker daemon as the session's when its owner is the session's omp session id, and the bash tool's `startService` starts one that way.
Most projects the dashboard runs have a `package.json` whose `dev` script starts a server that takes `PORT` or `--port`.

## Options considered

- Keep sending the prompt: works for any project, but each press costs a model turn, a running turn delays it, and the command and port are the model's choice.
- Spawn the dev server as a child of the dashboard's server: needs no broker, but the server is no session's service, so no list, stop, idle stop, or cleanup sees it, and it dies or leaks with the dashboard's server.
- Start it through omp's broker as a service owned by the session, falling back to the prompt with the reason when there is no script or the server exits as it starts: chosen.

## Consequences

- `planDevServer` in `src/server/dev-server.ts` holds the command rules as tables: the lockfiles that name a package manager, and the server commands that take `--port`.
- A project those rules miss still gets its server, through the session, with the reason in the prompt.
- The dashboard's server can now start a project's broker, through omp's `createDaemonBrokerClient`, where before only omp did.
- A server that runs but never listens on the port it was given counts as started; the Browser then shows a load error until the server menu lists its real port.

## Confirmation

`src/server/dev-server.test.ts` checks the script choice, the package manager table, npm's `--`, `--port` against `PORT` only, and the reasons for a project with nothing to run.

## Revisit when

omp ships its own way to start a project's dev server, or the fallback prompt turns out to carry most presses.
