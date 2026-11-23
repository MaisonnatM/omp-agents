# Evals

A fixed set of 20 landed omp-agents changes that tells whether a harness change, such as a new extension, a skill edit, or a model swap, makes agents better or worse at real work.
Each task is a prompt, the base commit it started from, and a hidden check: the tests its landing brought, which must pass after the agent's run.

## The set

`scripts/evals/tasks.json` holds the 20 tasks; `scripts/evals/candidates.ts` builds it from git history.

1. Every `Land <branch>` merge on `main` is a candidate: the base is its first parent, the landed commit is the merge.
2. The hidden tests are the root `bun test` files the landing added or changed, at most 3; the check is `bun test` on them.
3. A landing is left out when it touches `desktop/`, `package.json`, or `bun.lock`, changes more than 300 lines outside tests and docs, or its commit messages run past 4000 characters.
4. The prompt is the branch's commit messages, without their `Omp-Session`, `test-change`, and other trailers.
   When a hidden test imports a name the base does not export, the prompt lists that import, so a run is not failed for naming a new function differently.
   It also lists, word for word, every other name and quoted text a hidden test uses that the landing adds outside tests and docs and the base never has, such as a setting's key, a tool parameter, or an error message.
   Without that list, 2 of the pilot's first 5 runs failed on a setting key or a tool parameter the commit messages never named, as [the pilot](evals-pilot-2026-11-23.md) records.
5. `--verify` keeps a candidate only when its check fails at the base with the hidden tests in place and passes at the landed commit, in one temporary worktree, newest first, until 20 are kept.

Rebuild the set with `bun scripts/evals/candidates.ts --verify > scripts/evals/tasks.json`; a new set changes every number, so compare runs only on the same set.

## A run

`bun scripts/evals/run.ts` runs each task 3 times by default.
Each run replays the task the way [Worker model replay](token-cost.md#worker-model-replay) does, through the helpers in `scripts/evals/replay.ts` that both scripts share:

- A new repository holds the base's history and nothing after it, after the repository's `.omp/land.json` setup.
- `omp -p` runs the prompt in it under macOS's `sandbox-exec`, which hides the real repository, its worktrees, and their session folders, with no way to a remote, so a run cannot copy the landed change.
- The sandbox also hides `--out` and every `~/.cache/omp-evals*` folder except the run's own, so a run cannot copy another run's change or a dry run's landed one; the pilot's first try did exactly that.
- The run's environment drops the `PI_*` and `OMPCODE` variables an omp session sets, so a set started from inside a session starts clean.
- Unlike a model replay, a run keeps the full harness: every extension and skill the user's omp loads.
- It turns off every MCP server in `~/.omp/agent/mcp.json` through `disabledExtensions`, so a run cannot post to Slack or Linear and does not wait 30 seconds each on their startup.
- A config overlay pins every model role to `--model`, Opus by default, with no fallback.
- `XDG_CONFIG_HOME` points at the run's folder, so the kit's extensions, such as `/ship`'s trace, write there and not to the user's own files.
- After the run, the hidden tests are written from the landed commit over whatever the agent wrote, and the check runs outside the sandbox.
- The run's folder keeps its prompt, omp's output and session files, `change.diff`, and `check.log`; the clone is removed once checked.

Each run appends one line to `<out>/results.jsonl`, `~/.cache/omp-evals` by default: the task, arm, run number, model, `passed`, the failing test names, cost, requests, output tokens, which models answered, minutes, and the size of the change.
A run already recorded is skipped, so a stopped run resumes.
A run whose model could not answer, such as on a usage limit, is recorded with its `error`, left out of the summary, and retried next time; a run another model answered part of is left out of the summary too.
`--max-cost` (5 dollars) and `--max-time` (30 minutes) bound each run; the full set at 3 runs is 60 runs.

`--dry-run` does everything but call the model: it prints the omp command, applies the landed change in place of the agent's, and runs the check, which must pass for every task; it records nothing.

## The decay check

`--disable-extensions ship,bash-guard` and `--disable-skills ship,code-review` add one arm per listed component besides the full harness.
An arm turns that one component off through omp's `disabledExtensions` setting, `extension-module:<name>` for an extension and `skill:<name>` for a skill, added to the user's own list.
The summary prints, per arm, the pass rate, its change in points against the full harness, the cost per run and its change, and minutes per run.
A component whose arm passes as often for less money is not earning its tokens; one whose arm passes less often is.
`bun scripts/evals/run.ts summary` prints the table again from the results file.

With 20 tasks and 3 runs, one task's flip moves an arm's pass rate by 1.7 points, so read a difference under about 10 points as noise.
