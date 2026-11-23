/** The Board module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder, and its state is `board.json` on the server. */
import { IconBubble2 } from "central-icons";
import { applyBoardChange, type BoardChange, type BoardState } from "../../../src/shared/board";
import type { StoredPageModule } from "../../modules";

/** What the Board lists: your inbox, the schedules, a channel's threads, or a member's queue. */
export type BoardView = { kind: "inbox" } | { kind: "scheduled" } | { kind: "channel"; id: string } | { kind: "member"; id: string };

export type BoardRoute = { view: BoardView };

const INBOX: BoardRoute = { view: { kind: "inbox" } };

/** `view`, or the inbox when it names a channel or member that no longer exists. */
export function resolveBoardView(state: BoardState, memberIds: ReadonlySet<string> | Map<string, unknown>, view: BoardView): BoardView {
	if (view.kind === "channel") return state.channels.some(channel => channel.id === view.id) ? view : INBOX.view;
	if (view.kind === "member") return memberIds.has(view.id) ? view : INBOX.view;
	return view;
}

export const BOARD_PAGE: StoredPageModule<"board", BoardRoute, BoardState, BoardChange> = {
	id: "board",
	tab: { label: "Board", icon: IconBubble2, place: 65 },
	about: "Channels and threads where you, your sessions, and remote agents ping each other, with an inbox that wakes them.",
	listsItself: true,
	home: INBOX,
	/** `#board` is your inbox, `#board/scheduled` the schedules, `#board/channel/<id>` a channel, and `#board/member/<id>` a member's queue. */
	address: {
		parse(rest) {
			if (rest === "scheduled") return { view: { kind: "scheduled" } };
			const [kind, id, ...extra] = (rest ?? "").split("/");
			if ((kind !== "channel" && kind !== "member") || !id || extra.length > 0) return INBOX;
			try {
				return { view: { kind, id: decodeURIComponent(id) } };
			} catch {
				return INBOX;
			}
		},
		rest: ({ view }) => (view.kind === "inbox" ? null : view.kind === "scheduled" ? "scheduled" : `${view.kind}/${encodeURIComponent(view.id)}`),
		query: () => null,
	},
	title: () => "Board",
	views: [{ key: "board", label: "Board" }],
	view: () => "board",
	shortcuts: { category: "Board", goTo: { label: "Go to the board", command: "Go to board", keys: [] }, rows: [] },
	controls: [],
	store: {
		apply(state, change) {
			const applied = applyBoardChange(state, change);
			return "ok" in applied ? applied.ok : null;
		},
	},
};
