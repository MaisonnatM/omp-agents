/** The Sport module's plan, measurements, and workout log, kept in one file the server alone writes, so the page and the agent read the same state. */
import { ReducerFile } from "../fs";
import { EMPTY_SPORT, type SportChange, type SportState } from "../shared/sport";
import { applySportChanges } from "../sport";
import { parseSportState } from "../sport-parse";

/** `state` after all of `changes`; a refused one throws and changes nothing, so a batch reaches the file whole or not at all. */
function applyWhole(state: SportState, changes: SportChange[]): SportState {
	const applied = applySportChanges(state, changes);
	if ("error" in applied) throw new Error(applied.error);
	return applied.ok;
}

export class SportFile extends ReducerFile<SportState, [SportChange[]]> {
	constructor(path: string) {
		super(path, { parse: parseSportState, holds: "a sport state", empty: EMPTY_SPORT, reduce: applyWhole });
	}
}
