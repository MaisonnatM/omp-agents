/** The page's portable preferences, saved in `preferences.json` as `{ values }`; no file means no page has seeded them yet. */
import { ReducerFile } from "../fs";
import { isObject } from "../json";
import { applyPreference, type PagePreferences, parsePagePreferences, type PreferenceChange } from "../shared/preferences";

export class PreferencesFile extends ReducerFile<PagePreferences | null, [PreferenceChange]> {
	constructor(path: string) {
		super(path, {
			parse: json => (isObject(json) ? parsePagePreferences(json.values) : null),
			toJson: values => ({ values }),
			holds: "the page's preferences",
			empty: null,
			reduce: applyPreference,
		});
	}
}
