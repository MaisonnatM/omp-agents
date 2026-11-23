---
status: accepted
date: 2026-11-23
decision-makers: agent
---

# The harness review replays its failures and upgrades unedited prompts

The weekly harness review named five past failures to replay against its proposed change, but nothing replayed them, so no proposal was ever checked.
It now saves them as `model-replay.ts` tasks under `~/.cache/omp-harness-review/`, ends with the `run` command to start once the change lands, and the next week's review reads that replay's results first and says per failure whether the change fixed it.

- The review reuses `model-replay.ts` rather than a second replay engine; `candidates --sessions` turns the failing sessions it names into tasks, main sessions included, since the ship trace names the main session that shipped a pull request, not a worker.
- The review never runs `run` or `judge`: a replay costs model money, so the user runs the printed command when the change has landed.
- The tasks, the review's reply, and the replay folder are dated files in one folder outside every checkout, as `run` requires, so the next review finds last week's by date with no state in `routines.json`.
- `summary --by-task` prints one row per replay, since the per-model table cannot say which failure a change fixed.
- A built-in routine lists every prompt an earlier version saved; a stored routine holding one of them gets the current prompt as the dashboard starts, and any other prompt is the user's edit and stays.
  Comparing against past texts needs no new field on a routine, unlike a stored prompt version, and a hash of the shipped prompt would be the same check with less to read.
- A replay loads no extension but `cache-tail.ts`, so it tests a skill, a rule, or a repository check, not an extension such as `ship.ts`; the prompt says so.

See [Built-in routines](../architecture/routines.md#built-in-routines) and [Worker model replay](../architecture/token-cost.md#worker-model-replay).
