/**
 * The `sport` tool of a personal session: it reads the Sport module's state with the changes its inbox still holds, and
 * leaves each change it makes in that inbox for the dashboard, the one writer of `sport.json`. It checks every change as
 * the dashboard will, with `agentSportChange`, before it leaves one, so a refusal reaches the agent with its reason.
 */
import { randomUUID } from "node:crypto";
import { inbox } from "../../templates/omp/agent/extensions/inbox/client";
import { isObject, parseJson } from "../json";
import { localDay } from "../shared/days";
import { MAX_CHART_ROWS } from "../shared/session-visuals";
import { EMPTY_SPORT, type SportState, WORKOUT_KINDS } from "../shared/sport";
import { applySport } from "../sport";
import { agentSportChange, withAgentChanges } from "../sport-agent";
import { parseSportState } from "../sport-parse";
import { dayPlan, painFlags, type PlannedDay, weekPlan } from "../sport-week";
import { type ExtensionApi, type ExtensionTool, readText, reply, type ToolContext } from "./extension-kit";

export const SPORT_TOOL = "sport";

/** The biggest plan `set_plan` leaves, as JSON. */
export const MAX_PLAN_BYTES = 64 * 1024;

/** Where a personal session reads the Sport module and leaves its changes. */
export interface SportPaths {
	file: string;
	inbox: string;
}

export interface SportParams {
	action: "read" | "week" | "history" | "log" | "measure" | "set_plan" | "set_targets";
	date?: string;
	metric?: string;
	log?: unknown;
	measurement?: unknown;
	plan?: unknown;
	targets?: unknown;
	metrics?: unknown;
}

const ACTIONS = ["read", "week", "history", "log", "measure", "set_plan", "set_targets"] as const;

const APPLIES = "The dashboard applies it, and while the dashboard is stopped the change waits for it.";

const DESCRIPTION = [
	"The user's training: metrics, measurements such as a finger max test, targets, the training plan, and the workout log, which the dashboard's Sport page shows. Pick one action.",
	"- read: the whole state as JSON.",
	"- week: the 7 days of the week `date` falls in (default today), Monday first, each with its phase, its workouts, each exercise's load in kg added worked out from the newest test and the newest log, and the pain flags of `date`. Quote these loads; never work them out yourself.",
	"- history: the measurements of `metric` as a ```chart block's JSON, ready to draw.",
	"- log: adds a workout log, or edits one an agent wrote when `log.id` names it, keeping the fields you leave out. `log` is {date: YYYY-MM-DD, default today; workout: a plan workout id or null; title; status: done | skipped; rpe: 1-10 or null; pain: {level: 0-10, where: fingers | elbow | shoulder | hip | other} or null; loads: {exercise key: kg added}; climbs: [{kind: boulder | route, grade: French such as 7a+, color, kilter, attempts}]; note}.",
	"- measure: adds a measurement, or edits one an agent wrote when `measurement.id` names it. `measurement` is {metric: a metric id, value, at: YYYY-MM-DD, default today, note}.",
	`- set_plan: replaces the plan with \`plan\`, at most ${MAX_PLAN_BYTES / 1024} KB as JSON, or clears it with null. A plan is {title, habits: [{label, routine: routine id or null}], routines: [{id, name, minutes, items: [exercise]}], workouts: [{id, name, kind: ${WORKOUT_KINDS.join(" | ")}, place: home | gym | outdoor, minutes, blocks: [{title, items: [exercise]}]}], phases: [{id, name, start, end, week, deloadWeek, deloadMondays: [YYYY-MM-DD]}], overrides: [{date, slots}]}, where a week is {mon..sun: [{workout: workout id, optional}]} and an exercise is {key, name, sets, reps, holdSec, restSec, load: {kind: "fixed", kg} or {kind: "of-max", metric, fraction, offsetKg, less} or null, note, demo, opensAs: [exercise keys], hang: true for a finger hang}. Always state each workout's \`kind\`, the one it leads with when it mixes several, and an of-max rule's \`less\`: the bodyweight metric's id for a hang on the user's weight, or null.`,
	"- set_targets: replaces the targets with `targets`, [{id, label, by: YYYY-MM-DD or null, kind: metric with metric and value, or boulder | route with grade}].",
	"A load rule, a target, or a measurement may name only a metric the state holds. On a fresh state, or for a new metric, pass `metrics` with set_plan, set_targets, or measure: [{id, label, unit, better: higher | lower}], added or replaced by id before the change.",
	'An exercise\'s demo is {youtubeId, by, cues: [3 short cues], caution or null}. Before you write a video, fetch https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json and use it only when that answers with the video; never invent or guess an id, and leave demo null when you have no checked video.',
	"An agent never changes a log or a measurement the user wrote, and never removes one; the user does that on the Sport page.",
].join("\n");

/** `value` as the JSON it names: a model sometimes sends an object parameter as its JSON text. */
function jsonParam(name: string, value: unknown): unknown {
	if (typeof value !== "string") return value;
	const parsed = parseJson(value);
	if (parsed === undefined) throw new Error(`${name} is not valid JSON.`);
	return parsed;
}

/** `sport.json` with the changes its inbox still holds, oldest first, as the dashboard will apply them. */
export const readSport = ({ file, inbox: dir }: SportPaths): SportState => withAgentChanges(parseSportState(parseJson(readText(file))) ?? EMPTY_SPORT, inbox<object>(dir).waiting());

/** One day of the week as the `week` action shows it: its phase by name, and each exercise without its rule and demo. */
const dayView = ({ phase, workouts, ...day }: PlannedDay) => ({
	...day,
	phase: phase?.name ?? null,
	workouts: workouts.map(({ blocks, log, ...workout }) => ({
		...workout,
		log: log && { id: log.id, status: log.status },
		blocks: blocks.map(({ title, items }) => ({
			title,
			items: items.map(({ exercise: { key, name, sets, reps, holdSec, restSec, hang, note }, load, removed }) => ({ key, name, sets, reps, holdSec, restSec, hang, note, load, removed })),
		})),
	})),
});

/** The `set-metrics` change that adds or replaces the metrics in `given`, by id, keeping the others. */
function metricsChange(state: SportState, given: unknown): object {
	const list = jsonParam("metrics", given);
	if (!Array.isArray(list)) throw new Error("metrics must be a list of metrics.");
	const byId = new Map(list.flatMap(metric => (isObject(metric) ? [[metric.id, metric] as const] : [])));
	const added = list.filter(metric => !isObject(metric) || !state.metrics.some(({ id }) => id === metric.id));
	return { op: "set-metrics", metrics: [...state.metrics.map(metric => byId.get(metric.id) ?? metric), ...added] };
}

/** Leaves `changes` in order, once each one passes against the state the ones before it leave. */
function leaveAll(paths: SportPaths, state: SportState, changes: object[]): void {
	changes.reduce<SportState>((next, value) => {
		const change = agentSportChange(next, value);
		if ("error" in change) throw new Error(`The change was refused, so nothing was left for the dashboard: ${change.error}.`);
		return applySport(next, change.ok);
	}, state);
	for (const change of changes) inbox<object>(paths.inbox).leave(change);
}

/** The entry `given` describes, merged over the one an agent wrote when `given.id` names it, or a new one in `sessionId`'s name. */
function entryOf<T extends { id: string; addedBy: string | null }>(name: string, given: unknown, stored: T[], defaults: object, sessionId: string): { entry: object; id: string; edit: boolean } {
	const fields = jsonParam(name, given);
	if (!isObject(fields)) throw new Error(`${name} must be an object.`);
	if (fields.id === undefined) {
		const id = randomUUID();
		return { entry: { ...defaults, ...fields, id, addedBy: sessionId }, id, edit: false };
	}
	const old = stored.find(({ id }) => id === fields.id);
	if (!old) throw new Error(`No ${name} has id ${String(fields.id)}; leave id out to add one.`);
	return { entry: { ...old, ...fields, addedBy: old.addedBy }, id: old.id, edit: true };
}

/** The line a personal turn's prompt carries for today when there is a plan: the phase, the workouts, and the pain flags. */
export function todayLine(state: SportState, day: string): string | null {
	if (!state.plan) return null;
	const { phase, deload, workouts } = dayPlan(state, day);
	const flags = painFlags(state, day);
	const line = [
		`Today ${day}, sport: ${phase ? `phase ${phase.name}${deload ? ", deload week" : ""}` : "no phase"}`,
		workouts.length === 0 ? "rest day" : workouts.map(({ name, optional, log }) => `${name}${optional ? " (optional)" : ""}${log ? ` (${log.status})` : ""}`).join(", "),
		flags.length === 0 ? "no pain flag" : `pain flags: ${flags.map(({ where, level, until }) => `${where} ${level}/10 until ${until}`).join(", ")}`,
	].join("; ");
	return line.length < 299 ? `${line}.` : `${line.slice(0, 298)}…`;
}

/** The `sport` tool; `pathsOf` names the paths for the session calling it, or throws why it has none. */
export function sportTool(pi: ExtensionApi, pathsOf: (ctx: ToolContext) => SportPaths): ExtensionTool<SportParams> {
	const { Type } = pi.typebox;
	const object = (description: string) => Type.Optional(Type.Unknown({ description }));
	return {
		name: SPORT_TOOL,
		label: "Sport",
		description: DESCRIPTION,
		parameters: Type.Object({
			action: Type.Union(
				ACTIONS.map(action => Type.Literal(action)),
				{ description: "What to do." },
			),
			date: Type.Optional(Type.String({ description: "week: a day of the week to show, YYYY-MM-DD; today when left out." })),
			metric: Type.Optional(Type.String({ description: "history: the metric id." })),
			log: object("log: the workout log, with id only to edit one an agent wrote."),
			measurement: object("measure: the measurement, with id only to edit one an agent wrote."),
			plan: object("set_plan: the whole plan, or null to clear it."),
			targets: object("set_targets: the whole list of targets."),
			metrics: object("set_plan, set_targets, measure: metrics to add or replace by id before the change."),
		}),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const paths = pathsOf(ctx);
			const state = readSport(paths);
			const sessionId = ctx.sessionManager.getSessionId();
			const withMetrics = (change: object): object[] => (params.metrics === undefined ? [change] : [metricsChange(state, params.metrics), change]);
			switch (params.action) {
				case "read":
					return reply(JSON.stringify(state));
				case "week": {
					const date = params.date ?? localDay();
					return reply(JSON.stringify({ painFlags: painFlags(state, date), days: weekPlan(state, date).map(dayView) }));
				}
				case "history": {
					const metric = state.metrics.find(({ id }) => id === params.metric);
					if (!metric) throw new Error(`metric must be one of ${state.metrics.map(({ id }) => id).join(", ") || "the metrics, and there are none yet"}.`);
					const data = state.measurements.filter(entry => entry.metric === metric.id).map(({ at, value }) => ({ at, value }));
					if (data.length === 0) return reply(`${metric.label} has no measurement yet.`);
					const title = metric.unit ? `${metric.label} (${metric.unit})` : metric.label;
					return reply(`Draw it with this in a \`\`\`chart block:\n${JSON.stringify({ type: "line", title, x: "at", series: [{ key: "value", label: metric.label }], data: data.slice(-MAX_CHART_ROWS) })}`);
				}
				case "log": {
					const { entry, id, edit } = entryOf("log", params.log, state.log, { date: localDay() }, sessionId);
					leaveAll(paths, state, [{ op: edit ? "edit-log" : "add-log", log: entry }]);
					return reply(`${edit ? "Changed" : "Logged"} workout log ${id}. ${APPLIES}`);
				}
				case "measure": {
					const { entry, id, edit } = entryOf("measurement", params.measurement, state.measurements, { at: localDay() }, sessionId);
					leaveAll(paths, state, withMetrics({ op: edit ? "edit-measurement" : "add-measurement", measurement: entry }));
					return reply(`${edit ? "Changed" : "Added"} measurement ${id}. ${APPLIES}`);
				}
				case "set_plan": {
					if (params.plan === undefined) throw new Error("set_plan needs plan, the whole plan, or null to clear it.");
					const plan = jsonParam("plan", params.plan);
					const bytes = Buffer.byteLength(JSON.stringify(plan));
					if (bytes > MAX_PLAN_BYTES) throw new Error(`plan is ${bytes} bytes as JSON; keep it to at most ${MAX_PLAN_BYTES}. Nothing was left for the dashboard.`);
					leaveAll(paths, state, withMetrics({ op: "set-plan", plan }));
					return reply(`${plan === null ? "Cleared the plan" : "Saved the plan"}. ${APPLIES}`);
				}
				case "set_targets":
					leaveAll(paths, state, withMetrics({ op: "set-targets", targets: jsonParam("targets", params.targets) }));
					return reply(`Saved the targets. ${APPLIES}`);
				default: {
					const never: never = params.action;
					throw new Error(`action must be one of ${ACTIONS.join(", ")}, not ${String(never)}.`);
				}
			}
		},
	};
}
