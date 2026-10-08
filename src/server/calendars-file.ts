/** The Google calendars the Calendar page's sidebar unchecked, saved in `calendars.json`. */
import { JsonFile } from "../fs";
import { isObject } from "../json";

interface CalendarChoices {
	/** The ids of the calendars whose events the Calendar page leaves out. */
	hidden: string[];
}

export function parseCalendarChoices(value: unknown): CalendarChoices | null {
	if (!isObject(value) || !Array.isArray(value.hidden) || !value.hidden.every(id => typeof id === "string")) return null;
	return { hidden: value.hidden };
}

export class CalendarsFile {
	readonly #file: JsonFile<CalendarChoices>;
	#hidden: ReadonlySet<string>;

	constructor(path: string) {
		// Someone may have edited the file by hand, so one that holds something else moves aside rather than being written over.
		this.#file = new JsonFile(path, { parse: parseCalendarChoices, holds: "a list of hidden calendars", onInvalid: "aside", indent: "\t" });
		this.#hidden = new Set(this.#file.load()?.hidden);
	}

	get hidden(): ReadonlySet<string> {
		return this.#hidden;
	}

	/** Shows or hides calendar `id` and saves; whether it changed anything. */
	setShown(id: string, shown: boolean): boolean {
		if (this.#hidden.has(id) !== shown) return false;
		const next = new Set(this.#hidden);
		if (shown) next.delete(id);
		else next.add(id);
		this.#hidden = next;
		this.#file.save({ hidden: [...next] });
		return true;
	}
}
