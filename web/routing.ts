/** The URL hash: which page and which panes are open, and the pure changes to them. */
import { BarChart3, FileText, Folders, GitBranch, Plug, Route as RouteIcon, SlidersHorizontal } from "lucide-react";
import type { PullRequest } from "../src/shared/github";
import { type LiveView, type RosterHost, SESSION_HASH_PREFIX, type View } from "../src/shared/sessions";
import { TICKET_ID } from "../src/shared/tickets";
import type { StartOp } from "./starts";
import { PAGE_ICON } from "./page-icons";

export const SIDEBAR_TABS = [
	{ value: "pull-requests", label: "Pull requests", icon: PAGE_ICON["pull-requests"] },
	{ value: "tickets", label: "Tickets", icon: PAGE_ICON.tickets },
	{ value: "sessions", label: "Sessions", icon: PAGE_ICON.sessions },
	{ value: "todo", label: "Todo", icon: PAGE_ICON.todo },
	{ value: "calendar", label: "Calendar", icon: PAGE_ICON.calendar },
	{ value: "settings", label: "Settings", icon: PAGE_ICON.settings },
] as const;

/** The sidebar's tab; the tickets, todo, calendar, and settings tabs go with their pages, the sessions and pull requests tabs with the panes. */
export type SidebarTab = (typeof SIDEBAR_TABS)[number]["value"];

const PAST_PREFIX = "past/";

/**
 * The sidebar's pull request list, and the pull request the main content shows: its details, or with `files` its changes page open
 * on the file at `path`, `null` for the first. A `null` target keeps the panes.
 */
export type PullRequestsRoute = { target: null } | { target: PullRequest; files: { path: string | null } | null };

/** The tickets list, or the Linear issue whose details replace it when `target` is non-null. */
export interface TicketsRoute {
	/** The issue's identifier: `ENG-2368`. */
	target: string | null;
}

/**
 * The settings page's sections, in the sidebar's order. A `workspace` section shows omp's files and config as a session in
 * the chosen workspace loads them; a `general` section is the same whatever the workspace.
 */
export const SETTINGS_SECTIONS = [
	{ value: "analytics", label: "Analytics", icon: BarChart3, scope: "general" },
	{ value: "preferences", label: "Preferences", icon: SlidersHorizontal, scope: "general" },
	{ value: "integrations", label: "Integrations", icon: Plug, scope: "general" },
	{ value: "workspaces", label: "Workspaces", icon: Folders, scope: "general" },
	{ value: "models", label: "Models", icon: RouteIcon, scope: "workspace" },
	{ value: "files", label: "Files", icon: FileText, scope: "workspace" },
	{ value: "worktrees", label: "Worktrees", icon: GitBranch, scope: "workspace" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["value"];

const isSettingsSection = (segment: string): segment is SettingsSection => SETTINGS_SECTIONS.some(({ value }) => value === segment);

/** The open section of the settings page, and where it reads project files and config from; `null` for user-level only. */
export interface SettingsRoute {
	section: SettingsSection;
	cwd: string | null;
}

/** Which todos the Todo page lists: every one, one category's, due ones, those waiting on you, those agents added, or the archive. */
export type TodoListView = { kind: "all" } | { kind: "category"; id: string } | { kind: "today" } | { kind: "needs" } | { kind: "agents" } | { kind: "archive" };

/** The Todo page, listing `list`, with todo `open` beside it when it is non-null and in the list. */
export interface TodoRoute {
	list: TodoListView;
	open: string | null;
}

/** The Routines page: the list, or routine `target`'s settings and runs when it is non-null. */
export interface RoutinesRoute {
	target: string | null;
}

/** What the Projects page shows: every project, the New project form, or one project's coordinator, workers, updates, and notes. */
export type ProjectsTarget = { kind: "list" } | { kind: "new" } | { kind: "project"; id: string };

/** The Projects page, showing `target`. */
export interface ProjectsRoute {
	target: ProjectsTarget;
}

/** The directory a new session starts in, as typed or displayed (`~/code/webapp`); `null` for {@link defaultCwd}. `todoId` names the todo it works on. */
export interface NewSessionRoute {
	cwd: string | null;
	todoId: string | null;
}

/** The files session `sessionId` changed, and the one open, by the path the list gives it. */
export interface ChangesRoute {
	sessionId: string;
	path: string | null;
}

/** A page that covers the panes. */
export type Page =
	| ({ kind: "settings" } & SettingsRoute)
	| ({ kind: "pull-requests" } & PullRequestsRoute)
	| ({ kind: "tickets" } & TicketsRoute)
	| ({ kind: "todo" } & TodoRoute)
	| ({ kind: "routines" } & RoutinesRoute)
	| ({ kind: "projects" } & ProjectsRoute)
	| { kind: "calendar" }
	| ({ kind: "new" } & NewSessionRoute)
	| ({ kind: "changes" } & ChangesRoute);

/** What the hash names: a page over the panes, a session by its id, or the panes themselves. */
export type Route = { kind: "page"; page: Page } | { kind: "session"; sessionId: string } | { kind: "panes"; layout: Layout };

type PageOf<K extends Page["kind"]> = Extract<Page, { kind: K }>;

/**
 * A hash segment decoded, `null` for a malformed percent-escape (`%E0`, `%zz`), which a hand-edited or cut link may
 * hold; each parser reads `null` as naming nothing, so such a link opens what the hash names without it instead of throwing.
 */
function decodeSegment(raw: string): string | null {
	try {
		return decodeURIComponent(raw);
	} catch (error) {
		if (error instanceof URIError) return null;
		throw error;
	}
}

/** The settings page and the new-session draft both name an optional directory, encoded so it keeps its slashes and tilde. */
const decodeCwd = (rest: string | null): string | null => (rest === null ? null : decodeSegment(rest));
const encodeCwd = (cwd: string | null): string | null => (cwd === null ? null : encodeURIComponent(cwd));

/** The Todo page's lists that are not a category, by the hash segment that names them. Category ids are random, so none reads as one. */
const TODO_LISTS = { today: { kind: "today" }, needs: { kind: "needs" }, agents: { kind: "agents" }, archive: { kind: "archive" } } as const satisfies Record<string, TodoListView>;

/**
 * Each page by its kind, which is its hash's first segment, reading what follows the next `/` (`null` without one) and
 * what follows a `?` after it.
 * - `#settings/<section>` opens that section of the settings page, `#settings/<section>/<cwd>` with that workspace's
 *   project files and config. `#settings` and an unknown section open Analytics.
 * - `#new` opens the new-session draft, `#new/<cwd>` with that directory chosen, and `?todo=<id>` with that todo's
 *   title and notes as its first message. No omp runs until its first message.
 * - `#pull-requests` shows the sidebar's Pull requests tab, which lists the pull requests of the sidebar's workspace, beside the panes,
 *   and `#pull-requests/<owner>/<repo>/<number>` shows that pull request's details in the main content.
 *   `#pull-requests/<owner>/<repo>/<number>/files` opens its changes page on the first file, and `…/files/<path>` on the file
 *   at that encoded path. Any other `#pull-requests/…` shows the tab alone.
 * - `#tickets` opens the tickets page, which lists the viewer's assigned Linear issues, and `#tickets/<identifier>`
 *   opens that issue's details in the main content. Any other `#tickets/…` opens the list alone.
 * - `#todo` opens the Todo page with every todo, `#todo/today`, `#todo/needs`, `#todo/agents`, and `#todo/archive` with the todos due by
 *   today, waiting on you, added by agents, or in the archive; `#todo/<category id>` shows that category alone, and `?open=<id>` opens that todo.
 * - `#routines` opens the Routines page with every routine, and `#routines/<id>` with that routine's settings and runs.
 * - `#projects` opens the Projects page with every project, `#projects/new` with the New project form, and `#projects/<id>`
 *   with that project's coordinator, workers, and notes. Project ids are UUIDs, so none reads as `new`.
 * - `#calendar` opens the Calendar page, a month of routine runs, due todos, and due tickets.
 */
const PAGES: { [K in Page["kind"]]: (rest: string | null, query: URLSearchParams) => PageOf<K> } = {
	settings: rest => {
		const [section = "", cwd] = (rest ?? "").split("/");
		return { kind: "settings", section: isSettingsSection(section) ? section : "analytics", cwd: decodeCwd(cwd ?? null) };
	},
	new: (rest, query) => ({ kind: "new", cwd: decodeCwd(rest), todoId: query.get("todo") || null }),
	"pull-requests": rest => {
		const match = rest === null ? null : /^([\w.-]+)\/([\w.-]+)\/(\d+)(\/files(?:\/(.+))?)?$/.exec(rest);
		if (!match) return { kind: "pull-requests", target: null };
		const files = match[4] ? { path: match[5] ? decodeSegment(match[5]) : null } : null;
		return { kind: "pull-requests", target: { owner: match[1]!, repo: match[2]!, number: Number(match[3]) }, files };
	},
	tickets: rest => ({ kind: "tickets", target: rest !== null && TICKET_ID.test(rest) ? rest : null }),
	todo: (rest, query) => {
		const open = query.get("open") || null;
		if (!rest) return { kind: "todo", list: { kind: "all" }, open };
		const named = Object.hasOwn(TODO_LISTS, rest) ? TODO_LISTS[rest as keyof typeof TODO_LISTS] : null;
		const id = named ? null : decodeSegment(rest);
		return { kind: "todo", list: named ?? (id === null ? { kind: "all" } : { kind: "category", id }), open };
	},
	routines: rest => ({ kind: "routines", target: rest ? decodeSegment(rest) : null }),
	projects: rest => {
		const id = rest && rest !== "new" ? decodeSegment(rest) : null;
		return { kind: "projects", target: rest === "new" ? { kind: "new" } : id ? { kind: "project", id } : { kind: "list" } };
	},
	calendar: () => ({ kind: "calendar" }),
	changes: rest => {
		const [sessionId = "", path] = (rest ?? "").split("/");
		return { kind: "changes", sessionId: decodeSegment(sessionId) ?? "", path: path ? decodeSegment(path) : null };
	},
};

const isPageKind = (head: string): head is Page["kind"] => Object.hasOwn(PAGES, head);

/** What follows `#<kind>/` in `page`'s hash; `null` for the page alone. */
function restOfPage(page: Page): string | null {
	switch (page.kind) {
		case "settings":
			return `${page.section}${page.cwd === null ? "" : `/${encodeCwd(page.cwd)}`}`;
		case "new":
			return encodeCwd(page.cwd);
		case "pull-requests": {
			if (page.target === null) return null;
			const pr = `${page.target.owner}/${page.target.repo}/${page.target.number}`;
			if (page.files === null) return pr;
			return page.files.path === null ? `${pr}/files` : `${pr}/files/${encodeURIComponent(page.files.path)}`;
		}
		case "tickets":
			return page.target || null;
		case "todo":
			return page.list.kind === "all" ? null : page.list.kind === "category" ? encodeURIComponent(page.list.id) : page.list.kind;
		case "routines":
			return page.target === null ? null : encodeURIComponent(page.target);
		case "projects":
			return page.target.kind === "list" ? null : page.target.kind === "new" ? "new" : encodeURIComponent(page.target.id);
		case "calendar":
			return null;
		case "changes":
			return `${encodeURIComponent(page.sessionId)}${page.path === null ? "" : `/${encodeURIComponent(page.path)}`}`;
		default: {
			const never: never = page;
			return never;
		}
	}
}

/** The `?name=value` that follows `page`'s path: the todo a new session works on, or the todo the Todo page opens; `null` for none. */
function queryOfPage(page: Page): string | null {
	switch (page.kind) {
		case "new":
			return page.todoId === null ? null : `todo=${encodeURIComponent(page.todoId)}`;
		case "todo":
			return page.open === null ? null : `open=${encodeURIComponent(page.open)}`;
		case "settings":
		case "pull-requests":
		case "tickets":
		case "routines":
		case "projects":
		case "calendar":
		case "changes":
			return null;
		default: {
			const never: never = page;
			return never;
		}
	}
}

export function hashForPage(page: Page): string {
	const rest = restOfPage(page);
	const query = queryOfPage(page);
	return `#${page.kind}${rest === null ? "" : `/${rest}`}${query === null ? "" : `?${query}`}`;
}

export const hashForPullRequests = (target: PullRequest | null): string => hashForPage(target ? { kind: "pull-requests", target, files: null } : { kind: "pull-requests", target: null });
export const hashForPullRequestFiles = (pr: PullRequest, path: string | null = null): string => hashForPage({ kind: "pull-requests", target: pr, files: { path } });
export const hashForTickets = (target: string | null): string => hashForPage({ kind: "tickets", target });
export const hashForTodo = (list: TodoListView, open: string | null = null): string => hashForPage({ kind: "todo", list, open });
/** A todo opened in its category's list, else in every todo's; `categoryId` is its own, or its parent's for a todo under another. */
export const hashForOpenTodo = (id: string, categoryId: string | null): string => hashForTodo(categoryId === null ? { kind: "all" } : { kind: "category", id: categoryId }, id);
export const hashForRoutines = (target: string | null): string => hashForPage({ kind: "routines", target });
export const hashForProjects = (target: ProjectsTarget): string => hashForPage({ kind: "projects", target });
export const hashForCalendar = (): string => hashForPage({ kind: "calendar" });
export const hashForSettings = (section: SettingsSection, cwd: string | null): string => hashForPage({ kind: "settings", section, cwd });
export const hashForNewSession = (cwd: string | null, todoId: string | null = null): string => hashForPage({ kind: "new", cwd, todoId });
export const hashForChanges = (sessionId: string, path: string | null = null): string => hashForPage({ kind: "changes", sessionId, path });

/**
 * The route a hash names. A page's kind is its first segment. `#session/<id>` names a session by its id, which outlives
 * the host running it, for links from outside the page; it names no layout until the session lists show where that
 * session runs. Any other hash names the panes.
 */
export function routeFromHash(hash: string): Route {
	const full = hash.replace(/^#/, "");
	const mark = full.indexOf("?");
	const raw = mark < 0 ? full : full.slice(0, mark);
	const query = new URLSearchParams(mark < 0 ? "" : full.slice(mark + 1));
	const slash = raw.indexOf("/");
	const head = slash < 0 ? raw : raw.slice(0, slash);
	const rest = slash < 0 ? null : raw.slice(slash + 1);
	if (isPageKind(head)) return { kind: "page", page: PAGES[head](rest, query) };
	if (`${head}/` === SESSION_HASH_PREFIX && rest) {
		const sessionId = decodeSegment(rest);
		return sessionId === null ? { kind: "panes", layout: EMPTY_LAYOUT } : { kind: "session", sessionId };
	}
	return { kind: "panes", layout: layoutFromPanes(raw) };
}

/** The view a session id opens: the live host that runs the session, else its saved transcript. */
export function viewForSession(sessionId: string, hosts: RosterHost[]): View {
	const host = hosts.find(h => h.sessionId === sessionId);
	return host ? { kind: "live", instanceId: host.instanceId, agentId: null } : { kind: "past", sessionId };
}

/** Panes the page splits into at most, as a 2x2 grid. */
export const MAX_PANES = 4;

/** The views on screen in grid order, and the focused one that plain clicks, new sessions, and forks open into. */
export interface Layout {
	/** Distinct views, at most {@link MAX_PANES}. */
	panes: View[];
	/** Index into `panes`; 0 when there are none. */
	focus: number;
	/** The focused pane fills the page with the others kept behind it; only ever true with 2+ panes. */
	maximized: boolean;
}

export const EMPTY_LAYOUT: Layout = { panes: [], focus: 0, maximized: false };

export const focusedView = (layout: Layout): View | null => layout.panes[layout.focus] ?? null;

/** `<instanceId>` for a live session, `<instanceId>/<agentId>` for one of its subagents, `past/<sessionId>` for a past session. */
function paneForView(view: View): string {
	if (view.kind === "past") return `${PAST_PREFIX}${encodeURIComponent(view.sessionId)}`;
	const session = encodeURIComponent(view.instanceId);
	return view.agentId === null ? session : `${session}/${encodeURIComponent(view.agentId)}`;
}

/** Instance ids are hex, so none reads as `past`, `settings`, `pull-requests`, `tickets`, `todo`, `routines`, `projects`, `session`, or `new`. `null` for a pane whose ids do not decode. */
function viewFromPane(pane: string): View | null {
	if (pane.startsWith(PAST_PREFIX)) {
		const sessionId = decodeSegment(pane.slice(PAST_PREFIX.length));
		return sessionId === null ? null : { kind: "past", sessionId };
	}
	const slash = pane.indexOf("/");
	const instanceId = decodeSegment(slash < 0 ? pane : pane.slice(0, slash));
	const agentId = slash < 0 ? null : decodeSegment(pane.slice(slash + 1));
	if (instanceId === null || (slash >= 0 && agentId === null)) return null;
	return { kind: "live", instanceId, agentId };
}

export const hashForView = (view: View): string => `#${paneForView(view)}`;

export const sameView = (a: View | null, b: View | null): boolean => {
	if (a === null || b === null) return a === b;
	if (a.kind === "past") return b.kind === "past" && a.sessionId === b.sessionId;
	return b.kind === "live" && a.instanceId === b.instanceId && a.agentId === b.agentId;
};

const MAXIMIZED = ";max";

/**
 * `#<pane>` for one pane, so single-view links from before split screen still open; `#<pane>,<pane>…@<focus>`
 * for more, with `@<focus>` left out when the first pane has focus, then `;max` when the focused pane is maximized.
 * Encoded ids hold no `,`, `@`, or `;`.
 */
export function hashForLayout({ panes, focus, maximized }: Layout): string {
	if (panes.length === 0) return "";
	return `#${panes.map(paneForView).join(",")}${focus > 0 ? `@${focus}` : ""}${maximized ? MAXIMIZED : ""}`;
}

/** The layout a hash's panes name, keeping the first {@link MAX_PANES} distinct views and focus on the view it named. */
function layoutFromPanes(marked: string): Layout {
	const maximized = marked.endsWith(MAXIMIZED);
	const raw = maximized ? marked.slice(0, -MAXIMIZED.length) : marked;
	const at = raw.lastIndexOf("@");
	const named = (at < 0 ? raw : raw.slice(0, at))
		.split(",")
		.filter(Boolean)
		.map(viewFromPane)
		.filter(view => view !== null);
	const focused = named[at < 0 ? 0 : Number(raw.slice(at + 1))] ?? named[0];
	const panes = named.filter((view, index) => named.findIndex(other => sameView(other, view)) === index).slice(0, MAX_PANES);
	return {
		panes,
		focus: Math.max(0, panes.findIndex(view => sameView(view, focused ?? null))),
		maximized: maximized && panes.length > 1,
	};
}

export type OpenMode = "replace" | "split";

/**
 * `view` in the focused pane, or in a new pane for `split`. A view already open gets focus instead of a second pane;
 * a split with {@link MAX_PANES} open replaces the focused pane. A plain open keeps a maximized pane maximized,
 * now showing the opened view; a split brings the split back.
 */
export function openView(layout: Layout, view: View, mode: OpenMode): Layout {
	const { panes, focus } = layout;
	const maximized = layout.maximized && mode === "replace";
	const open = panes.findIndex(pane => sameView(pane, view));
	if (open >= 0) return { panes, focus: open, maximized };
	if (panes.length === 0) return { panes: [view], focus: 0, maximized: false };
	if (mode === "split" && panes.length < MAX_PANES) return { panes: [...panes, view], focus: panes.length, maximized: false };
	return { panes: panes.with(focus, view), focus, maximized };
}

/**
 * The layout without pane `index`. Focus stays on its view, or moves to the pane taking the closed one's place.
 * Closing the maximized pane, or leaving one pane, brings the split back.
 */
export function closePane({ panes, focus, maximized }: Layout, index: number): Layout {
	const rest = panes.filter((_, i) => i !== index);
	return {
		panes: rest,
		focus: index < focus ? focus - 1 : Math.max(0, Math.min(focus, rest.length - 1)),
		maximized: maximized && index !== focus && rest.length > 1,
	};
}

/** The pane showing `from` shows `to` instead and takes focus; without such a pane, `to` opens in the focused pane. */
export function swapView(layout: Layout, from: View, to: View): Layout {
	const index = layout.panes.findIndex(pane => sameView(pane, from));
	if (index < 0) return openView(layout, to, "replace");
	return { ...layout, panes: layout.panes.with(index, to), focus: index };
}

/**
 * The layout once start `op` answers with live session `instanceId`, `null` to leave it: a resumed session takes the
 * pane of the past session it continues, a new session, a fork, or a new project's coordinator opens in the focused pane, and a quick action's
 * session runs in the background.
 */
export function layoutAfterStart(layout: Layout, op: StartOp, instanceId: string): Layout | null {
	const live: LiveView = { kind: "live", instanceId, agentId: null };
	switch (op.kind) {
		case "resume":
			return swapView(layout, { kind: "past", sessionId: op.sessionId }, live);
		case "new":
		case "fork":
		case "project":
			return openView(layout, live, "replace");
		case "quick":
		case "resume-all":
			return null;
		default: {
			const never: never = op;
			return never;
		}
	}
}

/** The layout once **Resume all** `started` these sessions: each pane showing one as past shows it live. `null` when no pane changes. */
export function layoutAfterResumeAll(layout: Layout, started: { sessionId: string; instanceId: string }[]): Layout | null {
	const panes = layout.panes.map((view): View => {
		const resumed = view.kind === "past" && started.find(({ sessionId }) => sessionId === view.sessionId);
		return resumed ? { kind: "live", instanceId: resumed.instanceId, agentId: null } : view;
	});
	return panes.some((view, index) => view !== layout.panes[index]) ? { ...layout, panes } : null;
}

/**
 * The layout once live session `instanceId` ends. Each pane showing it, or one of its subagents, shows the next
 * session in `listed` (the sidebar's live sessions before ending, in order), else the previous, skipping sessions
 * already open or absent from `eligible`, the latest live sessions not currently ending. A pane left without one closes.
 */
export function endSession(layout: Layout, instanceId: string, listed: string[], eligible: ReadonlySet<string>): Layout {
	const at = listed.indexOf(instanceId);
	const neighbors = (at < 0 ? [] : [...listed.slice(at + 1), ...listed.slice(0, at).reverse()])
		.filter(id => eligible.has(id))
		.map((id): View => ({ kind: "live", instanceId: id, agentId: null }))
		.filter(view => !layout.panes.some(pane => sameView(pane, view)));
	const panes = layout.panes.map(pane => (pane.kind === "live" && pane.instanceId === instanceId ? (neighbors.shift() ?? pane) : pane));
	return panes.reduceRight((next, pane, index) => (pane.kind === "live" && pane.instanceId === instanceId ? closePane(next, index) : next), { ...layout, panes });
}

/**
 * The view `step` rows from the focused view's session in `listed` (the sidebar's sessions, in order), or `null` past
 * either end. A subagent stands for its session's row, and a view the sidebar does not list steps onto its first or last row.
 */
export function adjacentSession(listed: View[], current: View | null, step: 1 | -1): View | null {
	const row = current?.kind === "live" ? { ...current, agentId: null } : current;
	const at = listed.findIndex(view => sameView(view, row));
	if (at < 0) return (step > 0 ? listed[0] : listed.at(-1)) ?? null;
	return listed[at + step] ?? null;
}
