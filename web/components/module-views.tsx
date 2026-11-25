/**
 * Each module's page and its list in the sidebar's page column, beside its definition in `WEB_MODULES` (`web/modules.ts`),
 * which this file keeps apart because the components import the hubs that read that list.
 */
import type { ComponentType } from "react";
import type { ModuleChanges, ModuleValues, StoredModuleId } from "../../src/modules";
import type { Routine } from "../../src/routines";
import type { Bot, BotId, BotLast } from "../../src/shared/bots";
import type { ProjectList } from "../../src/shared/projects";
import type { RosterHost } from "../../src/shared/sessions";
import type { Workspace } from "../../src/shared/workspaces";
import type { UserTodoList } from "../../src/user-todos-shared";
import type { ModulePage, ModuleRoutes, ModuleStates, WebModuleId } from "../modules";
import type { Completions } from "../pane-store";
import type { ModelList } from "../reads";
import type { SectionTarget } from "../section";
import { BoardPage } from "./board/page";
import { useDashboardActions } from "./dashboard-context";
import { MemoryPage } from "./memory/page";
import { ProjectsPage } from "./projects/page";
import { SportNav } from "./sport/nav";
import { SportPage } from "./sport/page";
import type { KnownSessions } from "./todo/links";

/** The core's data a module's page reads but does not own. */
export interface CoreData {
	/** Every Bot's routines. */
	routines: Routine[];
	/** The Bots, `null` until they load. */
	bots: Bot[] | null;
	/** Each Bot's last message, which a Board's Bots tab shows on its cards. */
	botLasts: Readonly<Record<BotId, BotLast | null>>;
	/** The projects, `null` until the server first sends them, which a Board's Projects tab lists. */
	projects: ProjectList | null;
	/** The todo list, `null` until the server sends it. */
	todos: UserTodoList | null;
	/** The sessions are listed, so `workspaces` holds every workspace the sidebar offers. */
	listed: boolean;
	/** The workspace the sidebar picked, as Settings' workspace sections read it; `null` for all workspaces. */
	workspace: string | null;
	/** The workspaces the sidebar offers. */
	workspaces: Workspace[];
	/** Picks the sidebar's workspace, `null` for all workspaces, as Settings' workspace picker does. */
	onPickWorkspace: (cwd: string | null) => void;
	/** The running sessions in the sidebar's workspace. */
	hosts: RosterHost[];
	/** Each live session's model list, which a Board thread's **Session** tab's composer offers. */
	models: ReadonlyMap<string, ModelList>;
	/** Every live and past session, in any workspace, which a project's page names and links. */
	sessions: KnownSessions;
	/** The page section a sidebar link last chose, to unfold, scroll to, and focus. */
	section: SectionTarget | null;
	/** The server's last answer to the new-session draft's `complete`, which the Board's composer shares. */
	newSessionCompletions: Completions | null;
}

/** A module's list in the page column: the route its page shows, and the page section a link there last chose, which `onSection` sets. */
interface NavProps<Route> {
	route: Route;
	section: SectionTarget | null;
	onSection: (section: SectionTarget) => void;
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
	/** The module's list in the page column, for the route its page shows; none for a module whose page `listsItself`. */
	Nav?: ComponentType<NavProps<ModuleRoutes[I]>>;
}

const MODULE_VIEWS: { readonly [I in WebModuleId]: ModuleViews<I> } = {
	memory: { Page: MemoryPage },
	sport: { Page: SportPage, Nav: SportNav },
	projects: { Page: ProjectsPage },
	board: { Page: BoardPage },
};

/** Any module's page as {@link ModulePageView} draws it: a stored module's gets its state, any other's none. */
type AnyPageProps = { route: ModulePage; core: CoreData } & Partial<StoredPageProps<ModuleValues[StoredModuleId], ModuleChanges[StoredModuleId]>>;

/** Module `page.kind`'s page, given the stored modules' states and the core's data. */
export function ModulePageView({ page, states, disabled, core }: { page: ModulePage; states: ModuleStates; disabled: boolean; core: CoreData }) {
	const { changeModule } = useDashboardActions();
	const Page = MODULE_VIEWS[page.kind].Page as ComponentType<AnyPageProps>;
	const stored = page.kind in states ? { state: states[page.kind as StoredModuleId], disabled, onChange: (change: ModuleChanges[StoredModuleId]) => changeModule(page.kind as StoredModuleId, change) } : {};
	return <Page route={page} core={core} {...stored} />;
}

/** Module `page.kind`'s list in the page column, if it has one. */
export function ModuleNavView({ page, section, onSection }: { page: ModulePage } & Omit<NavProps<unknown>, "route">) {
	const { Nav } = MODULE_VIEWS[page.kind] as ModuleViews<WebModuleId>;
	return Nav ? <Nav route={page} section={section} onSection={onSection} /> : null;
}
