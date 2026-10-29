# Get started

`web/components/get-started.tsx` owns the wizard: its welcome screen, the fixed five-step table, the step rail, and Back, Next, and Skip.
`web/components/get-started-steps.tsx` draws each step's body with its local pending and result state.
`PageSwitch` mounts it only for `#get-started` or a vacant home; it never redirects the hash or covers a selected page, draft, or pane.
The provider count and any global live or past session suppress automatic onboarding for an existing setup.
While those initial facts are unknown, home stays neutral rather than flashing an onboarding page at a returning user.
Two keys are stored through `useStoredState`, deliberately absent from `PORTABLE_PREFERENCES`: `omp-agents.get-started-dismissed` and `omp-agents.get-started-step`, the step on screen.
There are no persisted completion flags; the rail's checks and each step's Next come from the live facts.

## Facts, not a controller

`src/shared/readiness.ts` holds `ReadinessFact<T>` (`known` or `unavailable`), `Readiness`'s local provider/config facts, and the installer's aggregate `StarterKitStatus`.
The component adds `checking` before a source answers.
A source's error takes precedence over its stale answer, so an unavailable check never appears done.
The wizard derives each step's done state from those facts, reusing `IntegrationList`, `IntegrationRow`, `Button`, `Badge`, `Callout`, `CopyableCode`, and `useAction`.
The provider step mounts `ProviderGroups` and `useProviders` from `web/components/settings/providers-tab.tsx`, the same list and sign-in polling as Settings, and refreshes `readinessStore` when its connected count changes.
The first-session step appends a suggested prompt to the new-session draft with `appendToComposer`, then opens it.

- `GET /api/readiness` runs `connectedProviders` and the native collab setting read independently, each retaining its own failure.
  It waits for neither GitHub nor kit status.
- `GET /api/readiness/github` reuses `githubStatus`, without consulting Graphite.
- `GET /api/readiness/starter-kit` calls `readStarterKitStatus` in `src/readiness.ts`.
  It reads native marketplace and user/project plugin registries through `src/omp/modules.ts`, takes known setting IDs from the loaded setting registry, and passes that snapshot to the installer's read-only `planStarterKit`.
  It never runs `omp config list`, whose `Settings.init` can migrate or write, nor a plugin command or installation.
  `keep` and `same` count as complete; every pending `create` or `update`, including settings, marketplace, and plugins, prevents completion.
- `PUT /api/readiness/terminal-sessions` takes `{ access }` of `view` or `control` and runs `shareTerminalSessions` in `src/omp/config.ts`.
  A read-only load refuses malformed config before an isolated native writer stages only `collab.autoStart` and flushes under omp's lock; a matching value writes nothing.
  The native global layer and descriptor default determine readiness, not a workspace or runtime override.
  Unrelated keys survive.

The page reuses the global socket `hosts`/`past` arrays: any row is positive evidence even before `listed`.
An empty array is negative only after listing, with a connected socket and no roster error; otherwise it is checking or unavailable.
Integrations reuse `integrationsStore` and `connectionsOf(...).some(signedIn)`, counting services rather than accounts.
The three onboarding HTTP stores stay in memory; local facts poll every five seconds and the optional facts every minute only while needed/visible.
The component refreshes on focus and on **Check again**; optional probes never gate the required rows.

## Desktop installation

The optional no-argument `DesktopBridge.installStarterKit` invokes `INSTALL_STARTER_KIT_CHANNEL`.
Main accepts it only from the dashboard window's main frame, with no arguments, and runs its fixed existing installer without `--force`.
The page receives `{ ok, message }` inline; the menu wraps the same operation in native dialogs.
An in-process promise shares an install already running; there is no cross-process lock or arbitrary-command bridge.
The desktop installer uses the server's working directory, so the native read-only project-registry lookup and the installer's CLI listing see the same project scope.
The installer uses `resolveOmp`'s exact command, including `OMP_PACKAGE_DIR`, for all CLI calls.
The packaged kit includes `agent/`, `config.yml`, and its bundled installer.

## Missing omp before the server exists

`src/omp/resolve.ts` resolves the installed package without a module-level lookup; `src/omp/install.ts` keeps the server's one resolved installation.
Only an absent/unresolved installation throws `OmpMissing` from `src/shared/startup.ts`.
Preflight maps that class alone to `OMP_MISSING_EXIT` (79).
Malformed manifests, permission failures, missing exports, runtime failures, and other startup errors keep the ordinary failure path and diagnostic output.
The desktop shell imports only the Node-safe startup contract, never the server or resolver.

A child exiting with 79 shows a shell-owned data page with `bun install -g @oh-my-pi/pi-coding-agent`, a fixed Copy action, Retry, and technical output in a disclosure.
It mentions Bun and links to bun.sh when Bun is absent from the shell's PATH.
No dashboard server, token, generic shell execution, or automatic installation is needed.
Retry reruns login-shell discovery but copies only `PATH`, `BUN_INSTALL`, and `OMP_PACKAGE_DIR` into the environment.
It never replaces initialized `HOME`, XDG paths, `PORT`, or the desktop's data locations.
Other startup failures keep the ordinary error notice.
