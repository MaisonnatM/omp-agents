/**
 * The modules the dashboard is built with, and what a module gives the server: a feature beside the core, such as Sport,
 * which the core reaches only through this list. The page's half is `web/modules.ts`; see docs/architecture/modules.md.
 */
import type { InboxOptions, JsonInboxDir } from "./server/json-inbox";
import type { RouteKit, Routes } from "./server/route-kit";
import type { SessionJoin } from "./server/start";
import { SPORT_MODULE } from "./sport-module";

/** A module's state as the server holds it, read from its file once; the server is the file's one writer. */
export interface ModuleFile<Value, Change> {
	readonly value: Value;
	/** Applies `change` and saves; `false` when it changed nothing, and a throw when the state refuses it. */
	apply(change: Change): boolean;
	/** Whether what `apply` saved reached the disk. */
	flush(): boolean;
}

/** State a module keeps in a file: every page holds it whole, and changes it through `{ t: "module-change" }`. */
export interface ModuleStore<Value, Change> {
	open(): ModuleFile<Value, Change>;
	/** The change a page sent, or `null` when it is none of this module's. */
	parse(change: unknown): Change | null;
	/** The directory an agent's tool leaves its changes in, which the server drains into the state through `apply`. */
	inbox?(state: () => Value, apply: (change: Change) => boolean, options: InboxOptions): JsonInboxDir<Change>;
}

/** A file a module ships beside the server's code: `source` in a checkout, and in a packaged app the bundle `bundle`. */
export interface ShippedFile {
	source: string;
	bundle: string;
}

export interface ServerModule<Id extends string = string> {
	readonly id: Id;
	readonly store?: ModuleStore<unknown, unknown>;
	/** What every session the dashboard starts joins with, such as the omp extension that gives it the module's tool. */
	readonly join?: SessionJoin;
	/** The module's own `/api/*` routes. */
	routes?(kit: RouteKit): Routes;
	/** The files `scripts/build-desktop-artifact.ts` bundles into a packaged app for the module. */
	readonly shipped?: readonly ShippedFile[];
}

/** A module that keeps state, with the types of its state and of a change to it. */
export type StoredModule<Id extends string, Value, Change> = Omit<ServerModule<Id>, "store"> & { readonly store: ModuleStore<Value, Change> };

/** Every module, by id: adding one is adding its definition here and its page's to `WEB_MODULES` in `web/modules.ts`. */
export const SERVER_MODULES = { sport: SPORT_MODULE };
SERVER_MODULES satisfies { readonly [I in ModuleId]: ServerModule<I> };

type Modules = typeof SERVER_MODULES;
export type ModuleId = keyof Modules;
type StoredModules = { [I in ModuleId as Modules[I] extends { store: object } ? I : never]: Modules[I] };
export type StoredModuleId = keyof StoredModules;
type StoreTypes<Store> = Store extends ModuleStore<infer Value, infer Change> ? { value: Value; change: Change } : never;
/** Each stored module's state, by id. */
export type ModuleValues = { [I in StoredModuleId]: StoreTypes<StoredModules[I]["store"]>["value"] };
/** What a page sends to change each stored module's state, by id. */
export type ModuleChanges = { [I in StoredModuleId]: StoreTypes<StoredModules[I]["store"]>["change"] };
/** Each stored module's open file, by id. */
export type ModuleFiles = { [I in StoredModuleId]: ModuleFile<ModuleValues[I], ModuleChanges[I]> };

/** The stored modules typed by id, so the store a lookup finds takes the change of the module the id names. */
const STORED_MODULES: { readonly [I in StoredModuleId]: { readonly store: ModuleStore<ModuleValues[I], ModuleChanges[I]> } } = SERVER_MODULES;
const STORED_IDS: readonly StoredModuleId[] = Object.values(SERVER_MODULES).flatMap(module => ("store" in module ? [module.id] : []));

export const isStoredModuleId = (id: unknown): id is StoredModuleId => STORED_IDS.some(stored => stored === id);

/** Every stored module's file, read once. */
export function openModules(): ModuleFiles {
	return Object.fromEntries(STORED_IDS.map(id => [id, STORED_MODULES[id].store.open()])) as ModuleFiles;
}

/** The change a page sent to stored module `id`, or `null` when that module would not take it. */
export function parseModuleChange<I extends StoredModuleId>(id: I, change: unknown): ModuleChanges[I] | null {
	return STORED_MODULES[id].store.parse(change);
}

/** The inboxes of the modules that take changes from agents; `apply` applies one to module `id`'s state and says whether it reached the disk. */
export function moduleInboxes(files: ModuleFiles, apply: <I extends StoredModuleId>(id: I, change: ModuleChanges[I]) => boolean, options: InboxOptions): JsonInboxDir<unknown>[] {
	const inboxOf = <I extends StoredModuleId>(id: I): JsonInboxDir<unknown> | undefined => STORED_MODULES[id].store.inbox?.(() => files[id].value, change => apply(id, change), options);
	return STORED_IDS.flatMap(id => inboxOf(id) ?? []);
}

/** What every session joins with for the modules. */
export const MODULE_JOINS: readonly SessionJoin[] = Object.values(SERVER_MODULES).flatMap(module => module.join ?? []);

/** Every module's `/api/*` routes. */
export const moduleRoutes = (kit: RouteKit): Routes => Object.assign({}, ...Object.values(SERVER_MODULES).map(module => module.routes?.(kit) ?? {}));

/** The files a packaged app bundles for the modules. */
export const SHIPPED_FILES: readonly ShippedFile[] = Object.values(SERVER_MODULES).flatMap(module => module.shipped ?? []);
