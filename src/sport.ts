/** Applying changes to the Sport module's state, which the server does to `sport.json` and the page to the state it shows. */
import { canonicalJson } from "./json";
import type { Measurement, SportChange, SportState, WorkoutLog } from "./shared/sport";

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/**
 * Adding, editing, removing, and restoring entries by id in a list kept in date order, a day's entries in the order
 * they came. Each returns the same list when it changes nothing: an add or restore of an id already there, or an edit
 * or remove that finds nothing to change.
 */
function datedList<T extends { id: string }>(dateOf: (item: T) => string) {
	/** `list` with `item` after every entry dated on or before it. */
	const insert = (list: T[], item: T): T[] => list.toSpliced(list.findLastIndex(other => dateOf(other) <= dateOf(item)) + 1, 0, item);
	/** `list` with `item` back at `index` when that keeps the date order, else where its date puts it. */
	function putBack(list: T[], item: T, index: number): T[] {
		const at = Math.min(index, list.length);
		const date = dateOf(item);
		const fits = (at === 0 || dateOf(list[at - 1]!) <= date) && (at === list.length || date <= dateOf(list[at]!));
		return fits ? list.toSpliced(at, 0, item) : insert(list, item);
	}
	return {
		add: (list: T[], item: T): T[] => (list.some(other => other.id === item.id) ? list : insert(list, item)),
		restore: (list: T[], item: T, index: number): T[] => (list.some(other => other.id === item.id) ? list : putBack(list, item, index)),
		edit(list: T[], item: T): T[] {
			const index = list.findIndex(other => other.id === item.id);
			return index === -1 || same(list[index], item) ? list : putBack(list.toSpliced(index, 1), item, index);
		},
		remove(list: T[], id: string): T[] {
			const kept = list.filter(other => other.id !== id);
			return kept.length === list.length ? list : kept;
		},
	};
}

const LOGS = datedList<WorkoutLog>(log => log.date);
const MEASUREMENTS = datedList<Measurement>(measurement => measurement.at);

const withLog = (state: SportState, log: WorkoutLog[]): SportState => (log === state.log ? state : { ...state, log });
const withMeasurements = (state: SportState, measurements: Measurement[]): SportState => (measurements === state.measurements ? state : { ...state, measurements });

/** `state` after `change`, the same object when nothing changed. */
export function applySport(state: SportState, change: SportChange): SportState {
	switch (change.op) {
		case "set-plan":
			return same(state.plan, change.plan) ? state : { ...state, plan: change.plan };
		case "set-targets":
			return same(state.targets, change.targets) ? state : { ...state, targets: change.targets };
		case "set-metrics":
			return same(state.metrics, change.metrics) ? state : { ...state, metrics: change.metrics };
		case "add-measurement":
			return withMeasurements(state, MEASUREMENTS.add(state.measurements, change.measurement));
		case "edit-measurement":
			return withMeasurements(state, MEASUREMENTS.edit(state.measurements, change.measurement));
		case "remove-measurement":
			return withMeasurements(state, MEASUREMENTS.remove(state.measurements, change.id));
		case "restore-measurement":
			return withMeasurements(state, MEASUREMENTS.restore(state.measurements, change.measurement, change.index));
		case "add-log":
			return withLog(state, LOGS.add(state.log, change.log));
		case "edit-log":
			return withLog(state, LOGS.edit(state.log, change.log));
		case "remove-log":
			return withLog(state, LOGS.remove(state.log, change.id));
		case "restore-log":
			return withLog(state, LOGS.restore(state.log, change.log, change.index));
		default: {
			const never: never = change;
			return never;
		}
	}
}
