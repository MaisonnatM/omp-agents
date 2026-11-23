/** The Board module's server half: `board.json`, the `board` tool's inbox and extension. `run` starts `BoardWake`, which wakes the sessions a message is for, and `BoardFeed`. A project is a Board channel. */
import { userInfo } from "node:os";
import { join } from "node:path";
import { ReducerFile } from "./fs";
import type { ModuleEnv, StoredModule } from "./modules";
import { BOARD_FLAGS } from "./omp/board-extension";
import { configDir } from "./paths";
import { BoardFeed } from "./server/board-feed";
import { BoardWake } from "./server/board-wake";
import { JsonInboxDir } from "./server/json-inbox";
import { migrateProjectList } from "./server/project-migration";
import { shippedFile } from "./server/resources";
import { applyBoardChange, type BoardChange, type BoardState, emptyBoard, inBotsName, parseBoardChange, parseBoardState } from "./shared/board";

/** Channels, threads, messages, members, schedules, and read marks. */
const BOARD_FILE = join(configDir, "board.json");
/** Where the `board` tool leaves its changes, one JSON file each, so the server stays the only writer of {@link BOARD_FILE}. */
const BOARD_INBOX = join(configDir, "board-inbox");
/** The projects an older version kept apart, which the Board takes in once and renames `project-list.json.migrated`. */
const LEGACY_PROJECTS_FILE = join(configDir, "project-list.json");
/** The omp extension every session loads, which gives it the `board` tool. */
const BOARD_EXTENSION = { source: join(import.meta.dir, "omp", "board-extension.ts"), bundle: "board-extension.js" };

/** What the Board's server half reaches of the core. */
export type BoardEnv = ModuleEnv<BoardState, BoardChange>;

/** How often the Board checks its schedules. */
const SCHEDULE_MS = 30_000;

/** The Board's file at `path`, which applies each change as the page and the `board` tool would and refuses one they would. */
export function openBoardFile(path: string): ReducerFile<BoardState, [BoardChange]> {
	return new ReducerFile<BoardState, [BoardChange]>(path, {
		parse: parseBoardState,
		holds: "a board",
		empty: emptyBoard(userInfo().username),
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
		open() {
			const file = openBoardFile(BOARD_FILE);
			migrateProjectList(file, LEGACY_PROJECTS_FILE, Date.now());
			return file;
		},
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
	run(env) {
		const wake = new BoardWake(env);
		const feed = new BoardFeed(env);
		const timer = setInterval(() => wake.fireDue(), SCHEDULE_MS);
		env.stopping.addEventListener("abort", () => clearInterval(timer));
		return {
			changed: () => wake.check(),
			rosterChanged: () => feed.check(),
			// The `board` tool posts as its session, so a Bot's conversation posts in the Bot's name.
			fromAgent: change => inBotsName(change, env.bots()),
		};
	},
};
