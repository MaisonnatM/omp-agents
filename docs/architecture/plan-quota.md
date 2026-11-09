# Plan quota

Plan quota comes from `omp usage --json`, run through this same package's CLI.
The CLI remains authoritative for quota windows, reset credits, and extension reports because it builds them from omp's auth storage, extensions, and credential broker.
omp can exit non-zero after it prints the reports it did get, so the server reads the output whatever the exit code.
When the output is not a usage report, the footer shows the last line omp wrote to stderr.
`UsagePoll` in `src/server/usage-poll.ts` runs it every minute while a socket listens, as `Dashboard` lists the registry, and when a socket opens unless the run and the plan notice check after it both succeeded since the last tick that found none, so no page means no `omp usage` runs.
A continue that a usage limit schedules ([Scheduled sends](scheduled-sends.md)) runs it at once whatever the listeners, for fresh reset times, without the plan notice check and without marking it done, so the next page to open still checks; one run under way serves every caller.
`parsePlanUsage` keeps each limit's omp id and whether omp reports it `exhausted`, which, when omp gives no status, means nothing is left; a window omp lets run past its limit, as Codex's does, is not used up.
It keeps a report's `resetCredits` as omp's `availableCount`, which counts banked credits whether or not one can be redeemed now, and the soonest expiry among the credits omp counts, those neither `expired` nor `redeemed` with some left, or `null` when it is 0.
A limit in `usd` without a window, such as omp's `anthropic:extra` when Claude extra usage is on, becomes the plan's `extra`: the amount spent, currency `USD`, the monthly cap or `null`, and whether it is used up.
A plan with only extra usage still counts.
Claude's normalized limits can omit non-USD extra usage even when its raw report retains `spend` or `extra_usage`.
The dashboard reads that raw billing for Claude and keeps the CLI's quota windows.
`src/omp/usage.ts` reads native `AuthStorage.usage.reports` through `src/omp/modules.ts` to supplement that raw billing, not replace the CLI's quota or extension reports.
The supplement requires the same Claude account.
An organization has to match when both reports name one.
Email alone never joins reports across organizations.
Enabled `raw.spend` keeps its original currency and scales `amount_minor` by `exponent`, so `1365` with exponent `2` in `EUR` is €13.65, without conversion.
A missing cap remains `null`, not zero or a fabricated limit.
`ExtraUsage` carries that currency; `UsdAmount`, monetary quota windows, and API credit balances stay USD-only.
A window omp meters in `usd`, such as Cursor's `Other Models`, also keeps its dollars as `usd`.
See [Keep CLI quotas and supplement Claude raw billing](../decisions/2026-11-06-keep-cli-quotas-and-supplement-claude-raw-billing.md) for the alternatives.
`plansWithConfiguredProviders` adds a name-only plan for each provider whose model config sets an API key when this report left it out, such as prepaid API credits.
An Anthropic API key saved in Settings is a stored `api_key` row beside the Anthropic sign-in, so `configuredProviders` also lists `anthropic-api` for it, once, whether or not a model config names that provider.
That plan has no windows, extra usage, or reset credits. The footer shows its name, and plan notices ignore it.
`readConsoleCreditBalance` in `src/console-credits.ts` then looks for a Firefox or Zen `sessionKey` cookie for `platform.claude.com` and reads each API organization's prepaid credits.
On Linux those profiles live under the home directory, including Flatpak and Snap.
The API credits row gains `balance`, one of two kinds: `grant`, the dollars spent of the promotional grant, the grant, and the soonest expiry, or with no grant, `prepaid`, the dollars `left`, read from the Console's `amount` in US cents and below zero when usage ran past it.
The first organization with a grant wins; with none, the first organization's prepaid balance does.
A missing cookie, a refused session, or an answer with no grant and no amount in US dollars leaves the row as the name.
Chrome's cookie store is encrypted, so a Console sign-in that exists only there is not read.
This is outside `omp usage` because that report has no balance for an API key, and an individual Console organization cannot call the Admin cost API.
`withCreditRuns` then sets `outOfCreditSince` on a name-only row whose provider has a run of refused requests in `readCreditRuns` from `src/omp/stats.ts`, the same runs that raise the bell's out-of-credit notice.
A run counts a billing cap omp names, such as a 402 for credits or a spent balance, and Anthropic's 400 `credit balance is too low`, so the footer turns red even when the balance read above still shows dollars left; the 20% amber threshold stays the existing one for a known grant.
omp reports no dollars for a Codex account's credit balance, so a Codex plan never has `extra`.
