/**
 * The changes omp's `sport` tool leaves for the Sport module, one JSON file each in a directory, so the server stays the
 * only writer of `sport.json` and a personal session can log a workout while the dashboard is down. Each file is checked
 * against the state as it applies, by `agentSportChange`, so one an agent may not make, or one the state would refuse,
 * is set aside with the reason instead of applying as nothing.
 */
import type { SportChange, SportState } from "../shared/sport";
import { agentSportChange } from "../sport-agent";
import { type InboxOptions, JsonInboxDir } from "./json-inbox";

export class SportInbox extends JsonInboxDir<SportChange> {
	constructor(dir: string, state: () => SportState, apply: (change: SportChange) => void, options?: InboxOptions) {
		super(
			dir,
			{
				parse(_name, value) {
					const change = agentSportChange(state(), value);
					return "ok" in change ? { item: change.ok } : { invalid: change.error };
				},
				apply(change) {
					apply(change);
					return true;
				},
			},
			options,
		);
	}
}
