/** The Sport module's plan, measurements, and workout log, kept in one file the server alone writes, so the page and the agent read the same state. */
import { ReducerFile } from "../fs";
import { EMPTY_SPORT, type SportChange, type SportState } from "../shared/sport";
import { applySport } from "../sport";
import { parseSportState } from "../sport-parse";

export class SportFile extends ReducerFile<SportState, [SportChange]> {
	constructor(path: string) {
		super(path, { parse: parseSportState, holds: "a sport state", empty: EMPTY_SPORT, reduce: applySport });
	}
}
