/** Applying changes to the Sport module's state, which the server does to `sport.json` and the page to the state it shows. */
import { canonicalJson } from "./json";
import type { SportChange, SportState, WorkoutLog } from "./shared/sport";

/** `list` with `item` after every item dated on or before it, so a list ordered by date stays ordered and a day keeps its order of entry. */
function insertByDate<T>(list: T[], item: T, dateOf: (item: T) => string): T[] {
	const date = dateOf(item);
	const after = list.findLastIndex(other => dateOf(other) <= date);
	return list.toSpliced(after + 1, 0, item);
}

/** `list` with `item` back at `index` when that keeps the list ordered by date, else where its date puts it. */
function restoreByDate<T>(list: T[], item: T, index: number, dateOf: (item: T) => string): T[] {
	const at = Math.min(index, list.length);
	const date = dateOf(item);
	const fits = (at === 0 || dateOf(list[at - 1]!) <= date) && (at === list.length || date <= dateOf(list[at]!));
	return fits ? list.toSpliced(at, 0, item) : insertByDate(list, item, dateOf);
}

const loggedOn = (log: WorkoutLog): string => log.date;
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** `state` after `change`, the same object when nothing changed: an add or restore of an id already there, or an edit, remove, or set that changes nothing. */
export function applySport(state: SportState, change: SportChange): SportState {
	switch (change.op) {
		case "set-plan":
			return same(state.plan, change.plan) ? state : { ...state, plan: change.plan };
		case "set-targets":
			return same(state.targets, change.targets) ? state : { ...state, targets: change.targets };
		case "set-metrics":
			return same(state.metrics, change.metrics) ? state : { ...state, metrics: change.metrics };
		case "add-measurement":
			if (state.measurements.some(({ id }) => id === change.measurement.id)) return state;
			return { ...state, measurements: insertByDate(state.measurements, change.measurement, ({ at }) => at) };
		case "restore-measurement":
			if (state.measurements.some(({ id }) => id === change.measurement.id)) return state;
			return { ...state, measurements: restoreByDate(state.measurements, change.measurement, change.index, ({ at }) => at) };
		case "remove-measurement": {
			const measurements = state.measurements.filter(({ id }) => id !== change.id);
			return measurements.length === state.measurements.length ? state : { ...state, measurements };
		}
		case "add-log":
			if (state.log.some(({ id }) => id === change.log.id)) return state;
			return { ...state, log: insertByDate(state.log, change.log, loggedOn) };
		case "edit-log": {
			const index = state.log.findIndex(({ id }) => id === change.log.id);
			if (index === -1 || same(state.log[index], change.log)) return state;
			const rest = state.log.toSpliced(index, 1);
			return { ...state, log: restoreByDate(rest, change.log, index, loggedOn) };
		}
		case "remove-log": {
			const log = state.log.filter(({ id }) => id !== change.id);
			return log.length === state.log.length ? state : { ...state, log };
		}
		case "restore-log":
			if (state.log.some(({ id }) => id === change.log.id)) return state;
			return { ...state, log: restoreByDate(state.log, change.log, change.index, loggedOn) };
		default: {
			const never: never = change;
			return never;
		}
	}
}
