/** The Board module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. See docs/architecture/board.md. */
import { IconArrowsRepeat, IconBrain, IconBubble2, IconBubbleText, IconFlag1, IconLayersTwo, IconPullRequest, IconSettingsGear1 } from "central-icons";
import { applyChange, type BoardChange, type BoardState } from "../../../templates/omp/agent/extensions/board/log";
import { decodeSegment } from "../../hash-segment";
import type { PageAddresses, StoredPageModule } from "../../modules";
import type { Page } from "../../routing";
import { type BoardSearch, scopeOf } from "./search";

/** The tabs across the top of a Workspace's Board, as across a Slack channel: its Board tasks, then what else the Workspace holds; `module` names the module whose page a tab shows, which hides the tab while it is off. */
export const BOARD_TABS = [
	{ id: "messages", label: "Messages", icon: IconBubbleText, module: null },
	{ id: "sessions", label: "Sessions", icon: IconLayersTwo, module: null },
	{ id: "pull-requests", label: "Pull requests", icon: IconPullRequest, module: null },
	{ id: "projects", label: "Projects", icon: IconFlag1, module: "projects" },
	{ id: "routines", label: "Routines", icon: IconArrowsRepeat, module: null },
	{ id: "memory", label: "Memory", icon: IconBrain, module: "memory" },
	{ id: "settings", label: "Settings", icon: IconSettingsGear1, module: null },
] as const;

export type BoardTab = (typeof BOARD_TABS)[number]["id"];
export type BoardTabDef = (typeof BOARD_TABS)[number];

/** The tabs that show another page, a project's or a pull request's, kept to the Workspace: each tab's id is that page's kind. */
type PageTab = "pull-requests" | "projects";
type PageView<K extends PageTab = PageTab> = K extends PageTab ? { tab: K; page: Extract<Page, { kind: K }> } : never;

/** What the Routines tab shows: the card of the Workspace's routines, that card with one routine open, a new routine's editor, or a routine's editor. */
export type RoutineRoute = { kind: "list" } | { kind: "new" } | { kind: "open"; id: string } | { kind: "edit"; id: string };

/**
 * What a Workspace's Board shows: its Board tasks with Board task `thread`'s Board thread open beside them, its settings on the section `section` names, the first for `null`,
 * its memory, its routines as `routine` names, or the page `page` another tab shows, such as one pull request's.
 * `threads` is no Workspace's: Slack's Threads view, every Workspace's Board threads with replies, Board task `thread`'s open beside them.
 */
export type BoardView = { tab: "messages"; thread: number | null } | { tab: "threads"; thread: number | null } | { tab: "sessions"; session: string | null } | { tab: "settings"; section: string | null } | { tab: "memory" } | { tab: "routines"; routine: RoutineRoute } | PageView;

/** The Board page: Workspace `workspace`'s view, the first Workspace's for `null`; on Messages, `search`'s results in place of the Board tasks, reply `reply` of the open thread highlighted, and session `session`'s tabs in the open thread, the one a reply wakes for `null`. */
export interface BoardRoute {
	workspace: string | null;
	view: BoardView;
	search: BoardSearch | null;
	reply: number | null;
	session: string | null;
}

export const boardTab = (id: BoardTab) => BOARD_TABS.find(each => each.id === id)!;

/** The Workspace tab that shows `page`, `null` for a page no tab shows. */
export function pageView(page: Page): PageView | null {
	switch (page.kind) {
		case "pull-requests":
			return { tab: "pull-requests", page };
		case "projects":
			return { tab: "projects", page };
		default:
			return null;
	}
}

/** Tab `tab` as it opens: Messages with no thread, the first settings section, the card of routines, or the list its page starts on. */
export function tabView(tab: BoardTab): BoardView {
	switch (tab) {
		case "messages":
			return { tab, thread: null };
		case "settings":
			return { tab, section: null };
		case "sessions":
			return { tab, session: null };
		case "memory":
			return { tab };
		case "routines":
			return { tab, routine: { kind: "list" } };
		case "pull-requests":
			return { tab, page: { kind: "pull-requests", target: null } };
		case "projects":
			return { tab, page: { kind: "projects", open: null } };
	}
}

/** What `routines/<more>` names: `new` a new routine's editor, `<id>` that routine open, `<id>/edit` its editor, the card alone without `<more>` or with a malformed one. */
function routineRoute(more: readonly string[]): RoutineRoute {
	const [first, second] = more.map(decodeSegment);
	if (!first || second === null) return { kind: "list" };
	if (first === "new" && second === undefined) return { kind: "new" };
	return second === "edit" ? { kind: "edit", id: first } : { kind: "open", id: first };
}

function routineRest(routine: RoutineRoute): string {
	switch (routine.kind) {
		case "list":
			return "routines";
		case "new":
			return "routines/new";
		case "open":
			return `routines/${encodeURIComponent(routine.id)}`;
		case "edit":
			return `routines/${encodeURIComponent(routine.id)}/edit`;
	}
}

/** The view the address's rest names: a number is a Board thread, `threads` the Threads view and `threads/<n>` it with Board thread n open, `settings/<section>` a settings section, `sessions/<id>` the Sessions tab with that session open, `routines/<more>` the Routines tab, `<tab>/<more>` the page `#<tab>/<more>` names in that tab, Messages for an unknown one. */
function parseView(rest: string | null, pages: PageAddresses): BoardView {
	if (rest !== null && /^\d+$/.test(rest)) return { tab: "messages", thread: Number(rest) };
	const [head, ...more] = rest?.split("/") ?? [];
	if (head === "threads") return { tab: "threads", thread: more[0] && /^\d+$/.test(more[0]) ? Number(more[0]) : null };
	const tab = BOARD_TABS.find(each => each.id === head)?.id ?? "messages";
	if (tab === "messages") return { tab, thread: null };
	if (tab === "settings") return { tab, section: more[0] || null };
	if (tab === "memory") return { tab };
	if (tab === "sessions") return { tab, session: more[0] ? decodeSegment(more[0]) : null };
	if (tab === "routines") return { tab, routine: routineRoute(more) };
	const page = pages.page(`#${rest}`);
	return (page && pageView(page)) || tabView(tab);
}

function viewRest(view: BoardView, pages: PageAddresses): string | null {
	switch (view.tab) {
		case "messages":
			return view.thread === null ? null : String(view.thread);
		case "threads":
			return view.thread === null ? "threads" : `threads/${view.thread}`;
		case "settings":
			return view.section === null ? "settings" : `settings/${view.section}`;
		case "sessions":
			return view.session === null ? view.tab : `${view.tab}/${encodeURIComponent(view.session)}`;
		case "memory":
			return view.tab;
		case "routines":
			return routineRest(view.routine);
		default:
			return pages.hash(view.page).slice(1);
	}
}

export type BoardControlId =
	| "board.workspace"
	| "board.threads"
	| "board.tab"
	| "board.task.open"
	| "board.post"
	| "board.reply"
	| "board.thread.close"
	| "board.thread.tab.thread"
	| "board.thread.tab.session"
	| "board.session.open"
	| "board.task.close"
	| "board.search"
	| "board.search.scope"
	| "board.search.clear"
	| "board.search.result"
	| "board.search.all"
	| "board.thread.search"
	| "board.message.edit"
	| "board.message.unread"
	| "board.message.expand"
	| "board.unread.jump"
	| "board.unread.read-all"
	| "board.thread.new-replies"
	| "board.quick-link"
	| "board.quick-link.add";

export const BOARD_PAGE: StoredPageModule<"board", BoardRoute, BoardState, BoardChange, never, BoardControlId> = {
	id: "board",
	tab: { label: "Board", icon: IconBubble2, place: 85 },
	about: "Board tasks you, your sessions, and your routines post for each other in a workspace; a session starts on each one once it is ready.",
	offNote: "While the Board is off, sessions it starts or wakes keep running, and the board tool still works.",
	listsItself: true,
	home: { workspace: null, view: { tab: "messages", thread: null }, search: null, reply: null, session: null },
	/**
	 * `#board` opens the first workspace's Board tasks, `#board/<n>?workspace=<cwd>` Board task n's thread in that workspace, `#board/threads` the Threads view of every Workspace's
	 * Board threads, `#board/threads/<n>` it with Board task n's thread open, `#board/<tab>?workspace=<cwd>` another tab,
	 * `#board/settings/<section>?workspace=<cwd>` one of its settings, `#board/routines/<id>?workspace=<cwd>` one of its routines open (`/edit` its editor, `routines/new` a new
	 * one's), and `#board/<page>?workspace=<cwd>`, for `#<page>` a project's or pull request's address, that page in the tab its kind names; on Messages, `q` searches in the
	 * `in` scope, `reply` highlights a reply of the thread, and `session` shows that session's tabs in it.
	 */
	address: {
		parse: (rest, query, pages) => {
			const view = parseView(rest, pages);
			const thread = view.tab === "messages" || view.tab === "threads" ? view.thread : null;
			const q = view.tab === "messages" ? (query.get("q")?.trim() ?? "") : "";
			const reply = query.get("reply");
			return {
				workspace: query.get("workspace"),
				view,
				search: q ? { query: q, scope: scopeOf(query.get("in"), thread) } : null,
				reply: thread !== null && reply !== null && /^\d+$/.test(reply) ? Number(reply) : null,
				session: thread !== null ? query.get("session") || null : null,
			};
		},
		rest: (route, pages) => viewRest(route.view, pages),
		query: route => {
			const params = new URLSearchParams();
			if (route.workspace !== null) params.set("workspace", route.workspace);
			if (route.search) {
				params.set("q", route.search.query);
				if (route.search.scope !== "workspace") params.set("in", route.search.scope);
			}
			if (route.reply !== null) params.set("reply", String(route.reply));
			if (route.session !== null) params.set("session", route.session);
			return params.size === 0 ? null : params.toString();
		},
	},
	title: ({ view, search }) => (view.tab === "threads" ? (view.thread === null ? "Board · Threads" : `Board · Threads · #${view.thread}`) : view.tab !== "messages" ? `Board · ${boardTab(view.tab).label}` : search ? `Board · Search “${search.query}”` : view.thread === null ? "Board" : `Board · #${view.thread}`),
	views: [
		{ key: "board", label: "Board" },
		{ key: "board/thread", label: "A Board thread" },
		{ key: "board/search", label: "Board search results" },
		{ key: "board/threads", label: "The Board's Threads view" },
		...BOARD_TABS.filter(each => each.id !== "messages").map(each => ({ key: `board/${each.id}` as const, label: `The Board's ${each.label} tab` })),
	],
	view: ({ view, search }) => (view.tab !== "messages" ? `board/${view.tab}` : search ? "board/search" : view.thread === null ? "board" : "board/thread"),
	shortcuts: {
		category: "Board",
		goTo: { label: "Go to the Board", command: "Go to Board", keys: [] },
		rows: [],
	},
	controls: [
		{ id: "board.tab", label: "Board tab across the top of a Workspace", area: "Board" },
		{ id: "board.quick-link", label: "Board quick link under a Workspace's tabs", area: "Board" },
		{ id: "board.quick-link.add", label: "Board Add a quick link button", area: "Board" },
		{ id: "board.workspace", label: "Board sidebar workspace row", area: "Board" },
		{ id: "board.threads", label: "Board sidebar Threads row, which lists every Board thread with replies", area: "Board" },
		{ id: "board.task.open", label: "Board task message, which opens its thread", area: "Board" },
		{ id: "board.post", label: "Board composer Send button or Enter", area: "Board" },
		{ id: "board.reply", label: "Board thread reply Send button or Enter", area: "Board" },
		{ id: "board.thread.close", label: "Board thread close button", area: "Board" },
		{ id: "board.thread.tab.thread", label: "Board thread Thread tab", area: "Board" },
		{ id: "board.thread.tab.session", label: "Board thread Session tab", area: "Board" },
		{ id: "board.session.open", label: "Board session link in a thread", area: "Board" },
		{ id: "board.task.close", label: "Board task Close task button, which marks an open Board task done and ends its session", area: "Board" },
		{ id: "board.search", label: "Board search field", area: "Board" },
		{ id: "board.search.scope", label: "Board search scope menu", area: "Board" },
		{ id: "board.search.clear", label: "Board search close button", area: "Board" },
		{ id: "board.search.result", label: "Board search result, which opens its thread", area: "Board" },
		{ id: "board.search.all", label: "Board search all workspaces button", area: "Board" },
		{ id: "board.thread.search", label: "Board thread search button", area: "Board" },
		{ id: "board.message.edit", label: "Board message Edit button, which edits your message and resends it to its session", area: "Board" },
		{ id: "board.message.unread", label: "Board thread reply Mark unread button, which marks the thread unread from that reply and closes it", area: "Board" },
		{ id: "board.message.expand", label: "Board routine message Show more button, which shows the whole message in place", area: "Board" },
		{ id: "board.unread.jump", label: "Board unread threads pill, which scrolls to the nearest unread thread out of view", area: "Board" },
		{ id: "board.unread.read-all", label: "Board unread threads pill Mark all read button, which marks every thread in the Workspace read", area: "Board" },
		{ id: "board.thread.new-replies", label: "Board thread new replies pill, which scrolls to the replies that came while you read further up", area: "Board" },
	],
	store: {
		apply(state, change) {
			const applied = applyChange(state, change, Date.now());
			return "ok" in applied ? applied.ok : null;
		},
	},
};
