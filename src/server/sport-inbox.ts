/**
 * The requests omp's `sport` tool leaves for the Sport module, one JSON file per call in a directory, so the server
 * stays the only writer of `sport.json` and a session can log a workout while the dashboard is down. Each file
 * is resolved against the state as it applies, by `agentSportChanges`, so an edit merges its fields over the entry as it
 * stands then, and one an agent may not make, or one the state would refuse, is set aside whole with the reason. A file
 * is deleted only once `apply` says its changes reached `sport.json`, and stays for the next drain otherwise.
 */
import type { SportChange, SportState } from "../shared/sport";
import { agentSportChanges } from "../sport-agent";
import { type InboxOptions, JsonInboxDir } from "./json-inbox";

export class SportInbox extends JsonInboxDir<SportChange[]> {
	constructor(dir: string, state: () => SportState, apply: (changes: SportChange[]) => boolean, options?: InboxOptions) {
		super(
			dir,
			{
				parse(_name, value) {
					const result = agentSportChanges(state(), value);
					return "ok" in result ? { item: result.ok.changes } : { invalid: result.error };
				},
				apply,
			},
			options,
		);
	}
}
