/** The Board module's server half: `board.json`, the `board` tool's inbox and extension. `BoardWake` in `src/server/board-wake.ts` wakes the sessions a message is for. */
import { join } from "node:path";
import { ReducerFile } from "./fs";
import type { StoredModule } from "./modules";
import { BOARD_FLAGS } from "./omp/board-extension";
import { configDir } from "./paths";
import { JsonInboxDir } from "./server/json-inbox";
import { shippedFile } from "./server/resources";
import { applyBoardChange, type BoardChange, type BoardState, parseBoardChange, parseBoardState, seed } from "./shared/board";

/** Channels, threads, messages, members, schedules, and read marks. */
const BOARD_FILE = join(configDir, "board.json");
/** Where the `board` tool leaves its changes, one JSON file each, so the server stays the only writer of {@link BOARD_FILE}. */
const BOARD_INBOX = join(configDir, "board-inbox");
/** The omp extension every session loads, which gives it the `board` tool. */
const BOARD_EXTENSION = { source: join(import.meta.dir, "omp", "board-extension.ts"), bundle: "board-extension.js" };

/** The Board's file at `path`, which applies each change as the page and the `board` tool would and refuses one they would. */
export function openBoardFile(path: string): ReducerFile<BoardState, [BoardChange]> {
	return new ReducerFile<BoardState, [BoardChange]>(path, {
		parse: parseBoardState,
		holds: "a board",
		empty: seed(Date.now()),
		reduce(state, change) {
			const applied = applyBoardChange(state, change);
			if ("error" in applied) throw new Error(applied.error);
			return applied.ok;
		},
	});
}

export const BOARD_MODULE: StoredModule<"board", BoardState, BoardChange> = {
	id: "board",
	store: {
		open: () => openBoardFile(BOARD_FILE),
		parse: parseBoardChange,
		inbox: (_state, apply, options) =>
			new JsonInboxDir<BoardChange>(
				BOARD_INBOX,
				{
					parse(_name, value) {
						const change = parseBoardChange(value);
						return change ? { item: change } : { invalid: "It is no board change." };
					},
					apply,
				},
				options,
			),
	},
	join: { rpc: { args: ["-e", shippedFile(BOARD_EXTENSION), `--${BOARD_FLAGS.file}`, BOARD_FILE, `--${BOARD_FLAGS.inbox}`, BOARD_INBOX], tools: [] }, attach() {} },
	shipped: [BOARD_EXTENSION],
};
