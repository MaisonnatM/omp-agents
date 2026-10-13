/** The Google calendars the Calendar page's sidebar unchecked, saved in `calendars.json` as `{ hidden }`, their ids. */
import { ReducerFile } from "../fs";
import { isObject, isTexts } from "../json";

/** `hidden` once calendar `id` shows or hides, or `hidden` itself when it already does. */
function showCalendar(hidden: ReadonlySet<string>, id: string, shown: boolean): ReadonlySet<string> {
	if (hidden.has(id) !== shown) return hidden;
	const next = new Set(hidden);
	if (shown) next.delete(id);
	else next.add(id);
	return next;
}

/** The ids of the calendars whose events the Calendar page leaves out. */
export class CalendarsFile extends ReducerFile<ReadonlySet<string>, [id: string, shown: boolean]> {
	constructor(path: string) {
		super(path, {
			parse: value => (isObject(value) && isTexts(value.hidden) ? new Set(value.hidden) : null),
			toJson: hidden => ({ hidden: [...hidden] }),
			holds: "a list of hidden calendars",
			empty: new Set(),
			reduce: showCalendar,
		});
	}
}
