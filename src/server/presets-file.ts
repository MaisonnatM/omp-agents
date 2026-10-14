/** The session presets, saved in `presets.json` as `{ presets }`. */
import { existsSync } from "node:fs";
import { ReducerFile } from "../fs";
import { isObject, parseAll } from "../json";
import { applyPresets, type PresetChange, parsePreset, type SessionPreset } from "../shared/presets";

export class PresetsFile extends ReducerFile<SessionPreset[], [PresetChange]> {
	readonly #fresh: boolean;

	constructor(path: string) {
		const fresh = !existsSync(path);
		super(path, {
			parse: value => (isObject(value) ? parseAll(value.presets, preset => parsePreset(preset)?.ok ?? null) : null),
			toJson: presets => ({ presets }),
			holds: "a list of session presets",
			empty: [],
			reduce: applyPresets,
			shared: true,
		});
		this.#fresh = fresh;
	}

	/** Saves `starters` the first time the server runs, unless a preset was saved meanwhile; whether it saved them. */
	seed(starters: SessionPreset[]): boolean {
		return this.#fresh && this.update(current => current.length === 0 ? starters : current);
	}
}
