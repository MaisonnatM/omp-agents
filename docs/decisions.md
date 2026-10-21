# Decisions

The choices that shape omp-agents and why they were made.
Read the entry before you change what it covers; reopen a decision by editing its entry in the same pull request, not by working around it.
Each entry links the section that holds the details.

## Import omp's modules instead of reimplementing them

The server imports omp's own modules from the installed package, only from `src/omp/`, and only through `src/omp/modules.ts`.
A reimplemented protocol, encryption, or session-file format drifts from the omp version the user runs; an import always speaks that version.
`src/omp/modules.ts` checks every export at startup, so a breaking omp release fails loudly with the missing export instead of misreading sessions.
See [omp modules](architecture.md#omp-modules).

## Read transcripts from session files, not the network

Every transcript comes from the session files on this machine, through one file watcher per session format.
The files exist for live and past sessions alike, for omp, Claude Code, and Codex, and never depend on a relay.
See [Transcripts](architecture.md#transcripts).

## Join every terminal session's Collab room

The server joins each listed terminal session as the guest `omp-agents`, opened or not.
Subagent status lives only in the host's memory, and the guest connection is the one source omp offers for it.
The cost is one more participant per session and a transcript snapshot through the relay on each join.
See [Why the server joins every terminal session](architecture.md#why-the-server-joins-every-terminal-session).

## Run dashboard sessions under keepers

Each dashboard session's omp runs under a keeper, a detached process that lends omp's stdio to one server at a time over a Unix socket.
A session the dashboard starts must outlive a restart, an update, or a crash of the server.
See [Session keepers](architecture.md#session-keepers).

## One server owns the unattended work

Servers on different ports share `~/.config/omp-agents`, so `server.lock` names the one server that runs routines, scheduled sends, the todo inbox, and the daily clean-up.
Two servers running them would start every routine twice.
See [One server runs the unattended work](architecture.md#one-server-runs-the-unattended-work).

## The desktop shell never imports the server

The Electron main process runs the server as a Bun child process.
Electron's main process runs on Node, which cannot load omp's TypeScript modules or the server's `Bun.*` calls.
See [Desktop shell](architecture.md#desktop-shell).

## Ask omp for what omp already computes

Plan quota comes from `omp usage --json`, and Gmail and Google Calendar use the tokens omp holds for their MCP servers.
omp already owns that setup and those sign-ins, so the dashboard needs neither a copy of the logic nor a sign-in of its own.
See [Plan quota](architecture.md#plan-quota), [Google Calendar](architecture.md#google-calendar), and [Gmail](architecture.md#gmail).

## Plain git, not Graphite, for this repository

omp-agents uses `git`, `git push`, and `gh pr create --draft`, and never `gt`, even where the maintainer's other repositories use Graphite.
The starter kit's `git-workflow.md` names this exception.

## Settings sync syncs a registry of portable items through a Git remote

Settings sync pushes only the items `SYNC_ITEMS` names: omp's user config, instruction files, skills, rules, agents, and commands, and the source control settings.
Credentials, databases, sessions, and the dashboard's machine files never sync, whatever the remote holds, and neither do routines and todos, which name one machine's sessions and runs.
A Git remote of the user's own carries them because it needs no service of ours, keeps every version, and signs in with the machine's existing git credentials.
See [Settings sync](architecture.md#settings-sync).
