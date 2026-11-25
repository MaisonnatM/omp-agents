/** The Board module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. See docs/architecture/board.md. */
import { IconBubble2 } from "central-icons";
import { applyChange, type BoardChange, type BoardState } from "../../../templates/omp/agent/extensions/board/log";
import type { StoredPageModule } from "../../modules";
import { type BoardSearch, scopeOf } from "./search";

/** The Board page: Workspace `workspace`'s Board tasks, the first Workspace's for `null`, with Board task `thread`'s Board thread open beside them, `search`'s results in place of the Board tasks, and reply `reply` of the thread highlighted. */
export interface BoardRoute {
	workspace: string | null;
	thread: number | null;
	search: BoardSearch | null;
	reply: number | null;
}

export type BoardControlId =
	| "board.workspace"
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
	| "board.thread.search";

export const BOARD_PAGE: StoredPageModule<"board", BoardRoute, BoardState, BoardChange, never, BoardControlId> = {
	id: "board",
	tab: { label: "Board", icon: IconBubble2, place: 85 },
	about: "Board tasks you and your sessions post for each other in a workspace; a session starts on each one once it is ready.",
	offNote: "While the Board is off, sessions it starts or wakes keep running, and the board tool still works.",
	listsItself: true,
	home: { workspace: null, thread: null, search: null, reply: null },
	/** `#board` opens the first workspace's Board tasks, `#board/<n>?workspace=<cwd>` Board task n's thread in that workspace; `q` searches it, in the `in` scope, and `reply` highlights a reply of the thread. */
	address: {
		parse: (rest, query) => {
			const thread = rest !== null && /^\d+$/.test(rest) ? Number(rest) : null;
			const q = query.get("q")?.trim() ?? "";
			const reply = query.get("reply");
			return {
				workspace: query.get("workspace"),
				thread,
				search: q ? { query: q, scope: scopeOf(query.get("in"), thread) } : null,
				reply: thread !== null && reply !== null && /^\d+$/.test(reply) ? Number(reply) : null,
			};
		},
		rest: route => (route.thread === null ? null : String(route.thread)),
		query: route => {
			const params = new URLSearchParams();
			if (route.workspace !== null) params.set("workspace", route.workspace);
			if (route.search) {
				params.set("q", route.search.query);
				if (route.search.scope !== "workspace") params.set("in", route.search.scope);
			}
			if (route.reply !== null) params.set("reply", String(route.reply));
			return params.size === 0 ? null : params.toString();
		},
	},
	title: route => (route.search ? `Board · Search “${route.search.query}”` : route.thread === null ? "Board" : `Board · #${route.thread}`),
	views: [
		{ key: "board", label: "Board" },
		{ key: "board/thread", label: "A Board thread" },
		{ key: "board/search", label: "Board search results" },
	],
	view: route => (route.search ? "board/search" : route.thread === null ? "board" : "board/thread"),
	shortcuts: {
		category: "Board",
		goTo: { label: "Go to the Board", command: "Go to Board", keys: [] },
		rows: [],
	},
	controls: [
		{ id: "board.workspace", label: "Board sidebar workspace row", area: "Board" },
		{ id: "board.task.open", label: "Board task message, which opens its thread", area: "Board" },
		{ id: "board.post", label: "Board composer Send button or Enter", area: "Board" },
		{ id: "board.reply", label: "Board thread reply Send button or Enter", area: "Board" },
		{ id: "board.thread.close", label: "Board thread close button", area: "Board" },
		{ id: "board.thread.tab.thread", label: "Board thread Thread tab", area: "Board" },
		{ id: "board.thread.tab.session", label: "Board thread Session tab", area: "Board" },
		{ id: "board.session.open", label: "Board session link, in the sidebar or a thread", area: "Board" },
		{ id: "board.search", label: "Board search field, Enter to search", area: "Board" },
		{ id: "board.search.scope", label: "Board search scope menu: thread, workspace, or all workspaces", area: "Board" },
		{ id: "board.search.clear", label: "Board search results close button", area: "Board" },
		{ id: "board.search.result", label: "Board search result, which opens its message", area: "Board" },
		{ id: "board.search.all", label: "Board search Search all workspaces button, when nothing matched", area: "Board" },
		{ id: "board.thread.search", label: "Board thread Search in thread button", area: "Board" },
	],
	store: {
		apply(state, change) {
			const applied = applyChange(state, change, Date.now());
			return "ok" in applied ? applied.ok : null;
		},
	},
};
