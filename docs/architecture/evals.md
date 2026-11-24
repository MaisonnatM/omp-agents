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
   Last come the task's hand-written notes from `scripts/evals/task-notes.json`, keyed by task id: what its tests pin that no name list catches, such as a dependency's method, a fixture's fields, an exact error message, or an output's order.
   The 2026-11-24 run failed 11 of 20 tasks on the same tests in all 3 runs, each time on such a detail; the notes state the interface, never the implementation, the hidden tests' names, or their paths.
5. `--verify` keeps a candidate only when its check fails at the base with the hidden tests in place and passes at the landed commit, in one temporary worktree, newest first, until 20 are kept.

Rebuild the set with `bun scripts/evals/candidates.ts --verify > scripts/evals/tasks.json`; a new set changes every number, so compare runs only on the same set.

## A set from merged pull requests

A repository with no `Land` merges, such as yampa, gets its set from its merged pull requests through `scripts/evals/pull-candidates.ts`.
Each task carries its `repo`, the checkout it comes from, so `run.ts` replays it there instead of in omp-agents.

1. It lists the last `--pages` hundred closed pull requests on `main` through `gh api` and keeps the merged ones that name a Linear ticket, such as `ENG-2903`, in the title, branch, or body.
2. A pull request is kept when it changes Python under `--package` (`yampa`) and a Python test under `tests/`, changes fewer than 400 lines outside `tests/`, and adds no migration.
   A ticket that more than one merged pull request names is left out, since its text asks for more than any one of them did.
3. The base is the merge commit's first parent, which is `main` before the change for a squash merge and for a merge commit; a rebase merge, whose subject lacks `(#<number>)`, has no single base and is left out.
4. The hidden tests are every file the pull request added or changed under `tests/`, `conftest.py` and factories included.
5. The prompt is the Linear ticket's title and description, with Linear's mention tags cut to their labels, then the pull request's description under `## What the change did`.
   A script cannot reach Linear, so the calling session saves the tickets to a JSON file keyed by ticket id and passes it as `--tickets`; `--tickets-needed` prints the ids in pick order.
   A ticket missing from the file falls back to the pull request's title, and the script says so.
   The ticket alone under-specifies the change: the set built on 2026-11-23 ran whole landed test files against ticket-only prompts and scored 0%, with runs such as 64 of 65 and 82 of 88 tests passing, because the tests also checked behaviour only the pull request described, such as a second route's permission or a per-period row cap.
   The description loses its code blocks, images, HTML comments, checkboxes, and the review bot's markup, keeps the bot's summary under its own heading, and drops every line that names a hidden test, a hidden file, or the pull request's number.
   A prompt that still names one, or holds a code block, is dropped.
6. Picks go newest first, at most 2 per folder under `yampa/` until that runs short.
   `--verify` runs the hidden test modules at the base with the hidden tests in place and at the merge commit, in one temporary clone, and keeps as `testIds` only the pytest node ids that fail at the base and pass at the merge commit.
   The check then runs only those ids, so a test that already passed at the base, or one the merge commit fails, never decides a run.
   A pull request with no such test is dropped, and `--verify` stops once 20 are kept.

yampa's tests need Postgres with pgvector.
The default check starts the main checkout's `db` service with `docker compose -f ~/code/yampa/compose.yml up -d db`, which leaves a running container alone; a clone's own `compose.yml` at an old base could differ and recreate it.
It then creates the empty `envs/local.env` and `envs/shared-secrets.env` that yampa's CI creates, and runs `uv run --group dev pytest -rfEp --continue-on-collection-errors` on the hidden tests with `DB_HOST=localhost` and `TEST_GROUP=evals`, so the tests' `postgres_test_db` fixture creates and drops its own `test_db_evals` database beside a developer's.
`-rfEp` prints each test's outcome by node id, which `--verify` and a run's test share read; `--continue-on-collection-errors` keeps a module that fails to import at the base from stopping the others.
`--check` replaces that command for another repository; `{tests}` becomes the hidden test modules, then the fail-to-pass node ids, and the command must print pytest's `-rp` lines.
The first check in a clone builds its virtual environment from uv's cache, about two minutes, so a check may run 15 minutes before it times out.
The sandbox does not block docker, but the check runs after omp exits and outside the sandbox anyway, and needs no model.

The set holds yampa's ticket text, security findings included, so it stays out of this repository, in `~/.cache/omp-evalset/yampa-20.json`:

```sh
bun scripts/evals/pull-candidates.ts --tickets-needed > ids.txt   # fill tickets.json from Linear for these ids
bun scripts/evals/pull-candidates.ts --tickets ~/.cache/omp-evalset/yampa-tickets.json --verify > ~/.cache/omp-evalset/yampa-20.json
bun scripts/evals/run.ts --tasks ~/.cache/omp-evalset/yampa-20.json --runs 3 --out ~/.cache/omp-evals/yampa
```

The set built on 2026-11-24 replaced the 2026-11-23 one, whose prompts held only the ticket and whose checks ran whole test files.
It holds 20 tasks with 1 to 121 fail-to-pass tests each; `--verify` dropped `pr-7419`, whose tests all passed at the base, and the leak guard dropped `pr-7387`, whose ticket names a hidden test file.
Its newest task, `pr-7564` (ENG-3113), is not in the tickets file, so its prompt is the pull request's title and description.

## A run

`bun scripts/evals/run.ts` runs each task 3 times by default.
Each run replays the task the way [Worker model replay](token-cost.md#worker-model-replay) does, through the helpers in `scripts/evals/replay.ts` that both scripts share:

- A new repository holds the base's history and nothing after it, after the repository's `.omp/land.json` setup.
- `omp -p` runs the prompt in it under macOS's `sandbox-exec`, which hides the real repository, its worktrees, and their session folders, with no way to a remote, so a run cannot copy the landed change.
- The sandbox also hides `--out` and every `~/.cache/omp-evals*` folder except the run's own, so a run cannot copy another run's change or a dry run's landed one; the pilot's first try did exactly that.
  The folders above the run's own stay visible as entries, though not listable: git and uv stat each of them, and without that the 2026-11-24 smoke run could not run git status, uv, or pytest in its clone.
- The run's environment drops the `PI_*` and `OMPCODE` variables an omp session sets, so a set started from inside a session starts clean.
- Unlike a model replay, a run keeps the full harness: every extension and skill the user's omp loads.
- It turns off every MCP server in `~/.omp/agent/mcp.json` through `disabledExtensions`, so a run cannot post to Slack or Linear and does not wait 30 seconds each on their startup.
- A config overlay pins every model role to `--model`, Opus by default, with no fallback.
- `XDG_CONFIG_HOME` points at the run's folder, so the kit's extensions, such as `/ship`'s trace, write there and not to the user's own files.
- After the run, the hidden tests are written from the landed commit over whatever the agent wrote, and the check runs outside the sandbox.
- The run's folder keeps its prompt, omp's output and session files, `change.diff`, and `check.log`; the clone is removed once checked.

Each run appends one line to `<out>/results.jsonl`, `~/.cache/omp-evals` by default: the task, arm, run number, model, `passed`, the failing test names, `testsPassed` of `testsTotal` (how many of the task's `testIds` passed), cost, requests, output tokens, which models answered, minutes, and the size of the change.
A run already recorded is skipped, so a stopped run resumes.
A run whose model could not answer, such as on a usage limit, is recorded with its `error`, left out of the summary, and retried next time; a run another model answered part of is left out of the summary too.
`--max-cost` (5 dollars) and `--max-time` (30 minutes) bound each run; the full set at 3 runs is 60 runs.
`--jobs N` runs N tasks at once, each in a child `run.ts --only <task>` that runs that task's runs in order and appends its rows as before, so only the order of lines in `results.jsonl` changes.

`--dry-run` does everything but call the model: it prints the omp command, applies the landed change in place of the agent's, and runs the check, which must pass for every task; it records nothing.

## The decay check

Run it on every model upgrade: a skill or review a weaker model needed can stop earning its tokens on a stronger one, or start getting in its way.
It drops one component at a time and keeps only what moves the pass rate.

```sh
bun scripts/evals/run.ts --tasks ~/.cache/omp-evalset/yampa-20.json --out ~/.cache/omp-evals/yampa --model <new model> --decay --plan   # arms, runs, and cost; spends nothing
bun scripts/evals/run.ts --tasks ~/.cache/omp-evalset/yampa-20.json --out ~/.cache/omp-evals/yampa --model <new model> --decay          # the runs, then the table
```

`--disable-extensions ship,bash-guard` and `--disable-skills ship,code-review` add one arm per listed component besides the full harness.
An arm turns that one component off through omp's `disabledExtensions` setting, `extension-module:<name>` for an extension and `skill:<name>` for a skill, added to the user's own list.
`--decay` fills either list you leave out with `DECAY_COMPONENTS` in `run.ts`: the `ship` extension and the skills `backend-development`, `writing-tests`, `implementation-guidelines`, `diagnosing-bugs`, `code-review`, and `ship`.

The thermonuclear and interface reviews have no arm of their own.
Only `/ship` spawns `thermonuclear-reviewer` and `interface-reviewer`, after it opens a pull request, and a run has no remote to open one on; none of the 29 eval runs recorded by 2026-11-23 spawned a subagent or called `ship_stage`.
omp's `disabledExtensions` has no id for an agent either, so the `-extension:ship` arm, which drops the whole ship flow that asks for the reviews, is as close as a run gets.

The summary prints, per arm, pass@1, pass@k for k = `--runs`, the mean share of each run's `testIds` that passed, the change in pass@1 points against the full harness with its 95% band, the cost per task run and its change, minutes per task run, and a verdict.
The test share tells a run that missed one test from one that missed them all; pass@1 counts both as failures.
pass@k is the unbiased estimate 1 - C(n-c, k) / C(n, k) for a task with n scored runs of which c passed, averaged over the tasks with at least k runs; with 3 runs, pass@3 is the share of tasks that passed at least once.
The band is the Agresti-Caffo interval on the difference of two pass rates: add one pass and one failure to each arm, then take the smoothed difference ± 1.96 standard errors, so an arm at 0% or 100% still gets a band.
The verdict reads the band:

- keep: the whole band is below zero, so dropping the component lowers the pass rate beyond noise.
- drop candidate: the band holds zero, so dropping it has no measurable effect; drop it when its arm also costs less.
- harmful: the whole band is above zero, so the harness passes more often without it.

With 18 tasks and 3 runs, 54 runs per arm, the band is about ±18 points at a 50% pass rate, so only a large effect earns keep or harmful; raise `--runs` to narrow it.
The band treats runs as independent and ignores that both arms ran the same tasks, which makes it wider than a paired test, never narrower.
`bun scripts/evals/run.ts summary --out <out>` prints the table again from the results file.

`--plan` prints the arms, how many runs each still has to record, and the cost, and runs nothing.
The estimate is (1 + extensions + skills) × tasks × `--runs` runs, less those already recorded, times the mean cost of a scored run of `--model`.
That mean comes from the set's own past runs when it has any, else from every past run of the model in `~/.cache/omp-evals*/results.jsonl` and one folder below, and the plan says which.
The ceiling is the same run count times `--max-cost`, each run's cost cap.

## Runs in the dashboard

A run started from an omp session, which sets `PI_SESSION_FILE` in the runner's environment, records itself as `<artifacts>/eval-runs/<id>.json` beside that session's transcript (`writeEvalRun` in `src/eval-runs.ts`), before the confined omp starts and again once the run is scored.
The record holds the task, arm, run, model, the task prompt's first line, the runner's pid, the run's `--session-dir`, its start, and once scored its end, its outcome line, and whether its model could not answer.
The id is `<task>.<run>`, after `<arm>.` for an arm other than the full harness, so a `--jobs` child process records its runs beside its parent's.
The dashboard reads the records of each live session's main agent and subagents on every registry listing and lists each run as a subagent of the one that started it: running while the runner's pid lives, idle once scored, aborted when its model could not answer or the runner exited before scoring it.
Opening the run opens the newest session file in its `--session-dir`; it cannot be messaged or stopped from the dashboard, and the session never waits on it.
`--dry-run` records nothing, and a run started outside omp records nothing.
