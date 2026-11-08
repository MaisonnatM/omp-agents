# Token cost

Where the money goes when omp runs on this computer, what the starter kit and the dashboard can change about it, and how to measure a change.
The figures are from the audit of 2026-11-08, over the 14 days before it, at list price; rerun `bun scripts/token-audit/report.ts --days 14` for current ones.

## What builds a request

omp builds every request; the kit and the dashboard only add to it.

| Part, in request order | Who owns it | Cached | Size in a CLI main request |
| --- | --- | --- | --- |
| Tool schemas | omp's built-in tools, kit extension tools, dashboard host tools | with the system head | 19 tools, 35.8k chars, `task` alone 7.4k |
| System head: omp's rules, the skill list, internal URLs | omp, pstack and kit skills | 1-hour breakpoint | 20.9k chars, the skill list 9.1k |
| Project context: `AGENTS.md` files, `APPEND_SYSTEM.md`, MCP routes | the user, the kit, the repository | no breakpoint, read with the conversation | 17.1k chars, chrome-devtools routes 5.3k |
| Date and cwd reminder | omp | in the conversation | under 200 chars |
| Conversation | the model and its tools | 5-minute breakpoints from `cache-tail.ts` | 103k tokens on average |

A subagent gets omp's system head, the skill list, and its agent file, but no `AGENTS.md` or `APPEND_SYSTEM.md`; its prompt runs 19k to 32k chars.
Every kit extension loads again in each subagent, so each subagent used to carry the kit's tools too.

## Baseline

Total $1920 over 14 days; subagents spend 72% of it.

| Agent | Total | Output | Cache write | Cache read | Uncached input | $ per session | Requests per session | Cache hit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Subagent | $1378 | $335 | $412 | $620 | $10 | $4.1 | 81 | 97.3% |
| Main | $543 | $88 | $194 | $245 | $16 | $2.9 | 51 | 95.8% |

Cache reads are 45% of the bill and cache writes 31%: requests are large, about 105k tokens each, and the cache already serves 97% of them.

| Subagent kind | Runs | Cost | Share of all spend | $ per run |
| --- | --- | --- | --- | --- |
| `poteto-agent` | 128 | $720 | 37.5% | $5.6 |
| `task` | 44 | $285 | 14.8% | $6.5 |
| `poteto-agent-codex` | 15 | $131 | 6.8% | $8.7 |
| file deleted since | 37 | $110 | 5.7% | $3.0 |
| `thermonuclear-reviewer` | 80 | $83 | 4.3% | $1.0 |

Cache writes by cause, from consecutive requests of one session:

| Cause | Main | Subagent |
| --- | --- | --- |
| New content of the turn, the normal tail | $66 | $276 |
| Compaction | $20 | $76 |
| First request | $24 | $33 |
| Idle 5 minutes to 1 hour | $30 | $18 |
| Idle over 1 hour | $23 | $7 |
| Prefix changed within 5 minutes | $30 | $4 |

## Findings without a change

- **The cache layout is already right.** Tools and the system head sit before a 1-hour breakpoint, the date rides in the conversation, and three requests of one run had byte-identical tools and system blocks.
- **A 1-hour conversation cache loses money.** It would save the $48 of idle 5-minute-to-1-hour rewrites but bill every tail write at twice the input price instead of 1.25 times, about $200 more; `cache-tail.ts` keeps the 5-minute tail.
- **Large outputs already go to files.** omp spills long tool output to `artifact://` and the average `read` result is 4.2k chars.
- **Most prefix breaks follow a real change.** Of 85 breaks within 5 minutes, 29 follow a new system prompt digest, such as a `/move` or a new day, and 15 a thinking level change, some both; 22 happen mid-turn with no entry that explains them.

## Changes made

- **Subagents no longer carry the user's session tools.** `end_session`, `land`, `ship_stage`, `user_todo`, `user_note`, and `user_event` drop out of a subagent at its start; in 30 days no subagent called any of them.
  A scout's request went from 11 tools and 14.6k chars of schemas to 5 tools and 5.2k chars, about 2,600 fewer tokens per subagent request, worth about $20 per 14 days in cache reads and first-request writes.
  `pr_description` and `project_memory` stay, since subagents call them.
- **`skill://Poteto Mode` no longer fails 37 times per 14 days.** pstack renamed its skill `poteto-mode`, and the kit's alias still told agents the old name; it now says that `skill://poteto-mode` opens pstack's file.
- **The baseline is one command.** `scripts/token-audit/report.ts` prints every table above, and `scripts/token-audit/dump-request.ts` writes each request omp sends so the report can size it.

## Proposals

Ranked by expected saving; none is applied, because each needs an evaluation of quality the repository does not have yet.

| Proposal | Saving per 14 days | Risk | Owner |
| --- | --- | --- | --- |
| Run `poteto-agent` and `task` workers on a cheaper code model, keeping Opus for planning and review | about $400 if half of their $1005 moves to a model at a fifth of the price | worse code, more turns | the user's `task.agentModelOverrides` |
| Fewer, smaller worker turns: workers average 120 requests at 108k tokens | unknown until measured | lost context | pstack prompts, `task.agentCompactionThresholdOverrides` |
| Resolve an edit's relative path to the checkout its hash came from, and stop stale-anchor edits | about $35 from 885 failed edits at 12 to 16% | none for users | omp's edit tool |
| Give an agent file a skill allow-list, so a scout skips the 9.5k-char skill list | about $19 | an agent misses a skill it needed | omp's task executor |
| Mount `user_event`, `user_note`, `user_todo`, and `ship_stage` as `xd://` devices in the main session | about $5 | models think the tool is missing, as `2026-11-07-tell-cursor-models-where-dashboard-tools-are` found | kit extensions |
| Move PR-review and design-handoff rules from the kit's `APPEND_SYSTEM.md` into skills | about $4 | an agent skips the review gate | kit `APPEND_SYSTEM.md` |

### Audit of the kit's `APPEND_SYSTEM.md`

Every main request carries the whole file, about 11k chars; subagents never see it.
The verdict per block of lines, for the proposal above:

| Lines | Section | Verdict | Reason |
| --- | --- | --- | --- |
| 1-21 | Final answer format | keep | every reply uses it |
| 23-58 | Suggested next prompts | keep | every finished reply uses it; line 28's 85% figure tells the model where to spend care |
| 60-66 | Suggestions block format | keep | the dashboard parses the block from these exact lines |
| 68-78 | Design variants | move to `skill://design-workflow` | only design work needs it, and that skill already runs every UI change |
| 80-88 | Handing off a UI change | move to `skill://design-workflow` | same reason |
| 90-104 | Subagent isolation | keep | every spawn needs it, and `2026-11-06-editing-subagents-name-the-worktree-by-absolute-path` set it |
| 106-111 | Asking the user | keep | short, and applies to every session |
| 113-120 | On Cursor models | rewrite as a hook that adds it only when a Cursor model runs | Opus sessions pay for rules they never need |
| 122-127 | Starting /ship yourself | keep | it decides whether a session starts the workflow, before any skill is read |
| 129-156 | Before any pull request | move to `~/.omp/agent/docs/review-workflow.md`, leaving its first sentence | only the last step of a PR task needs it, and `AGENTS.md` already sends agents to that doc before a PR |

### Test plan for each proposal

- **Worker model.** Replay past worker prompts on both models with `scripts/token-audit/model-replay.ts`, as [Worker model replay](#worker-model-replay) says; compare checks kept, judge verdicts, and cost per task.
- **Worker turns.** Set `task.agentCompactionThresholdOverrides` to 90000 for one week and 150000 the next; compare subagent cost per run and the compaction row, and reject a setting whose runs fail their checks more often.
- **Edit paths.** Count edit errors whose text says "is not from this session" before and after the omp change; they should fall to zero.
- **Skill allow-list.** Give the scout and reviewer agents an allow-list, then check in 10 runs that each answers its brief without reading a skill it lost.
- **Main-session devices.** Behind an environment flag, run 20 prompts that need each tool on Opus and on a Cursor model; the tool must be called as often as without the flag.
- **`APPEND_SYSTEM.md` move.** Run 10 PR-shaped prompts with the trimmed file; each must still state the review decision before the PR, as the current rule requires.

### Worker model replay

`scripts/token-audit/model-replay.ts` replays real worker prompts so a model swap is judged on the work workers did.

1. `bun scripts/token-audit/model-replay.ts candidates --repo <repository> > tasks.json` lists `poteto-agent` and `task` subagent prompts of the last 14 days in that repository.
   Each entry's base is the commit the prompt names, else the target branch at the time the worker started, and its `paths` are the checkouts the prompt names, which a replay points at its own clone.
   Prompts that point at `local://` or `agent://` files are left out, since those files lived in the parent session.
2. Keep the entries worth replaying: ones that change code, whose base is the state the worker saw.
   A worker on a feature branch saw commits main did not have yet; replayed from main, it cannot do the part that needs them, as the pilot's replays of `760ccfb8` reported.
3. `bun scripts/token-audit/model-replay.ts run --tasks tasks.json --models anthropic/claude-opus-5-5:auto,anthropic/claude-sonnet-5-5:auto --out ~/.cache/omp-model-replay/<name>` runs the repository's `.omp/land.json` checks once at each base, then replays each task on each model under `--max-cost` (15 dollars) and `--max-time` (45 minutes).
   The folder must sit outside every checkout, and `run` refuses one inside: in the first pilot, replays in a clone under a worktree's `tmp/` read that worktree too.
   Each replay works in a new repository that holds the base's history and nothing after it: no branch, no tag, no remote, and no commit from later work.
   omp runs under macOS's `sandbox-exec`, which hides the task's repository, every folder whose name starts with it, such as `<repository>-wt/`, and their omp session folders, where the original worker's change and transcript sit; `run` works only on macOS.
   git rewrites every `https://`, `http://`, `ssh://`, `git://`, and `git@` address to a missing folder, and gh starts with no sign-in, so a replay can neither fetch later work nor push; a task that needs GitHub, such as reading a pull request, cannot do that part.
   In the second week, before these limits, Composer copied the original change on three of five tasks, from a worktree, from a later `main` the clone held, and with `git cherry-pick`, and force-pushed a branch of the real repository.
   A replay loads only `cache-tail.ts` of the kit's extensions, so it cannot land or touch the dashboard, and every model gets the same prompt and tools.
   A config overlay points every model role and fallback chain at the replayed model, so its subagents run on it too and a usage limit cannot hand the work to another model: before it, a model over its limit was silently answered by Opus.
   `answeredBy` in each `result.json` counts the requests per model; a replay another model answered part of is left out of the summary and the judging.
   A replay whose session ends on a model error, such as a usage limit, is removed, so the next `run` retries it rather than counting an empty change.
   Its session files stay in the run's folder, so they do not count in `~/.omp/stats.db` or `report.ts`.
4. `bun scripts/token-audit/model-replay.ts judge --out ~/.cache/omp-model-replay/<name>` asks the judge model, Opus by default, to compare the `--baseline` model's diff, Opus by default, with each other model's, shown as A and B in random order, and to list each one's defects.
5. The summary per model shows how many replays break nothing that worked at the base, empty changes, cost, requests, and minutes per task, and judge wins, ties, and losses.
   A test that already failed at the base, often from this computer's setup, is not counted against a replay that still fails it.
   Swap a worker's model only when the cheaper model keeps the checks as often and loses no more judge verdicts than it wins, over at least 20 tasks.

## Gaps

- No task-level quality score exists, so "no quality drop" rests on smoke runs, not an evaluation.
- `~/.omp/context-sources.db` stopped updating on 2026-11-01, so input-by-source shares come from the two weeks before.
- Request sizes count characters; tokens assume 3.6 characters each.
- The rendered request came from `omp -p`, without the dashboard's own extensions and host tools.
- $110 of subagent spend is in session files deleted since, so their agent kind is unknown.
- The 22 mid-turn prefix breaks have no cause yet.
