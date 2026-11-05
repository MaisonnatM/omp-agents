# Plan quota

Plan quota comes from `omp usage --json`, run through this same package's CLI.
omp builds those reports from its auth storage, extensions, and credential broker, so the server reads the command's output instead of rebuilding that setup.
omp can exit non-zero after it prints the reports it did get, so the server reads the output whatever the exit code.
When the output is not a usage report, the footer shows the last line omp wrote to stderr.
`UsagePoll` in `src/server/usage-poll.ts` runs it every minute while a socket listens, as `Dashboard` lists the registry, and when a socket opens unless the run and the plan notice check after it both succeeded since the last tick that found none, so no page means no `omp usage` runs.
A continue that a usage limit schedules ([Scheduled sends](scheduled-sends.md)) runs it at once whatever the listeners, for fresh reset times, without the plan notice check and without marking it done, so the next page to open still checks; one run under way serves every caller.
`parsePlanUsage` keeps each limit's omp id and whether omp reports it `exhausted`, which, when omp gives no status, means nothing is left; a window omp lets run past its limit, as Codex's does, is not used up.
It keeps a report's `resetCredits` as omp's `availableCount`, which counts banked credits whether or not one can be redeemed now, and the soonest expiry among the credits omp counts, those neither `expired` nor `redeemed` with some left, or `null` when it is 0.
A limit in `usd` without a window, such as omp's `anthropic:extra` when Claude extra usage is on, becomes the plan's `extra`: the dollars spent, the monthly cap or `null`, and whether it is used up; a plan with only extra usage still counts.
A window omp meters in `usd`, such as Cursor's `Other Models`, also keeps its dollars as `usd`.
`plansWithConfiguredProviders` adds a name-only plan for each provider whose model config sets an API key when this report left it out, such as prepaid API credits.
An Anthropic API key saved in Settings is a stored `api_key` row beside the Anthropic sign-in, so `configuredProviders` also lists `anthropic-api` for it, once, whether or not a model config names that provider.
That plan has no windows, extra usage, or reset credits. The footer shows its name, and plan notices ignore it.
`readConsoleCreditBalance` in `src/console-credits.ts` then looks for a Firefox or Zen `sessionKey` cookie for `platform.claude.com` and reads that organization's promotional credit grant.
When the grant is there, the API credits row gains `balance`: dollars spent, the grant, and the soonest expiry.
A missing cookie, a refused session, or no promotional tranche leaves the row as the name.
Chrome's cookie store is encrypted, so a Console sign-in that exists only there is not read.
This is outside `omp usage` because that report has no balance for an API key, and an individual Console organization cannot call the Admin cost API.
omp reports no dollars for a Codex account's credit balance, so a Codex plan never has `extra`.
