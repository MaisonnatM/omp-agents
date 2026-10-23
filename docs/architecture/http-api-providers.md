# HTTP API: Providers

`GET /api/providers` answers `ProvidersAnswer` from `src/shared/providers.ts`: `providers`, one `ModelProvider` for each provider omp files `/login` credentials under, and `login`, the sign-in the page last started.
`listProviders` in `src/omp/providers.ts` groups omp's available `getOAuthProviders` entries by `storeCredentialsAs ?? id`, so `openai-codex-device` joins `openai-codex` and `zai-coding-plan` joins `zai` as further `methods`.
Each provider's `accounts` are its stored credential rows as `/logout` lists them, and `envKey` names the environment variable omp reads its key from when `keys.source` finds nothing stored.
The store opens and closes on each read, so a `/login` in a terminal shows at the next one; the page reads every minute, and every second while a sign-in runs.

`PUT /api/providers/login`, with `{ method }`, the `/login` entry, starts that sign-in on the server and answers the providers and the new `login`.
`createProviderLogins` in `src/provider-logins.ts` keeps one sign-in at a time: a new one aborts the one under way, and one not done within five minutes fails.
While it runs, `login` is `{ phase: "running", url, instructions, progress, prompt }`, from the flow's `onAuth`, `onProgress`, and `onPrompt` callbacks; the page shows the address as a link rather than opening it, since a device-code sign-in shows its code first.
`prompt` is `{ id, message, placeholder, secret, allowEmpty }`, and `PUT /api/providers/login/answer`, with `{ prompt, value }`, resolves the `onPrompt` call that asked it, or answers 409 once the flow no longer waits on that question.
For the paste-code providers, omp asks for the code or redirect address while its local callback also listens, and whichever comes first finishes the sign-in.
A sign-in ends as `{ phase: "done", identity }`, after `ModelRegistry.refreshProvider` re-reads the provider's models, or `{ phase: "failed", error }`, and stays until the next one starts or `PUT /api/providers/login/cancel`, which also aborts one under way.
A flow that stores nothing, such as Ollama's with an empty key, fails, as `omp login` reports it.

`PUT /api/providers/sign-out`, with `{ provider, credentialId }`, removes that row through omp's `logoutCredential`, which refreshes the provider's models, and answers the providers after.
`parseLoginMethod`, `parseLoginAnswer`, and `parseProviderSignOut` in `src/server/wire.ts` check the bodies.
