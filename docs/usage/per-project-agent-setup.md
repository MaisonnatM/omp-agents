# Per-project agent setup

A repository can commit its own agent setup in an `.omp/` folder at its top, and every session started in it picks that setup up.
The folder can hold extensions, hooks, tools, TypeScript slash commands, agents, skills, rules, MCP servers in `mcp.json`, and settings in `config.yml` or `settings.json`.
omp also reads the same kinds of files from a project's `.claude/`, `.codex/`, and `.agents/` folders, and language server settings from an `lsp.json`, `lsp.yaml`, or `lsp.yml` file, with or without a leading dot, at the project's top or in one of those folders.

## Load order

omp loads its built-ins first, then your personal setup in `~/.omp/agent`, which the starter kit fills, then the project's `.omp/`.
On a name clash the project's entry wins, so a repository can replace one of your skills, tools, or MCP servers for its own sessions.
TypeScript slash commands are the exception: yours wins, and omp logs the clash.

## Trusting a project's code

Extensions, hooks, tools, TypeScript slash commands, MCP servers, settings, and language server settings are code, or start code, with your permissions.
Before the dashboard starts a session in a project with any of these, it checks that you trusted each piece.
A new session, a fork, a replay, a resume, a pull request checkout, and a Bot's, routine's, or scheduled send's start all check.
Skills, agents, rules, markdown commands, and context files are prompt text, so a project with only those never asks.

When a piece is untrusted, the start does not happen and the **Trust this project's agent code?** dialog opens.
It names the project folder and lists each piece with its kind, its path or MCP server name, and a badge:
- **New** for a piece you never trusted in this project.
- **Changed** for a piece you trusted whose content changed since, such as an edited tool or a different MCP server command.

**Trust and start** records every listed piece and sends the start again.
**Cancel** closes the dialog and leaves the start's error showing.
A start nobody is watching, such as a Bot's routine, a scheduled send, or the pull request shepherd, fails with a message naming the folder; start a session there from the dashboard to review and trust its code.

Trust belongs to the project's main checkout, so a linked worktree of a trusted repository shares its decision.
A pull request checked out into a worktree that adds or edits a piece still asks, because only the exact pieces you approved are trusted.
**Resume all** asks the same way, for the first interrupted project it cannot resume, and trusting it resumes the batch again.
When an agent's `move_session` tool asks to move into a project with untrusted code, the move is refused with the same message.

## Stop trusting

**Settings › Workspaces › Trusted projects** lists each trusted project with its folder name, its path, and how many pieces you trusted.
**Stop trusting** forgets them all, and the next start there asks again.
The list lives on this computer and does not sync.

## What the check does not cover

- A session you start with `omp` in a terminal is not checked: the dashboard does not start it.
- A `/move` you type into a session is not checked; only the agent's `move_session` tool is.
- Extensions from a project's plugins in `.omp/plugins`, and language server settings inside a plugin, are not listed.
- omp's language servers may run binaries from the project's `node_modules/.bin` or `.venv/bin` on the first edit, and the check does not list those.
- An extension, tool, or command that is a folder is checked without its `node_modules`, so a changed dependency does not ask again.
