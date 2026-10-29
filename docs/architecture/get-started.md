# Get started

`web/components/get-started.tsx` owns the setup dialog: its welcome screen, the fixed five-step table, the step rail, Back, Next, and Skip, and the bottom-right bubble it closes into.
`web/components/get-started-steps.tsx` draws each step's body with its local pending and result state.
`web/app.tsx` mounts `GetStarted` once; the dialog is open at `#get-started`, under which `PageSwitch` draws the home or panes, and on its own over a vacant home until it is first closed.
Closing at `#get-started` returns to the panes; the dialog never opens on its own over a selected page, draft, or pane.
The provider count and any global live or past session suppress automatic onboarding and the bubble for an existing setup.
While those initial facts are unknown, neither the dialog nor the bubble appears, so a returning user sees no flash of onboarding.
Three keys are stored through `useStoredState`, deliberately absent from `PORTABLE_PREFERENCES`: `omp-agents.get-started-dismissed`, `omp-agents.get-started-minimized`, set when the dialog closes so a vacant home shows the bubble instead, and `omp-agents.get-started-step`, the step on screen.
There are no persisted completion flags; the rail's checks and each step's Next come from the live facts.

## Facts, not a controller

Every fact is an `Observation<T>` from `web/get-started-model.ts`: `known`, `unavailable` with why, or `checking` before its source answers.
Each polled store's entry becomes one through `observation()`, where a source's error takes precedence over its stale answer, so an unavailable check never appears done.
The wizard derives each step's done state from those facts, reusing `IntegrationList`, `IntegrationRow`, `MarkTile`, `Button`, `Badge`, `Callout`, `CopyableCode`, and `useAction`.
The provider step draws `ProviderGroups` from `web/components/settings/providers-tab.tsx`, the same list and sign-in as Settings.
Its connected count and the step's Done come from the same `providersStore` read and `providerConnected`, which `GetStarted` polls through `useProviders` while the dialog or bubble is due.
The first-session step appends a suggested prompt to the new-session draft with `appendToComposer`, then opens it.

- `GET /api/readiness/terminal-sessions` answers omp's global `collab.autoStart`, `off`, `view`, or `control`, through `readCollabAutoStart` in `src/omp/config.ts`.
- `PUT /api/readiness/terminal-sessions` takes `{ access }` of `view` or `control`, runs `shareTerminalSessions` in `src/omp/config.ts`, and answers the value it reads back.
  A read-only load refuses malformed config before an isolated native writer stages only `collab.autoStart` and flushes under omp's lock; a matching value writes nothing.
  The native global layer and descriptor default determine the answer, not a workspace or runtime override.
  Unrelated keys survive.
- `GET /api/readiness/starter-kit` calls `readStarterKitStatus` in `src/readiness.ts`.
  It reads native marketplace and user/project plugin registries through `src/omp/modules.ts`, takes known setting IDs from the loaded setting registry, and passes that snapshot to the installer's read-only `planStarterKit`.
  It never runs `omp config list`, whose `Settings.init` can migrate or write, nor a plugin command or installation.
  `keep` and `same` count as complete; every pending `create` or `update`, including settings, marketplace, and plugins, prevents completion.
- GitHub comes from `GET /api/source-control`, the answer Settings' Source control tab reads, through `sourceControlStore`; Graphite's status in it is ignored.

`firstSessionFact` in `web/get-started-model.ts` reads the global socket `hosts`/`past` arrays: any row is positive evidence even before `listed`.
An empty array is negative only after listing, with a connected socket and no roster error; otherwise it is checking or unavailable.
Integrations reuse `integrationsStore` and `connectionsOf(...).some(signedIn)`, counting services rather than accounts.
The onboarding stores stay in memory: the providers poll every minute while the dialog or bubble is due, the terminal setting every five seconds while the dialog is open, and the starter kit, source control, and integrations every minute while it is open.
The component refreshes on focus and on **Check again**; optional probes never gate the required rows.

Closed, the dialog's bubble draws through `UnderToasts` from `web/components/toaster.tsx` into the toast column's corner, below the toasts and outside their live region, so a toast stacks above it rather than covering it.

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
In the packaged app, Retry reruns login-shell discovery but copies only `PATH`, `BUN_INSTALL`, and `OMP_PACKAGE_DIR` into the environment; a checkout keeps the environment it was launched with.
It never replaces initialized `HOME`, XDG paths, `PORT`, or the desktop's data locations.
Other startup failures keep the ordinary error notice.
