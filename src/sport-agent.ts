/**
 * What a personal session may change in the Sport module, which the `sport` tool checks before it leaves a change and
 * the server's sport inbox checks again as each one applies. An agent sets the metrics, the targets, and the plan, and
 * adds or edits measurements and workout logs in a session's name; it never changes one the user wrote, and it never
 * removes or restores one, which only the page does.
 */
import type { Parsed } from "./json";
import type { SportChange, SportState } from "./shared/sport";
import { applySport, sportRefusal } from "./sport";
import { parseSportChange } from "./sport-parse";

/** Why an agent may not make `change` to `state`, or `null` when it may. */
function agentRefusal(state: SportState, change: SportChange): string | null {
	switch (change.op) {
		case "set-plan":
		case "set-targets":
		case "set-metrics":
			return null;
		case "add-measurement":
			return change.measurement.addedBy === null ? "an agent's measurement must name the session that added it" : null;
		case "add-log":
			return change.log.addedBy === null ? "an agent's workout log must name the session that added it" : null;
		case "edit-measurement": {
			const stored = state.measurements.find(({ id }) => id === change.measurement.id);
			if (stored?.addedBy === null) return `measurement ${stored.id} was written by the user, so an agent may not change it`;
			return change.measurement.addedBy === null ? "an agent's measurement must name the session that added it" : null;
		}
		case "edit-log": {
			const stored = state.log.find(({ id }) => id === change.log.id);
			if (stored?.addedBy === null) return `workout log ${stored.id} was written by the user, so an agent may not change it`;
			return change.log.addedBy === null ? "an agent's workout log must name the session that added it" : null;
		}
		case "remove-measurement":
		case "remove-log":
		case "restore-measurement":
		case "restore-log":
			return `an agent may not ${change.op.replace("-", " a ")}; only the Sport page removes or restores one`;
		default: {
			const never: never = change;
			return never;
		}
	}
}

/** `value`, a change a personal session left, as `state` takes it, or why it is refused. */
export function agentSportChange(state: SportState, value: unknown): Parsed<SportChange, { error: string }> {
	const parsed = parseSportChange(value);
	if ("error" in parsed) return parsed;
	const why = agentRefusal(state, parsed.ok) ?? sportRefusal(state, parsed.ok);
	return why === null ? parsed : { error: why };
}

/** `state` after the changes `values`, oldest first, the ones the server takes from a personal session, as it will apply them. */
export const withAgentChanges = (state: SportState, values: unknown[]): SportState =>
	values.reduce<SportState>((next, value) => {
		const change = agentSportChange(next, value);
		return "ok" in change ? applySport(next, change.ok) : next;
	}, state);
