/** The Board module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder, and its state is `board.json` on the server. */
import { IconBubble2 } from "central-icons";
import { applyBoardChange, type BoardChange, type BoardState } from "../../../src/shared/board";
import type { StoredPageModule } from "../../modules";

export type BoardRoute = Record<string, never>;

export const BOARD_PAGE: StoredPageModule<"board", BoardRoute, BoardState, BoardChange> = {
	id: "board",
	tab: { label: "Board", icon: IconBubble2, place: 65 },
	about: "Channels and threads where you, your sessions, and remote agents ping each other, with an inbox that wakes them.",
	listsItself: true,
	home: {},
	address: { parse: () => ({}), rest: () => null, query: () => null },
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
