/**
 * What a personal session may change in the Sport module. Each `sport` tool call leaves one request, the session that
 * left it, the metrics it adds or replaces by id, and one change, which the tool checks before it leaves the file and
 * the server's sport inbox checks again against the state it applies to. An agent sets the targets and the plan, adds
 * measurements and workout logs in its session's name, and edits only the ones its session wrote; an edit names the
 * entry and the fields it changes, so the server merges them over the entry as it stands then. An agent never changes
 * one the user wrote, and never removes or restores one, which only the page does.
 */
import { canonicalJson, isObject, type Parsed } from "./json";
import type { Measurement, Metric, SportChange, SportState, WorkoutLog } from "./shared/sport";
import { applySport, sportRefusal } from "./sport";
import { parseSportChange, parseSportLog, parseSportMeasurement, parseSportMetrics } from "./sport-parse";

/** The biggest plan an agent may set, as JSON. */
export const MAX_PLAN_BYTES = 64 * 1024;

type Refusal = { error: string };

/** A measurement or a workout log, as an agent adds or edits one. */
type Entry = { id: string; addedBy: string | null };

/** An edit of the entry `id`: the fields it changes, merged over the entry when the change applies. */
type Edit<Op extends string, T> = { op: Op; id: string; fields: Partial<T> };

/** A change an agent may ask for. */
export type AgentSportChange =
	| Extract<SportChange, { op: "set-plan" | "set-targets" | "add-measurement" | "add-log" }>
	| Edit<"edit-measurement", Measurement>
	| Edit<"edit-log", WorkoutLog>;

/** What one `sport` tool call leaves for the dashboard: the session that left it, the metrics it adds or replaces by id, then its change. */
export interface AgentSportRequest {
	sessionId: string;
	metrics: Metric[];
	change: AgentSportChange;
}

const PAGE_ONLY: Record<Exclude<SportChange["op"], AgentSportChange["op"]>, string> = {
	"set-metrics": "an agent passes metrics beside its change, added or replaced by id, never the whole list",
	"remove-measurement": "an agent may not remove a measurement; only the Sport page removes or restores one",
	"remove-log": "an agent may not remove a log; only the Sport page removes or restores one",
	"restore-measurement": "an agent may not restore a measurement; only the Sport page removes or restores one",
	"restore-log": "an agent may not restore a log; only the Sport page removes or restores one",
};

/**
 * Why session `sessionId` may not write `entry` where `stored` is, or `null` when it may. A user's entry is the page's
 * alone, an agent's names its session, an edit changes only an entry its own session wrote, and an add may not replace
 * another entry; an add the state already holds as it is reads as applied, so a request the server applied but could
 * not delete applies again as nothing.
 */
function entryRefusal<T extends Entry>(noun: string, sessionId: string, stored: T | undefined, entry: T, edit: boolean): string | null {
	if (stored?.addedBy === null) return `${noun} ${stored.id} was written by the user, so an agent may not change it`;
	if (edit && stored?.addedBy !== sessionId) return `${noun} ${entry.id} was added by session ${stored?.addedBy}; an agent may edit only a ${noun} its own session wrote`;
	if (entry.addedBy !== sessionId) return `an agent's ${noun} must name the session that sent it, ${sessionId}, as addedBy`;
	if (stored === undefined || edit) return null;
	return canonicalJson(stored) === canonicalJson(entry) ? null : `${noun} ${stored.id} exists already; leave id out to add one, or edit it`;
}

const isKeyOf = <T extends object>(entry: T, key: string): key is Extract<keyof T, string> => key in entry;

function pick<T extends object>(entry: T, keys: string[]): Partial<T> {
	const picked: Partial<T> = {};
	for (const key of keys) if (isKeyOf(entry, key)) picked[key] = entry[key];
	return picked;
}

/** The edit `value` asks session `sessionId` to make of an entry in `list`, its fields read from the merged entry, with that entry. */
function edited<T extends Entry>(noun: string, sessionId: string, list: T[], value: Record<string, unknown>, parse: (entry: unknown) => Parsed<T, Refusal>): Parsed<{ id: string; fields: Partial<T>; entry: T }, Refusal> {
	const { id, fields } = value;
	if (typeof id !== "string") return { error: `id must name the ${noun} to edit` };
	if (!isObject(fields) || Array.isArray(fields)) return { error: "fields must be an object" };
	const stored = list.find(other => other.id === id);
	if (stored === undefined) return { error: `no ${noun} has id ${id}; leave id out to add one` };
	const entry = parse({ ...stored, ...fields });
	if ("error" in entry) return entry;
	if (entry.ok.id !== id) return { error: `an edit may not change ${noun} ${id}'s id` };
	const why = entryRefusal(noun, sessionId, stored, entry.ok, true);
	return why === null ? { ok: { id, fields: pick(entry.ok, Object.keys(fields)), entry: entry.ok } } : { error: why };
}

/** `value`, a request's change, as session `sessionId` may make it to `state`, with the whole change it applies as. */
function agentChange(state: SportState, sessionId: string, value: unknown): Parsed<{ change: AgentSportChange; applies: SportChange }, Refusal> {
	if (!isObject(value)) return { error: "change must be an object" };
	if (value.op === "edit-log") {
		const edit = edited("workout log", sessionId, state.log, value, parseSportLog);
		return "error" in edit ? edit : { ok: { change: { op: "edit-log", id: edit.ok.id, fields: edit.ok.fields }, applies: { op: "edit-log", log: edit.ok.entry } } };
	}
	if (value.op === "edit-measurement") {
		const edit = edited("measurement", sessionId, state.measurements, value, parseSportMeasurement);
		return "error" in edit ? edit : { ok: { change: { op: "edit-measurement", id: edit.ok.id, fields: edit.ok.fields }, applies: { op: "edit-measurement", measurement: edit.ok.entry } } };
	}
	const planBytes = value.op === "set-plan" ? Buffer.byteLength(JSON.stringify(value.plan ?? null)) : 0;
	if (planBytes > MAX_PLAN_BYTES) return { error: `the plan is ${planBytes} bytes as JSON; keep it to at most ${MAX_PLAN_BYTES}` };
	const parsed = parseSportChange(value);
	if ("error" in parsed) return parsed;
	const change = parsed.ok;
	switch (change.op) {
		case "set-plan":
		case "set-targets":
			return { ok: { change, applies: change } };
		case "add-measurement": {
			const why = entryRefusal("measurement", sessionId, state.measurements.find(({ id }) => id === change.measurement.id), change.measurement, false);
			return why === null ? { ok: { change, applies: change } } : { error: why };
		}
		case "add-log": {
			const why = entryRefusal("workout log", sessionId, state.log.find(({ id }) => id === change.log.id), change.log, false);
			return why === null ? { ok: { change, applies: change } } : { error: why };
		}
		case "edit-measurement":
		case "edit-log":
			return { error: "an edit gives the id of the entry and the fields it changes" };
		case "set-metrics":
		case "remove-measurement":
		case "remove-log":
		case "restore-measurement":
		case "restore-log":
			return { error: PAGE_ONLY[change.op] };
		default: {
			const never: never = change;
			return never;
		}
	}
}

/**
 * `value`, the request a personal session left, as an agent may make it to `state`: the request as the tool leaves it,
 * the changes the server applies for it, and the state they leave, or why it is refused whole.
 */
export function agentSportChanges(state: SportState, value: unknown): Parsed<{ request: AgentSportRequest; changes: SportChange[]; state: SportState }, Refusal> {
	if (!isObject(value)) return { error: "a sport request must be an object" };
	const { sessionId } = value;
	if (typeof sessionId !== "string" || sessionId === "") return { error: "a sport request must name the session that left it" };
	const metrics = parseSportMetrics(value.metrics ?? []);
	if ("error" in metrics) return metrics;
	const merged = [...state.metrics.map(metric => metrics.ok.find(({ id }) => id === metric.id) ?? metric), ...metrics.ok.filter(metric => !state.metrics.some(({ id }) => id === metric.id))];
	const changes: SportChange[] = canonicalJson(merged) === canonicalJson(state.metrics) ? [] : [{ op: "set-metrics", metrics: merged }];
	let next = changes.reduce(applySport, state);
	const change = agentChange(next, sessionId, value.change);
	if ("error" in change) return change;
	const why = sportRefusal(next, change.ok.applies);
	if (why !== null) return { error: why };
	changes.push(change.ok.applies);
	next = applySport(next, change.ok.applies);
	return { ok: { request: { sessionId, metrics: metrics.ok, change: change.ok.change }, changes, state: next } };
}

/** `state` after the requests `values`, oldest first, the ones the server takes from a personal session, as it will apply them. */
export const withAgentChanges = (state: SportState, values: unknown[]): SportState =>
	values.reduce<SportState>((next, value) => {
		const result = agentSportChanges(next, value);
		return "ok" in result ? result.ok.state : next;
	}, state);
