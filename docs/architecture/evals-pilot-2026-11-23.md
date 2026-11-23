# Eval pilot, 2026-11-23

The first runs of the [eval set](evals.md): 5 of its 20 tasks, picked by the size of their landed change, 1 run each, on the default model `anthropic/claude-opus-5-5:auto` with the full harness, through `bun scripts/evals/run.ts --runs 1 --only <task>`.
Every request in every run was answered by `anthropic/claude-opus-5-5`, so every run counts.

## Results

Tokens are output tokens summed over every request of the run, its subagents included; the change size counts files and lines changed against the base, tests and docs included.
The landed change is the size of the original landing outside tests and docs.

Round 2, after the fixes below, with the prompts `scripts/evals/tasks.json` now holds:

| Task | Landed change | Passed | Cost | Output tokens | Requests | Minutes | Files changed | Lines changed | Failing tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| weekend-retro-fixes | 2 files, 11 lines | no | $0.44 | 2,502 | 12 | 0.6 | 3 | 15 | 1 |
| stale-integrations-cache | 1 file, 22 lines | yes | $0.21 | 2,310 | 7 | 0.5 | 3 | 21 | 0 |
| agent-schedule-send | 2 files, 94 lines | no | $0.71 | 10,707 | 19 | 1.8 | 6 | 152 | 2 |
| board-create | 5 files, 162 lines | no | $1.44 | 18,914 | 36 | 3.2 | 7 | 270 | 1 |
| idle-session-stop | 7 files, 190 lines | no | $1.20 | 18,097 | 24 | 5.9 | 13 | 253 | 15 |

Round 2 passed 1 of 5 for $4.00 in total, 52,530 output tokens, and 12 minutes of run time.

Round 1, with the sandbox fix and before the prompt fix:

| Task | Passed | Cost | Output tokens | Requests | Minutes | Files changed | Lines changed | Failing tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| weekend-retro-fixes | no | $0.30 | 3,946 | 14 | 0.9 | 4 | 17 | 1 |
| stale-integrations-cache | yes | $0.25 | 2,943 | 10 | 0.7 | 3 | 30 | 0 |
| agent-schedule-send | no | $0.90 | 10,481 | 19 | 1.8 | 7 | 164 | 2 |
| board-create | yes | $1.71 | 20,931 | 35 | 3.5 | 6 | 273 | 0 |
| idle-session-stop | no | $1.49 | 19,500 | 27 | 3.3 | 14 | 249 | 18 |

Round 1 passed 2 of 5 for $4.65 in total, 57,801 output tokens, and 10.2 minutes of run time.
Across both rounds, 3 of 10 runs passed for $8.65.

## What the pilot fixed

- A run copied its change from a sibling run: the agent of `agent-schedule-send` found another task's clone under the results folder and applied a commit from it.
  The sandbox now hides `--out` and every `~/.cache/omp-evals*` folder except the run's own, and that first try's results were thrown away.
- Runs loaded the user's MCP servers, so a run could post to Slack or Linear, and each waited 30 seconds on four servers that never came up.
  A run now turns off every server in `~/.omp/agent/mcp.json` through `disabledExtensions`.
- A run started from inside an omp session inherited that session's `PI_SESSION_FILE`, `PI_SESSION_ID`, and `PI_TOOL_CALL_ID`; the run's environment now drops them.
- In round 1, `idle-session-stop` failed on the setting key `stopIdleSessionsAfterHours` and `agent-schedule-send` on the tool parameter `in_minutes`, names the commit messages never said.
  The prompt now lists, word for word, each name and quoted text the hidden tests share with the landed change and the base lacks; in round 2 neither run failed on those names.

## What it found and did not fix

Every failure in round 2 is a detail the hidden tests pin and neither the commit messages nor the new list names:

- `weekend-retro-fixes`: the error text lists open projects on one line, and the agent listed them one per line with their goals.
- `agent-schedule-send`: the tool's text parameter is `message`, a word the base already has, and the agent named it `text`; the error message differs.
- `board-create`: the duplicate channel error says "There is already a #general channel." where the test wants "#general already exists.", built from a template the list cannot quote.
- `idle-session-stop`: the landing changed the shape of an existing dependency of `SessionProcessWatch`, and the agent kept the old one.

`board-create` passed in round 1 and failed in round 2 on that one message, so a single run per task is noise; the set's default of 3 runs is the least to compare harness changes with.
Until the hidden tests stop pinning unstated wording, the pass rate measures how closely an agent guesses the author's names as much as whether it did the work, so read a pass-rate change together with the failing test names in `results.jsonl`.
