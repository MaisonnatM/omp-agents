/** The Board module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. See docs/architecture/board.md. */
import { IconBubble2 } from "central-icons";
import { applyChange, type BoardChange, type BoardState } from "../../../templates/omp/agent/extensions/board/log";
import type { StoredPageModule } from "../../modules";

/** The tabs across the top of a Workspace's Board, as across a Slack channel: its Board tasks, then what else the Workspace holds. */
export const BOARD_TABS = [
	{ id: "messages", label: "Messages" },
	{ id: "bots", label: "Bots" },
	{ id: "pull-requests", label: "Pull requests" },
	{ id: "memory", label: "Memory" },
	{ id: "projects", label: "Projects" },
	{ id: "settings", label: "Settings" },
] as const;

export type BoardTab = (typeof BOARD_TABS)[number]["id"];

/** The Board page: Workspace `workspace`'s tab `tab`, the first Workspace's for `null`; on Messages, Board task `thread`'s Board thread open beside them. */
export interface BoardRoute {
	workspace: string | null;
	tab: BoardTab;
	thread: number | null;
}

export type BoardControlId = "board.workspace" | "board.tab" | "board.task.open" | "board.post" | "board.reply" | "board.thread.close" | "board.session.open";

export const BOARD_PAGE: StoredPageModule<"board", BoardRoute, BoardState, BoardChange, never, BoardControlId> = {
	id: "board",
	tab: { label: "Board", icon: IconBubble2, place: 85 },
	about: "Board tasks you and your sessions post for each other in a workspace; a session starts on each one once it is ready.",
	offNote: "While the Board is off, sessions it starts or wakes keep running, and the board tool still works.",
	listsItself: true,
	home: { workspace: null, tab: "messages", thread: null },
	/** `#board` opens the first workspace's Board tasks, `#board/<n>?workspace=<cwd>` Board task n's thread in that workspace, `#board/<tab>?workspace=<cwd>` another tab. */
	address: {
		parse: (rest, query) => {
			const thread = rest !== null && /^\d+$/.test(rest) ? Number(rest) : null;
			const tab = BOARD_TABS.find(each => each.id === rest)?.id ?? "messages";
			return { workspace: query.get("workspace"), tab, thread };
		},
		rest: route => (route.thread !== null ? String(route.thread) : route.tab === "messages" ? null : route.tab),
		query: route => (route.workspace === null ? null : new URLSearchParams({ workspace: route.workspace }).toString()),
	},
	title: route => (route.thread !== null ? `Board · #${route.thread}` : route.tab === "messages" ? "Board" : `Board · ${BOARD_TABS.find(each => each.id === route.tab)!.label}`),
	views: [
		{ key: "board", label: "Board" },
		{ key: "board/thread", label: "A Board thread" },
		{ key: "board/bots", label: "The Board's Bots tab" },
		{ key: "board/pull-requests", label: "The Board's Pull requests tab" },
		{ key: "board/memory", label: "The Board's Memory tab" },
		{ key: "board/projects", label: "The Board's Projects tab" },
		{ key: "board/settings", label: "The Board's Settings tab" },
	],
	view: route => (route.thread !== null ? "board/thread" : route.tab === "messages" ? "board" : `board/${route.tab}`),
	shortcuts: {
		category: "Board",
		goTo: { label: "Go to the Board", command: "Go to Board", keys: [] },
		rows: [],
	},
	controls: [
		{ id: "board.tab", label: "Board tab across the top of a Workspace", area: "Board" },
		{ id: "board.workspace", label: "Board sidebar workspace row", area: "Board" },
		{ id: "board.task.open", label: "Board task message, which opens its thread", area: "Board" },
		{ id: "board.post", label: "Board composer Send button or Enter", area: "Board" },
		{ id: "board.reply", label: "Board thread reply Send button or Enter", area: "Board" },
		{ id: "board.thread.close", label: "Board thread close button", area: "Board" },
		{ id: "board.session.open", label: "Board session link, in the sidebar or a thread", area: "Board" },
	],
	store: {
		apply(state, change) {
			const applied = applyChange(state, change, Date.now());
			return "ok" in applied ? applied.ok : null;
		},
	},
};
