/** The Board module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. See docs/architecture/board.md. */
import { IconBrain, IconBubble2, IconBubbleText, IconFlag1, IconPullRequest, IconRobot, IconSettingsGear1 } from "central-icons";
import { applyChange, type BoardChange, type BoardState } from "../../../templates/omp/agent/extensions/board/log";
import type { StoredPageModule } from "../../modules";
import { type BoardSearch, scopeOf } from "./search";

/** The tabs across the top of a Workspace's Board, as across a Slack channel: its Board tasks, then what else the Workspace holds; `module` names the module whose page a tab shows, which hides the tab while it is off. */
export const BOARD_TABS = [
	{ id: "messages", label: "Messages", icon: IconBubbleText, module: null },
	{ id: "bots", label: "Bots", icon: IconRobot, module: null },
	{ id: "pull-requests", label: "Pull requests", icon: IconPullRequest, module: null },
	{ id: "memory", label: "Memory", icon: IconBrain, module: "memory" },
	{ id: "projects", label: "Projects", icon: IconFlag1, module: "projects" },
	{ id: "settings", label: "Settings", icon: IconSettingsGear1, module: null },
] as const;

export type BoardTab = (typeof BOARD_TABS)[number]["id"];
export type BoardTabDef = (typeof BOARD_TABS)[number];

/** What a Workspace's Board shows: its Board tasks with Board task `thread`'s Board thread open beside them, its settings on the section `section` names, the first for `null`, or another tab. */
export type BoardView = { tab: "messages"; thread: number | null } | { tab: "settings"; section: string | null } | { tab: Exclude<BoardTab, "messages" | "settings"> };

/** The Board page: Workspace `workspace`'s view, the first Workspace's for `null`; on Messages, `search`'s results in place of the Board tasks, and reply `reply` of the open thread highlighted. With `bots`, the Bots group's page instead: every Bot, whatever its Workspace. */
export interface BoardRoute {
	workspace: string | null;
	view: BoardView;
	search: BoardSearch | null;
	reply: number | null;
	bots: boolean;
}

export const boardTab = (id: BoardTab) => BOARD_TABS.find(each => each.id === id)!;

/** The view the address's rest names: a number is a Board thread, `settings/<section>` a settings section, else a tab, Messages for an unknown one. */
function parseView(rest: string | null): BoardView {
	if (rest !== null && /^\d+$/.test(rest)) return { tab: "messages", thread: Number(rest) };
	const [head, section = null] = rest?.split("/") ?? [];
	const tab = BOARD_TABS.find(each => each.id === head)?.id ?? "messages";
	if (tab === "messages") return { tab, thread: null };
	if (tab === "settings") return { tab, section: section || null };
	return { tab };
}

function viewRest(view: BoardView): string | null {
	switch (view.tab) {
		case "messages":
			return view.thread === null ? null : String(view.thread);
		case "settings":
			return view.section === null ? "settings" : `settings/${view.section}`;
		default:
			return view.tab;
	}
}

export type BoardControlId =
	| "board.workspace"
	| "board.bots"
	| "board.task.open"
	| "board.post"
	| "board.reply"
	| "board.thread.close"
	| "board.thread.tab.thread"
	| "board.thread.tab.session"
	| "board.session.open"
	| "board.search"
	| "board.search.scope"
	| "board.search.clear"
	| "board.search.result"
	| "board.search.all"
	| "board.thread.search"
	| "board.thread.suggestion";

export const BOARD_PAGE: StoredPageModule<"board", BoardRoute, BoardState, BoardChange, never, BoardControlId> = {
	id: "board",
	tab: { label: "Board", icon: IconBubble2, place: 85 },
	about: "Board tasks you and your sessions post for each other in a workspace; a session starts on each one once it is ready.",
	offNote: "While the Board is off, sessions it starts or wakes keep running, and the board tool still works.",
	listsItself: true,
	home: { workspace: null, view: { tab: "messages", thread: null }, search: null, reply: null, bots: false },
	/** `#board` opens the first workspace's Board tasks, `#board/<n>?workspace=<cwd>` Board task n's thread in that workspace, `#board/<tab>?workspace=<cwd>` another tab, and `#board/settings/<section>?workspace=<cwd>` one of its settings; on Messages, `q` searches in the `in` scope and `reply` highlights a reply of the thread. `#board?space=bots` opens the Bots group's page, every Bot. */
	address: {
		parse: (rest, query) => {
			if (query.get("space") === "bots") return { workspace: null, view: { tab: "messages", thread: null }, search: null, reply: null, bots: true };
			const view = parseView(rest);
			const thread = view.tab === "messages" ? view.thread : null;
			const q = view.tab === "messages" ? (query.get("q")?.trim() ?? "") : "";
			const reply = query.get("reply");
			return {
				workspace: query.get("workspace"),
				view,
				search: q ? { query: q, scope: scopeOf(query.get("in"), thread) } : null,
				reply: thread !== null && reply !== null && /^\d+$/.test(reply) ? Number(reply) : null,
				bots: false,
			};
		},
		rest: route => (route.bots ? null : viewRest(route.view)),
		query: route => {
			const params = new URLSearchParams();
			if (route.bots) params.set("space", "bots");
			if (route.workspace !== null) params.set("workspace", route.workspace);
			if (route.search) {
				params.set("q", route.search.query);
				if (route.search.scope !== "workspace") params.set("in", route.search.scope);
			}
			if (route.reply !== null) params.set("reply", String(route.reply));
			return params.size === 0 ? null : params.toString();
		},
	},
	title: ({ view, search, bots }) => (bots ? "Board · Bots" : view.tab !== "messages" ? `Board · ${boardTab(view.tab).label}` : search ? `Board · Search “${search.query}”` : view.thread === null ? "Board" : `Board · #${view.thread}`),
	views: [
		{ key: "board", label: "Board" },
		{ key: "board/thread", label: "A Board thread" },
		{ key: "board/search", label: "Board search results" },
		{ key: "board/all-bots", label: "The Board's Bots group page, every Bot" },
		...BOARD_TABS.filter(each => each.id !== "messages").map(each => ({ key: `board/${each.id}` as const, label: `The Board's ${each.label} tab` })),
	],
	view: ({ view, search, bots }) => (bots ? "board/all-bots" : view.tab !== "messages" ? `board/${view.tab}` : search ? "board/search" : view.thread === null ? "board" : "board/thread"),
	shortcuts: {
		category: "Board",
		goTo: { label: "Go to the Board", command: "Go to Board", keys: [] },
		rows: [],
	},
	controls: [
		{ id: "board.workspace", label: "Board sidebar workspace row", area: "Board" },
		{ id: "board.bots", label: "Board sidebar Bot group row", area: "Board" },
		{ id: "board.task.open", label: "Board task message, which opens its thread", area: "Board" },
		{ id: "board.post", label: "Board composer Send button or Enter", area: "Board" },
		{ id: "board.reply", label: "Board thread reply Send button or Enter", area: "Board" },
		{ id: "board.thread.close", label: "Board thread close button", area: "Board" },
		{ id: "board.thread.tab.thread", label: "Board thread Thread tab", area: "Board" },
		{ id: "board.thread.tab.session", label: "Board thread Session tab", area: "Board" },
		{ id: "board.session.open", label: "Board session link, in the sidebar or a thread", area: "Board" },
		{ id: "board.search", label: "Board search field", area: "Board" },
		{ id: "board.search.scope", label: "Board search scope menu", area: "Board" },
		{ id: "board.search.clear", label: "Board search close button", area: "Board" },
		{ id: "board.search.result", label: "Board search result, which opens its thread", area: "Board" },
		{ id: "board.search.all", label: "Board search all workspaces button", area: "Board" },
		{ id: "board.thread.search", label: "Board thread search button", area: "Board" },
		{ id: "board.thread.suggestion", label: "Board thread suggested next step, which replies with it", area: "Board" },
	],
	store: {
		apply(state, change) {
			const applied = applyChange(state, change, Date.now());
			return "ok" in applied ? applied.ok : null;
		},
	},
};
