/** The Board module's server half: the event log, and the inbox the starter kit's `board` tool leaves changes in. See docs/architecture/board.md. */
import { join } from "node:path";
import type { StoredModule } from "./modules";
import { configDir, dataDir } from "./paths";
import { BoardLog } from "./server/board-log";
import { boardImageRoutes } from "./server/board-images";
import { BoardRunner } from "./server/board-runner";
import { JsonInboxDir } from "./server/json-inbox";
import { type BoardChange, type BoardState, parseChange } from "../templates/omp/agent/extensions/board/log";

/** The Board's event log; never `board.json`, which an older Board kept and the Projects module renames at startup. */
export const BOARD_FILE = join(configDir, "board-events.jsonl");
/** Where the `board` tool leaves its changes, one JSON file each, so the server stays the only writer of {@link BOARD_FILE}; not `board-inbox/`, which the Projects module deletes beside an older `board.json`. */
export const BOARD_INBOX = join(configDir, "board-changes");
/** The images the page's composers attach, which a Board task or reply names by path; under the data directory, so the page shows them. */
const BOARD_IMAGES = join(dataDir, "board-images");

/** What the page may change, as the user: post a Board task, reply on one, edit one of their messages, close a Board task, or add, change, or remove a quick link. */
const pageChange = (value: unknown): BoardChange | null => {
	const change = parseChange(value);
	if (change?.op === "link" || change?.op === "unlink") return change;
	return change && (change.op === "post" || change.op === "reply" || change.op === "edit" || change.op === "close") && change.by.kind === "user" ? change : null;
};

/** What a session's `board` tool may change: anything but the server's own changes and the user's, as itself. */
const toolChange = (value: unknown): BoardChange | null => {
	const change = parseChange(value);
	return change && !("by" in change && change.by.kind === "user") ? change : null;
};

export const BOARD_MODULE: StoredModule<"board", BoardState, BoardChange> = {
	id: "board",
	store: {
		open: () => new BoardLog(BOARD_FILE),
		parse: pageChange,
		inbox: (_state, apply, options) =>
			new JsonInboxDir<BoardChange>(
				BOARD_INBOX,
				{
					parse(name, value) {
						const change = toolChange(value);
						// The file's name goes in the event, so the same file applied again after a crash changes nothing.
						return change ? { item: { ...change, request: name } } : { invalid: "This is no change the board tool makes." };
					},
					apply,
				},
				options,
			),
		run: (state, apply, core) => new BoardRunner(state, apply, core),
	},
	routes: kit => boardImageRoutes(kit, BOARD_IMAGES),
};
