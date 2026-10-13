/** The pinned sessions, saved in `pins.json` as `{ sessions }`. */
import { ReducerFile } from "../fs";
import { isObject, isTexts } from "../json";
import { applyPins, type PinChange } from "../shared/pins";

export class PinsFile extends ReducerFile<string[], [PinChange]> {
	constructor(path: string) {
		super(path, {
			parse: value => (isObject(value) && isTexts(value.sessions) ? value.sessions : null),
			toJson: sessions => ({ sessions }),
			holds: "a list of pinned sessions",
			empty: [],
			reduce: applyPins,
		});
	}
}
