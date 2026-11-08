# HTTP API: Providers

`GET /api/providers` answers `ProvidersAnswer` from `src/shared/providers.ts`: `providers`, one `ModelProvider` for each provider omp files `/login` credentials under, and `login`, the sign-in the page last started.
`listProviders` in `src/omp/providers.ts` groups omp's available `getOAuthProviders` entries by `storeCredentialsAs ?? id`, so `openai-codex-device` joins `openai-codex` and `zai-coding-plan` joins `zai` as further `methods`.
Each provider's `accounts` are its stored credential rows as `/logout` lists them, each with its sign-in's `email` when it has one, sorted by `rankAccounts` in `src/omp/account-order.ts` into the order omp tries them.
That order is the `priority` of the `auth.accountPolicies` entry in the user's `config.yml` that matches the account through omp's `matchesAuthAccountSelector`, highest first, with no entry counting as 0 and ties in stored order.
`envKey` names the environment variable omp reads its key from when `keys.source` finds nothing stored.
The store opens and closes on each read, so a `/login` in a terminal shows at the next one; the page reads every minute, and every second while a sign-in runs.

`PUT /api/providers/login`, with `{ method }`, the `/login` entry, starts that sign-in on the server and answers the providers and the new `login`.
`createProviderLogins` in `src/provider-logins.ts` keeps one sign-in at a time: a new one aborts the one under way, and one not done within five minutes fails.
While it runs, `login` is `{ phase: "running", url, instructions, progress, prompt }`, from the flow's `onAuth`, `onProgress`, and `onPrompt` callbacks; the page shows the address as a link rather than opening it, since a device-code sign-in shows its code first.
`prompt` is `{ id, message, placeholder, secret, allowEmpty }`, and `PUT /api/providers/login/answer`, with `{ prompt, value }`, resolves the `onPrompt` call that asked it, or answers 409 once the flow no longer waits on that question.
For the paste-code providers, omp asks for the code or redirect address while its local callback also listens, and whichever comes first finishes the sign-in.
A sign-in ends as `{ phase: "done", identity }`, after `ModelRegistry.refreshProvider` re-reads the provider's models, or `{ phase: "failed", error }`, and stays until the next one starts or `PUT /api/providers/login/cancel`, which also aborts one under way.
A flow that stores nothing, such as Ollama's with an empty key, fails, as `omp login` reports it.
The Anthropic row adds method `anthropic-api-key`, which reuses the same secret prompt and answer routes.
It saves the key with `source: "login"` through `discoverAuthStorage`, then removes only older API-key rows.
OAuth accounts stay, including when a broker holds them.
The page receives credential metadata only.
Key-save failures use fixed messages, and the native error stays on `cause`, so a secret in the store's error is not sent to the page.
This method does not change model-role or fallback settings.

`PUT /api/providers/sign-out`, with `{ provider, credentialId }`, removes that row through omp's `logoutCredential`, which refreshes the provider's models, and answers the providers after.

`PUT /api/providers/account-order`, with `{ provider, emails }`, saves the order of that provider's signed-in accounts, the first tried first, and answers the providers after.
`emails` must name exactly the accounts `orderableAccounts` in `src/shared/providers.ts` keeps, those with an email no other account shares, since one policy naming a shared email would match two sign-ins, which omp refuses; otherwise the route answers 409.
`writeAccountOrder` gives those accounts priorities from their count down to 1, setting only `priority` on the entry that already matches each one and adding `{ provider, account: { email }, priority }` for the rest.
It leaves every other entry and field, such as `reservePct` and `reclaimAbovePct`, and reads the setting again inside `configWrites`, the queue of the dashboard's `config.yml` writes, so an edit saved just before it is kept rather than overwritten.
`parseLoginMethod`, `parseLoginAnswer`, `parseProviderSignOut`, and `parseAccountOrder` in `src/server/wire.ts` check the bodies.
