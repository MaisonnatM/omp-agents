# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through [GitHub's vulnerability reporting](https://github.com/MaisonnatM/omp-agents/security/advisories/new) and include the steps to reproduce it, the affected version or commit, and its impact. Expect an acknowledgement within a week.

Only the latest commit on `main` receives fixes.

## Threat model

A control link gives full control of the session. Anyone who holds it can read the whole conversation, prompt the agent, and message its subagents. The agent runs tools on your machine. The dashboard treats it that way:

- The server listens on `127.0.0.1` only.
- Links and room keys exist only in server memory, inside the function that opens the room. The server never writes them to disk, never logs them, and never sends them to the page.
- The page names a past session by its id and a subagent by the id its host registered. The server reads only files from omp's own session listing, the paths omp reports over RPC, and subagent files under those sessions' directories. The settings endpoints read and write only the files that omp's discovery reports for the workspace, and their `cwd` must be a directory that a live or saved session ran in.
- The WebSocket, the settings writes, and the pull-request write accept only requests whose `Host` is `127.0.0.1:<port>` or `localhost:<port>` and whose `Origin` matches it. The writes also require a `Content-Type: application/json` body, which a cross-site form cannot send. The settings reads, the inbox, and the pull request details require that `Host`. Other websites open in your browser cannot drive your sessions, read or change your omp files, or edit your pull requests, and DNS rebinding does not get around the check.
- The pull-request write edits a description on GitHub as the account that `gh` is signed in to. It writes only the marked block of session links, and only for sessions that submitted or worked on that pull request. Anyone who can read the pull request sees the session ids and the dashboard's port, not the transcripts, which never leave this machine.
- There is no login. The `Host` and `Origin` checks stop web pages, not local programs: any program or user account on this machine can send those headers, prompt every listed session, read and edit your omp files, and start omp in any directory that you can read. Run the dashboard only on a machine that you alone use, and do not expose the port through a tunnel or a proxy.
