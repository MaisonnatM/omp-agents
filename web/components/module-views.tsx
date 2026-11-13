/**
 * Each module's page and its list in the sidebar's page column, beside its definition in `WEB_MODULES` (`web/modules.ts`),
 * which this file keeps apart because the components import the hubs that read that list.
 */
import type { ComponentType } from "react";
import type { ModuleChanges, ModuleValues, StoredModuleId } from "../../src/modules";
import type { Routine } from "../../src/routines";
import type { Bot } from "../../src/shared/bots";
import type { UserTodoList } from "../../src/user-todos-shared";
import type { ModulePage, ModuleRoutes, ModuleStates, WebModuleId } from "../modules";
import { CalendarNav } from "./calendar/calendar-nav";
import { CalendarPage } from "./calendar/calendar-page";
import { useDashboardActions } from "./dashboard-context";
import { SportNav } from "./sport/nav";
import { SportPage } from "./sport/page";

/** The core's data a module's page reads but does not own. */
export interface CoreData {
	/** Every Bot's routines. */
	routines: Routine[];
	/** The Bots, `null` until they load. */
	bots: Bot[] | null;
	/** The todo list, `null` until the server sends it. */
	todos: UserTodoList | null;
	/** Linear answers and the sidebar shows Tickets, so a page may show tickets. */
	ticketsShown: boolean;
}

/** A stored module's page: its state, `null` until the server first sends it, which `onChange` changes; `disabled` while the socket is down. */
interface StoredPageProps<Value, Change> {
	state: Value | null;
	disabled: boolean;
	onChange: (change: Change) => Promise<void>;
}

type PageProps<I extends WebModuleId> = { route: ModuleRoutes[I]; core: CoreData } & (I extends StoredModuleId ? StoredPageProps<ModuleValues[I], ModuleChanges[I]> : unknown);

interface ModuleViews<I extends WebModuleId> {
	Page: ComponentType<PageProps<I>>;
	/** The module's list in the page column, for the route its page shows. */
	Nav: ComponentType<{ route: ModuleRoutes[I] }>;
}

const MODULE_VIEWS: { readonly [I in WebModuleId]: ModuleViews<I> } = {
	calendar: { Page: CalendarPage, Nav: CalendarNav },
	sport: { Page: SportPage, Nav: SportNav },
};

/** Module `page.kind`'s page, given the stored modules' states and the core's data. */
export function ModulePageView({ page, states, disabled, core }: { page: ModulePage; states: ModuleStates; disabled: boolean; core: CoreData }) {
	const { changeModule } = useDashboardActions();
	const { Page } = MODULE_VIEWS[page.kind] as ModuleViews<WebModuleId>;
	const stored = page.kind in states ? { state: states[page.kind as StoredModuleId], disabled, onChange: (change: ModuleChanges[StoredModuleId]) => changeModule(page.kind as StoredModuleId, change) } : {};
	return <Page route={page} core={core} {...stored} />;
}

/** Module `page.kind`'s list in the page column. */
export function ModuleNavView({ page }: { page: ModulePage }) {
	const { Nav } = MODULE_VIEWS[page.kind] as ModuleViews<WebModuleId>;
	return <Nav route={page} />;
}
