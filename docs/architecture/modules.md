# Modules

A module is a feature the core runs without naming it, such as Sport.
Its whole wiring sits behind two definitions, one for the server and one for the page.
The core lists the modules in two registries and iterates them, so no hub file names a module.

## The module list

- Server: `SERVER_MODULES` in `src/modules.ts`.
- Page: `WEB_MODULES` in `web/modules.ts`, with each module's components in `MODULE_VIEWS` in `web/components/module-views.tsx`.

| Module | Server definition | Page definition | Page components |
| --- | --- | --- | --- |
| Calendar | none | `CALENDAR_PAGE` in `web/components/calendar/module.ts` | `CalendarPage` and `CalendarNav` |
| Sport | `SPORT_MODULE` in `src/sport-module.ts` | `SPORT_PAGE` in `web/components/sport/module.ts` | `SportPage` and `SportNav` |
| Email | none | `EMAIL_PAGE` in `web/components/email/module.ts` | `EmailPage` and `EmailNav` |

A module without a server definition keeps its server side in the core.
Calendar's routes, its Google and local event stores, and its calendar choices stay in `Dashboard`, because the bell's event notices, routine event triggers, and settings sync share those same instances.
Email's Gmail routes and accounts stay there too, because routine mail triggers read the same `GmailAccounts`.

The list is fixed when the code is built.
There is no runtime plugin loading and no dynamic import.
Mapped types over the list give every hub its exact ids, routes, states, and changes.

## The server half

A `ServerModule` has an `id` and four optional parts.

- `store`: a `ModuleStore`, the state kept in one file.
  `open()` reads the file into a `ModuleFile`, `parse` checks a change a page sent, and `inbox` drains the changes an agent's tool leaves in a directory.
- `join`: what every session the dashboard starts joins with, such as the omp extension that gives it the module's tool.
- `routes`: the module's own `/api/*` routes, built from the core's `RouteKit`.
- `shipped`: the files `scripts/build-desktop-artifact.ts` bundles into a packaged app.

The core reads these through `openModules`, `parseModuleChange`, `moduleInboxes`, `MODULE_JOINS`, `moduleRoutes`, and `SHIPPED_FILES`.
`ListRegistry` sends each stored module's state as `{ t: "module", id, value }` on the roster topic, after the core's lists.
A page changes it with `{ t: "module-change", id, change }`, which `src/server/wire.ts` checks through the module's `parse`.
Settings › Activity counts every such change as action `module-change`.

## The page half

A `PageModule` describes the module's page.

- `tab`: the sidebar tab's label, icon, and `place`, which orders it among the core's tabs.
  A tab with an `integration` shows only while omp holds a sign-in to that service.
- `home`: the route the tab opens.
- `address`: how `#<id>/<rest>?<query>` reads into a route and back.
- `title`: what the window and a header tab call the page.
- `views` and `view`: the views Settings › Activity counts, keyed under the module's id.
- `shortcuts`: the Settings › Keyboard category, the go-to shortcut whose id is the module's, and the module's own rows.
- `controls`: the page-only controls Settings › Activity counts.
- `split`: the page splits its list from its open item, so the page column leaves it room for both.
- `api`: the path prefix of the module's `PUT` routes, which Settings › Activity sets apart with a gated tab.

A `StoredPageModule` adds `store.apply`, which shows a change at once and returns `null` when the state refuses it.
The page keeps each stored module's state in `DashboardState.modules`, `null` until the server first sends it.

The page half is split in three files so that the pure registry never imports React components.
`web/modules.ts` holds the contract and the list, the module's `module.ts` holds its definition, and `web/components/module-views.tsx` maps each id to its `Page` and `Nav` components.

Every module's `Page` takes its `route` and `core`, a `CoreData` that `PageSwitch` builds from the core's own state.
`CoreData` holds the routines, the Bots, the todo list, and whether tickets show, so a module reads core data without importing the core's stores.
A stored module's `Page` also takes its `state`, `disabled`, and `onChange`.

## Adding a module

1. Write the server definition beside the module's code and add it to `SERVER_MODULES`.
2. Write the page definition in the module's components folder and add it to `WEB_MODULES`.
3. Add the module's `Page` and `Nav` to `MODULE_VIEWS`.
4. Add a row to the table above.

Removing a module is removing those entries and the module's files.
A module's saved data, addresses, localStorage keys, and control ids keep its id, so they never move when the module does.
