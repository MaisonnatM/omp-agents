/** The pinned sessions, saved in `pins.json` as `{ sessions }`. */
import { JsonFile } from "../fs";
import { isObject, isTexts } from "../json";
import { applyPins, type PinChange } from "../shared/pins";

interface Stored {
	sessions: string[];
}

export class PinsFile {
	readonly #file: JsonFile<Stored>;
	#sessionIds: string[];

	constructor(path: string) {
		this.#file = new JsonFile(path, {
			parse: value => (isObject(value) && isTexts(value.sessions) ? { sessions: value.sessions } : null),
			holds: "a list of pinned sessions",
			onInvalid: "aside",
			indent: "\t",
		});
		this.#sessionIds = this.#file.load()?.sessions ?? [];
	}

	get sessionIds(): string[] {
		return this.#sessionIds;
	}

	/** Applies `change` and saves; whether it changed anything. */
	apply(change: PinChange): boolean {
		const next = applyPins(this.#sessionIds, change);
		if (next === this.#sessionIds) return false;
		this.#sessionIds = next;
		this.#file.save({ sessions: next });
		return true;
	}
}
