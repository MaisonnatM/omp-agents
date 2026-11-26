/**
 * The Board's store: `board-events.jsonl`, an append-only log that only the server holding the owner lock writes, and
 * the Board it folds into. A change the Board refuses throws and appends nothing; one it takes is on disk before `apply`
 * returns. See docs/architecture/board.md.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModuleFile } from "../modules";
import { applyChange, type BoardChange, type BoardState, emptyBoard, readLog } from "../../templates/omp/agent/extensions/board/log";

export class BoardLog implements ModuleFile<BoardState, BoardChange> {
	readonly #path: string;
	readonly #now: () => number;
	#value: BoardState = emptyBoard();
	/** Whether the log ends in a line a writer cut off, which the next append must not continue. */
	#torn = false;

	constructor(path: string, now: () => number = Date.now) {
		this.#path = path;
		this.#now = now;
		this.reload();
	}

	get value(): BoardState {
		return this.#value;
	}

	/** Reads and folds the log again, for what the server that ran the unattended work appended since this one read it. */
	reload(): void {
		let text = "";
		try {
			text = readFileSync(this.#path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		this.#value = text ? readLog(text) : emptyBoard();
		this.#torn = text !== "" && !text.endsWith("\n");
	}

	apply(change: BoardChange): boolean {
		const applied = applyChange(this.#value, change, this.#now());
		if ("error" in applied) throw new Error(applied.error);
		// A request the log already holds, which a crash before its inbox file was deleted hands over again: taken, so the file goes.
		if (applied.event === null) return true;
		mkdirSync(dirname(this.#path), { recursive: true });
		// A line a crash cut off ends here, so the event starts its own line rather than joining the torn one, which the fold skips.
		appendFileSync(this.#path, `${this.#torn ? "\n" : ""}${JSON.stringify(applied.event)}\n`);
		this.#torn = false;
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
