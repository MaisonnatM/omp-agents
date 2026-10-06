/** The URL hash: which page and which panes are open, and the pure changes to them. */
import type { PullRequest } from "../src/shared/github";
import { type LiveView, type RosterHost, SESSION_HASH_PREFIX, type View } from "../src/shared/sessions";
import { TICKET_ID } from "../src/shared/tickets";
import type { StartOp } from "./starts";
import { PAGE_ICON } from "./page-icons";

export const SIDEBAR_TABS = [
	{ value: "inbox", label: "Inbox", icon: PAGE_ICON.inbox },
	{ value: "tickets", label: "Tickets", icon: PAGE_ICON.tickets },
	{ value: "sessions", label: "Sessions", icon: PAGE_ICON.sessions },
	{ value: "todo", label: "Todo", icon: PAGE_ICON.todo },
	{ value: "calendar", label: "Calendar", icon: PAGE_ICON.calendar },
	{ value: "settings", label: "Settings", icon: PAGE_ICON.settings },
] as const;

/** The sidebar's tab; the tickets, todo, calendar, and settings tabs go with their pages, the sessions and inbox tabs with the panes. */
export type SidebarTab = (typeof SIDEBAR_TABS)[number]["value"];

const PAST_PREFIX = "past/";

/** The sidebar's inbox, and the pull request whose details the main content shows; `null` keeps the panes. */
export interface InboxRoute {
	target: PullRequest | null;
}

/** The tickets list, or the Linear issue whose details replace it when `target` is non-null. */
export interface TicketsRoute {
	/** The issue's identifier: `ENG-2368`. */
	target: string | null;
}

/** Where the settings page reads project files and config from; `null` for user-level only. */
export interface SettingsRoute {
	cwd: string | null;
}

/** Which todos the Todo page lists: every one, one category's, due ones, those waiting on you, those agents added, or the archive. */
export type TodoListView = { kind: "all" } | { kind: "category"; id: string } | { kind: "today" } | { kind: "needs" } | { kind: "agents" } | { kind: "done" };

/** The Todo page, listing `list`. */
export interface TodoRoute {
	list: TodoListView;
}

/** The Routines page: the list, or routine `target`'s settings and runs when it is non-null. */
export interface RoutinesRoute {
	target: string | null;
}

/** The directory a new session starts in, as typed or displayed (`~/code/webapp`); `null` for {@link defaultCwd}. `todoId` names the todo it works on. */
export interface NewSessionRoute {
	cwd: string | null;
	todoId: string | null;
}

/** A page that covers the panes. */
export type Page =
	| ({ kind: "settings" } & SettingsRoute)
	| ({ kind: "inbox" } & InboxRoute)
	| ({ kind: "tickets" } & TicketsRoute)
	| ({ kind: "todo" } & TodoRoute)
	| ({ kind: "routines" } & RoutinesRoute)
	| { kind: "calendar" }
	| ({ kind: "new" } & NewSessionRoute);

/** What the hash names: a page over the panes, a session by its id, or the panes themselves. */
export type Route = { kind: "page"; page: Page } | { kind: "session"; sessionId: string } | { kind: "panes"; layout: Layout };

type PageOf<K extends Page["kind"]> = Extract<Page, { kind: K }>;

/** The settings page and the new-session draft both name an optional directory, encoded so it keeps its slashes and tilde. */
const decodeCwd = (rest: string | null): string | null => (rest === null ? null : decodeURIComponent(rest));
const encodeCwd = (cwd: string | null): string | null => (cwd === null ? null : encodeURIComponent(cwd));

/** The Todo page's lists that are not a category, by the hash segment that names them. Category ids are random, so none reads as one. */
const TODO_LISTS = { today: { kind: "today" }, needs: { kind: "needs" }, agents: { kind: "agents" }, done: { kind: "done" } } as const satisfies Record<string, TodoListView>;

/**
 * Each page by its kind, which is its hash's first segment, reading what follows the next `/` (`null` without one) and
 * what follows a `?` after it.
 * - `#settings` opens the settings page, `#settings/<cwd>` with that workspace's project files and config.
 * - `#new` opens the new-session draft, `#new/<cwd>` with that directory chosen, and `?todo=<id>` with that todo's
 *   title and notes as its first message. No omp runs until its first message.
 * - `#inbox` shows the sidebar's Inbox tab, which lists the pull requests of the sidebar's project, beside the panes,
 *   and `#inbox/<owner>/<repo>/<number>` shows that pull request's details in the main content. Any other `#inbox/…`
 *   shows the tab alone.
 * - `#tickets` opens the tickets page, which lists the viewer's assigned Linear issues, and `#tickets/<identifier>`
 *   opens that issue's details in the main content. Any other `#tickets/…` opens the list alone.
 * - `#todo` opens the Todo page with every todo, `#todo/today`, `#todo/needs`, `#todo/agents`, and `#todo/done` with the todos due by
 *   today, waiting on you, added by agents, or in the archive; `#todo/<category id>` shows that category alone.
 * - `#routines` opens the Routines page with every routine, and `#routines/<id>` with that routine's settings and runs.
 * - `#calendar` opens the Calendar page, a month of routine runs, due todos, and due tickets.
 */
const PAGES: { [K in Page["kind"]]: (rest: string | null, query: URLSearchParams) => PageOf<K> } = {
	settings: rest => ({ kind: "settings", cwd: decodeCwd(rest) }),
	new: (rest, query) => ({ kind: "new", cwd: decodeCwd(rest), todoId: query.get("todo") || null }),
	inbox: rest => {
		const match = rest === null ? null : /^([\w.-]+)\/([\w.-]+)\/(\d+)$/.exec(rest);
		return { kind: "inbox", target: match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : null };
	},
	tickets: rest => ({ kind: "tickets", target: rest !== null && TICKET_ID.test(rest) ? rest : null }),
	todo: rest => {
		if (!rest) return { kind: "todo", list: { kind: "all" } };
		const named = Object.hasOwn(TODO_LISTS, rest) ? TODO_LISTS[rest as keyof typeof TODO_LISTS] : null;
		return { kind: "todo", list: named ?? { kind: "category", id: decodeURIComponent(rest) } };
	},
	routines: rest => ({ kind: "routines", target: rest ? decodeURIComponent(rest) : null }),
	calendar: () => ({ kind: "calendar" }),
};

const isPageKind = (head: string): head is Page["kind"] => Object.hasOwn(PAGES, head);

/** What follows `#<kind>/` in `page`'s hash; `null` for the page alone. */
function restOfPage(page: Page): string | null {
	switch (page.kind) {
		case "settings":
		case "new":
			return encodeCwd(page.cwd);
		case "inbox":
			return page.target && `${page.target.owner}/${page.target.repo}/${page.target.number}`;
		case "tickets":
			return page.target || null;
		case "todo":
			return page.list.kind === "all" ? null : page.list.kind === "category" ? encodeURIComponent(page.list.id) : page.list.kind;
		case "routines":
			return page.target === null ? null : encodeURIComponent(page.target);
		case "calendar":
			return null;
		default: {
			const never: never = page;
			return never;
		}
	}
}

export function hashForPage(page: Page): string {
	const rest = restOfPage(page);
	const query = page.kind === "new" && page.todoId !== null ? `?todo=${encodeURIComponent(page.todoId)}` : "";
	return `#${page.kind}${rest === null ? "" : `/${rest}`}${query}`;
}

export const hashForInbox = (target: PullRequest | null): string => hashForPage({ kind: "inbox", target });
export const hashForTickets = (target: string | null): string => hashForPage({ kind: "tickets", target });
export const hashForTodo = (list: TodoListView): string => hashForPage({ kind: "todo", list });
export const hashForRoutines = (target: string | null): string => hashForPage({ kind: "routines", target });
export const hashForCalendar = (): string => hashForPage({ kind: "calendar" });
export const hashForSettings = (cwd: string | null): string => hashForPage({ kind: "settings", cwd });
export const hashForNewSession = (cwd: string | null, todoId: string | null = null): string => hashForPage({ kind: "new", cwd, todoId });

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
	if (`${head}/` === SESSION_HASH_PREFIX && rest) return { kind: "session", sessionId: decodeURIComponent(rest) };
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

/** Instance ids are hex, so none reads as `past`, `settings`, `inbox`, `tickets`, `todo`, `routines`, `session`, or `new`. */
function viewFromPane(pane: string): View {
	if (pane.startsWith(PAST_PREFIX)) return { kind: "past", sessionId: decodeURIComponent(pane.slice(PAST_PREFIX.length)) };
	const slash = pane.indexOf("/");
	if (slash < 0) return { kind: "live", instanceId: decodeURIComponent(pane), agentId: null };
	return {
		kind: "live",
		instanceId: decodeURIComponent(pane.slice(0, slash)),
		agentId: decodeURIComponent(pane.slice(slash + 1)),
	};
}

export const hashForView = (view: View): string => `#${paneForView(view)}`;

export const sameView = (a: View | null, b: View | null): boolean =>
	(a && paneForView(a)) === (b && paneForView(b));

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
	const named = (at < 0 ? raw : raw.slice(0, at)).split(",").filter(Boolean).map(viewFromPane);
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
 * pane of the past session it continues, a new session or a fork opens in the focused pane, and a quick action's
 * session runs in the background.
 */
export function layoutAfterStart(layout: Layout, op: StartOp, instanceId: string): Layout | null {
	const live: LiveView = { kind: "live", instanceId, agentId: null };
	switch (op.kind) {
		case "resume":
			return swapView(layout, { kind: "past", sessionId: op.sessionId }, live);
		case "new":
		case "fork":
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
 * session in `listed` (the sidebar's live sessions, in order), else the previous, skipping sessions already open.
 * A pane left without one keeps the ended session.
 */
export function endSession(layout: Layout, instanceId: string, listed: string[]): Layout {
	const at = listed.indexOf(instanceId);
	if (at < 0) return layout;
	const neighbors = [...listed.slice(at + 1), ...listed.slice(0, at).reverse()]
		.map((id): View => ({ kind: "live", instanceId: id, agentId: null }))
		.filter(view => !layout.panes.some(pane => sameView(pane, view)));
	const panes = layout.panes.map(pane => (pane.kind === "live" && pane.instanceId === instanceId ? (neighbors.shift() ?? pane) : pane));
	return { ...layout, panes };
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
