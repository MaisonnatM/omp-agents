/**
 * The modules the page is built with, and what a module gives the page: a feature beside the core, such as Sport, which
 * the page's hubs reach only through this list. The server's half is `src/modules.ts`, and each module's page and list
 * components are in `web/components/module-views.tsx`; see docs/architecture/modules.md.
 * The hubs read this list as they load, so this file and every definition it lists import no hub but for types.
 */
import type { IconComponent } from "@/lib/icon-context";
import type { ModuleChanges, ModuleValues, StoredModuleId } from "../src/modules";
import type { McpIntegrationId } from "../src/shared/accounts";
import { CALENDAR_PAGE } from "./components/calendar/module";
import { SPORT_PAGE } from "./components/sport/module";
import type { Binding } from "./shortcuts";

/** How a module's page reads and writes its address, `#<id>/<rest>?<query>`. */
export interface PageAddress<Route> {
	/** The route the address names; `rest` is `null` for `#<id>` alone, and anything it does not know names the module's home. */
	parse(rest: string | null, query: URLSearchParams): Route;
	/** What follows `#<id>/`, `null` for nothing. */
	rest(route: Route): string | null;
	/** What follows the `?`, `null` for nothing. */
	query(route: Route): string | null;
}

/** A key of a view Settings › Activity counts: the module's id, or one under it. */
export type ModuleViewKey<Id extends string> = Id | `${Id}/${string}`;

/** A module's state change as the page shows it before the server answers. */
export interface PageStore<Value, Change> {
	/** `value` with `change` applied; `null` when the state refuses it, which then shows none of it. */
	apply(value: Value, change: Change): Value | null;
}

export interface PageModule<Id extends string, Route, Shortcut extends string = never, Control extends string = never> {
	readonly id: Id;
	/**
	 * The module's sidebar tab, whose id is the module's. `place` orders it among every tab, the core's too, lowest first.
	 * A tab with an `integration` shows, and its shortcut applies, only while omp holds a sign-in to that service.
	 */
	readonly tab: { label: string; icon: IconComponent; place: number; integration?: McpIntegrationId };
	/** The route the tab opens. */
	readonly home: Route;
	readonly address: PageAddress<Route>;
	/** What the window and a header tab call the page. */
	title(route: Route): string;
	/** The views Settings › Activity counts, in its order, and the one each route shows. */
	readonly views: readonly { key: ModuleViewKey<Id>; label: string }[];
	view(route: Route): ModuleViewKey<Id>;
	readonly shortcuts: {
		/** What Settings › Keyboard calls the category that lists `rows`. */
		category: string;
		/** The shortcut that goes to the tab, whose id is the module's; the command palette lists it as `command`. */
		goTo: { label: string; command: string; keys: readonly Binding[] };
		rows: readonly { id: Shortcut; label: string; keys: readonly Binding[] }[];
	};
	/** The controls only the page sees, as `CONTROLS` in `src/shared/activity.ts` lists the core's. */
	readonly controls: readonly { id: Control; label: string; area: string }[];
}

/** A module whose state the server keeps, `ModuleValues[Id]` changed by `ModuleChanges[Id]`. */
export type StoredPageModule<Id extends string, Route, Value, Change, Shortcut extends string = never, Control extends string = never> = PageModule<Id, Route, Shortcut, Control> & {
	readonly store: PageStore<Value, Change>;
};

/** Every module, in the order the hubs list them: adding one is adding its definition here and its server half to `SERVER_MODULES` in `src/modules.ts`. */
export const WEB_MODULES = { calendar: CALENDAR_PAGE, sport: SPORT_PAGE };

type WebModules = typeof WEB_MODULES;
export type WebModuleId = keyof WebModules;
WEB_MODULES satisfies { readonly [I in WebModuleId]: { readonly id: I } };

/** Each module's route, by id: what its page shows besides its kind. */
export type ModuleRoutes = { [I in WebModuleId]: WebModules[I]["home"] };
/** A module's page: its id as the page's kind, and its route. */
export type ModulePage<I extends WebModuleId = WebModuleId> = I extends WebModuleId ? { kind: I } & ModuleRoutes[I] : never;
/** The modules' shortcuts: each one's go-to shortcut, under its id, and its rows. */
export type ModuleShortcutId = { [I in WebModuleId]: I | WebModules[I]["shortcuts"]["rows"][number]["id"] }[WebModuleId];
export type ModuleControlId = { [I in WebModuleId]: WebModules[I]["controls"][number]["id"] }[WebModuleId];
export type ModuleView = { [I in WebModuleId]: WebModules[I]["views"][number]["key"] }[WebModuleId];

/** The page's copy of each stored module's state, `null` until the server first sends it. */
export type ModuleStates = { [I in StoredModuleId]: ModuleValues[I] | null };

const STORES: { readonly [I in StoredModuleId]: { readonly store: PageStore<ModuleValues[I], ModuleChanges[I]> } } = WEB_MODULES;

/** A module with its route erased, which a hub reads without knowing which module it holds; its methods still take only that module's routes. */
type AnyPageModule = PageModule<WebModuleId, unknown, ModuleShortcutId, ModuleControlId>;
const BY_ID: { readonly [I in WebModuleId]: AnyPageModule } = WEB_MODULES;

/** Every module, in {@link WEB_MODULES} order. */
export const MODULE_LIST: readonly AnyPageModule[] = Object.values(BY_ID);

export const isWebModuleId = (id: string): id is WebModuleId => Object.hasOwn(WEB_MODULES, id);

export const isModulePage = (page: { kind: string }): page is ModulePage => isWebModuleId(page.kind);

/** Module `page.kind`'s definition, whose methods take `page` as their route, since a page's kind names the module whose route it holds. */
export const moduleOf = (page: ModulePage): AnyPageModule => BY_ID[page.kind];

/** Module `id`'s page at the address `#<id>/<rest>?<query>`; TypeScript cannot pair `id` with its module's route, so the result is asserted. */
export const modulePage = (id: WebModuleId, rest: string | null, query: URLSearchParams): ModulePage => ({ kind: id, ...WEB_MODULES[id].address.parse(rest, query) }) as ModulePage;

/** Module `id`'s page as its tab opens it. */
export const moduleHome = (id: WebModuleId): ModulePage => ({ kind: id, ...WEB_MODULES[id].home }) as ModulePage;

/** No stored module's state, as the page holds before the server sends any. */
export const EMPTY_MODULE_STATES = Object.fromEntries(Object.values(WEB_MODULES).flatMap(module => ("store" in module ? [[module.id, null]] : []))) as ModuleStates;

/** `states` with `change` applied to module `id`'s, as the page shows it before the server answers; the same `states` while that state has not arrived or refuses the change. */
export function changeModuleState<I extends StoredModuleId>(states: ModuleStates, id: I, change: ModuleChanges[I]): ModuleStates {
	const value = states[id];
	const next = value === null ? null : STORES[id].store.apply(value, change);
	return next === null ? states : { ...states, [id]: next };
}
