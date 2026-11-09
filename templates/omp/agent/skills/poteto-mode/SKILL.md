---
name: poteto-mode
description: Invoke poteto's agent style on omp. Says where pstack's own poteto-mode skill file is, and maps its Cursor routes to omp.
disable-model-invocation: true
---

# poteto-mode

The mode lives in pstack's own skill file, also named `poteto-mode`, which `skill://poteto-mode` opens instead of this one when both are installed. Reached here, find it with one `glob` of `~/.omp/plugins/cache/plugins/cursor-plugins___pstack___*/skills/poteto-mode/SKILL.md`, then `read` the highest version's file in full, including its inline Principles index, and work in that style for the rest of the session.
Its material sits in the same directory: `playbooks/<name>.md`, `references/<name>.md`, and `scripts/<file>`. Each principle or routed skill is at `skill://<name>`.

pstack is written for Cursor. On omp, the routes below replace every Cursor tool, path, and model name in the mode, its playbooks, and its routed skills. Translate as you read, and open each skill through its exact `skill://` URI, not a plugin cache path.

## Precedence

- The user's final-answer format (bold answer first, optional Needs you / Not verified / Done lines) is the shape of every reply. Poteto's **Writing the reply** rules apply to the sentences inside it.
- A session that `/ship` owns keeps its stages, `ship_stage` calls, draft-only PR, and thermonuclear gate. Pstack playbooks run inside those stages and never mark a PR ready or merge it on their own.
- The git-safety rules in `~/.omp/agent/AGENTS.md` apply too: on `main`, work in a dedicated worktree and spawn editing subagents without `isolated`, naming that worktree's absolute path in each task; on any other local branch, the session and its editing subagents work in place.

## Subagents and models

omp's `task` call has no per-spawn `model`, `readonly`, `environment`, or `run_in_background` field. The agent you pick sets the model, so map pstack roles to agents:

| pstack role or default model | omp agent |
| --- | --- |
| `subagent_type: "poteto-agent"`, `generalPurpose`, any single role, `claude-opus-*`, `grok-*`, `auto`, `inherit-parent` | `poteto-agent` (runs on the parent's model) |
| A second opinion, the arena cross-judge, or a panel slot that should use a different model family | `poteto-agent-codex` (`openai-codex/gpt-6.1-sol:xhigh`) |
| `subagent_type: "comment-sicko"` | `comment-sicko` |
| Read-only bulk lookup with no judgment in it | `scout` |

- **Panels.** Panel lines (arena runners, architect runners, interrogate reviewers) use one subagent per entry. Alternate `poteto-agent` and `poteto-agent-codex`, so that a two-entry panel spans both model families. If a spawn of `poteto-agent-codex` fails because Codex has no quota left, run that slot on `poteto-agent` and say that the panel ran on a single model family.
- **`readonly: true`.** Write "read-only: report findings, edit nothing" into the assignment, and keep the spawn on `poteto-agent` so that it runs at full model strength.
- **`environment: "cloud"`.** omp has no cloud agents. Give each worker its own worktree: `isolated: true` from a session that sits in a worktree, or a worktree per worker named by absolute path when the session is on `main`. `task.maxConcurrency` is 2, so wider fan-outs queue, and nothing is wrong when they do.
- **`run_in_background: true`.** omp spawns in the background by default, and results arrive by themselves. Block only with `wait`.
- **Resume or message an agent.** Use `write agent://<id>`, or the Agent Hub (`Alt+A`) for a parked agent. Check on a running agent by reading `agent://<id>` without resuming it.
- **`pstack-models.mdc` and `/setup-pstack`.** omp does not read Cursor rules, so ignore every `pstack-models.mdc` line and its Cursor default slugs. To change a role's model on omp, first read `~/.omp/agent/docs/model-routing.md`. Then set `task.agentModelOverrides` for `poteto-agent` or `poteto-agent-codex` with `omp config set`, using a selector that `omp models --json` lists, and read the setting back.

## Tool and path map

| Cursor term | omp route |
| --- | --- |
| `AskQuestion` | `ask` |
| Playbook todolist | `todo` with `op: "init"`. The playbook's steps go in verbatim as the first phase. |
| `deslop` (`cursor-team-kit`) | Review the diff for needless abstractions, dead paths, and defensive workarounds, then apply `skill://no-comments`. |
| `control-ui` | Read the repository's smoke guide and `xd://eval/browser`, then exercise the real surface. Yampa console proof follows `.agents/skills/verify-yampa/SKILL.md`. |
| `control-cli` | Launch the actual command with `bash`, drive interactive programs through a PTY, and observe the output and the resulting state. |
| `create-skill` | `skill://writing-for-agents` |
| Cursor's built-in `babysit` | Not available. Use pstack's Babysit playbook. |
| `agent-transcripts/` for this workspace | eval `archive.sessions()` for the current project, then `read` the session's `file` (omp session JSONL). For a subagent, use `history://<id>` or `agent://<id>`. Keep to the current project unless the user widens the scope. |
| `~/.cursor/projects/<slug>/agent-transcripts/` (`recall`, `worktree-audit.sh`) | `~/.omp/agent/sessions/--<path with "/" as "-">--/*.jsonl`. omp's entry schema differs from Cursor's, so read an entry before parsing it. `worktree-audit.sh` leaves `LAST_CHAT` empty on omp, so check `archive.sessions()` for liveness instead. |
| `.cursor/skills/<name>/` (project) and `~/.cursor/skills/` | `.agents/skills/<name>/` and `~/.agents/skills/`. omp loads both and does not read `.cursor/skills`. |
| A skill read under `.cursor/skills`, `~/.cursor/plugins` (`reflect`) | A `read` of a `skill://` URI, or of a path under `~/.agents/skills` or `~/.omp/plugins/cache/plugins/*pstack*` |
| Cursor dashboard, a cloud-agent URL | Agent Hub (`Alt+A`) and `agent://<id>`. Pick up a prior session from `archive` or from a pushed branch. |
| Cursor restart (Pause safely) | Session end or compaction. Write the pause note before either one. |
| `automations/` | Cursor-only. Skip. |
| Opening a PR, in a repository that commits `.omp/land.json` | That repository lands through the `land` tool, not a pull request. Skip the step and say so; pass `path` to `land` when the work sits in a worktree. |
| Marking a playbook step done | Only once it ran. A step that does not apply is marked done with the reason stated in the reply. |

## Scripts

Script dependencies live in `scripts/node_modules`. After a pstack upgrade, run `bun install --frozen-lockfile` in the `scripts` directory of the resolved skill.
Resolve `scripts/worktree-audit.sh` against that pstack `skills/poteto-mode/` directory, and run it from the repository you are auditing.
