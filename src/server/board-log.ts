/**
 * The Board's store: `board-events.jsonl`, an append-only log the server is the one writer of, and the Board it folds
 * into. A change the Board refuses throws and appends nothing; one it takes is on disk before `apply` returns.
 * See docs/architecture/board.md.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModuleFile } from "../modules";
import { applyChange, type BoardChange, type BoardState, emptyBoard, readLog } from "../../templates/omp/agent/extensions/board/log";

export class BoardLog implements ModuleFile<BoardState, BoardChange> {
	readonly #path: string;
	readonly #now: () => number;
	#value: BoardState;

	constructor(path: string, now: () => number = Date.now) {
		this.#path = path;
		this.#now = now;
		let text = "";
		try {
			text = readFileSync(path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		this.#value = text ? readLog(text) : emptyBoard();
	}

	get value(): BoardState {
		return this.#value;
	}

	apply(change: BoardChange): boolean {
		const applied = applyChange(this.#value, change, this.#now());
		if ("error" in applied) throw new Error(applied.error);
		mkdirSync(dirname(this.#path), { recursive: true });
		appendFileSync(this.#path, `${JSON.stringify(applied.event)}\n`);
		this.#value = applied.ok;
		return true;
	}

	/** An event log holds what happened, which no whole state replaces; nothing syncs the Board. */
	replace(): boolean {
		return false;
	}

	/** `apply` appends before it returns, so what it saved is on disk. */
	flush(): boolean {
		return true;
	}
}
