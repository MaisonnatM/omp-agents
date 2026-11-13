/**
 * Each module's page and its list in the sidebar's page column, beside its definition in `WEB_MODULES` (`web/modules.ts`),
 * which this file keeps apart because the components import the hubs that read that list.
 */
import type { ComponentType } from "react";
import type { ModuleChanges, ModuleValues, StoredModuleId } from "../../src/modules";
import type { ModulePage, ModuleRoutes, ModuleStates, WebModuleId } from "../modules";
import { useDashboardActions } from "./dashboard-context";
import { SportNav } from "./sport/nav";
import { SportPage } from "./sport/page";

/** A stored module's page: its route, and its state, `null` until the server first sends it, which `onChange` changes; `disabled` while the socket is down. */
interface StoredPageProps<Route, Value, Change> {
	route: Route;
	state: Value | null;
	disabled: boolean;
	onChange: (change: Change) => Promise<void>;
}

interface ModuleViews<I extends WebModuleId> {
	Page: ComponentType<I extends StoredModuleId ? StoredPageProps<ModuleRoutes[I], ModuleValues[I], ModuleChanges[I]> : { route: ModuleRoutes[I] }>;
	/** The module's list in the page column, for the route its page shows. */
	Nav: ComponentType<{ route: ModuleRoutes[I] }>;
}

const MODULE_VIEWS: { readonly [I in WebModuleId]: ModuleViews<I> } = {
	sport: { Page: SportPage, Nav: SportNav },
};

/** Module `page.kind`'s page, given the stored modules' states. */
export function ModulePageView({ page, states, disabled }: { page: ModulePage; states: ModuleStates; disabled: boolean }) {
	const { changeModule } = useDashboardActions();
	const { Page } = MODULE_VIEWS[page.kind];
	return <Page route={page} state={states[page.kind]} disabled={disabled} onChange={change => changeModule(page.kind, change)} />;
}

/** Module `page.kind`'s list in the page column. */
export function ModuleNavView({ page }: { page: ModulePage }) {
	const { Nav } = MODULE_VIEWS[page.kind];
	return <Nav route={page} />;
}
