import { afterEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_SPORT, type SportState } from "../shared/sport";
import { log, measurement, SEMI, STATE, withLogs } from "../sport-fixtures";
import { loadFor } from "../sport-week";
import { loadExtension } from "./fake-extension-api";
import { MAX_PLAN_BYTES, readSport, type SportParams, sportTool, todayLine } from "./sport-tool";

const dirs: string[] = [];
afterEach(() => {
	setSystemTime();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The `sport` tool of session `session-1`, over a sport file holding `state` and an empty inbox. */
function sport(state: SportState | null = STATE) {
	const root = mkdtempSync(join(tmpdir(), "omp-agents-sport-tool-"));
	dirs.push(root);
	const paths = { file: join(root, "sport.json"), inbox: join(root, "sport-inbox") };
	if (state) writeFileSync(paths.file, JSON.stringify(state));
	const session = loadExtension(pi => pi.registerTool(sportTool(pi, () => paths)), new Map());
	const call = async (params: SportParams) => (await session.call("sport", params)).content.map(({ text }) => text).join("\n");
	const left = () => readdirSync(paths.inbox).sort().map(name => JSON.parse(readFileSync(join(paths.inbox, name), "utf8")));
	return { paths, call, left, state: () => readSport(paths) };
}

test("a log is left for the dashboard in the session's name, and the next read already holds it", async () => {
	setSystemTime(new Date("2026-11-17T12:00:00"));
	const tool = sport();
	const text = await tool.call({ action: "log", log: { workout: "mardi", title: "Mardi", rpe: 8, loads: { semi: 16 } } });
	const [change] = tool.left();
	expect(change.op).toBe("add-log");
	expect(text).toBe(`Logged workout log ${change.log.id}. The dashboard applies it, and while the dashboard is stopped the change waits for it.`);
	const read: SportState = JSON.parse(await tool.call({ action: "read" }));
	expect(read.log).toEqual([log(change.log.id, "2026-11-17", { workout: "mardi", title: "Mardi", rpe: 8, loads: { semi: 16 }, addedBy: "session-1" })]);
});

test("an edit keeps the fields it leaves out and the log's author, and an edit of the user's log is refused with nothing left", async () => {
	const tool = sport(withLogs(STATE, log("mine", "2026-11-17"), log("agent", "2026-11-17", { rpe: 6, addedBy: "session-0" })));
	await tool.call({ action: "log", log: { id: "agent", note: "Doigts frais" } });
	expect(tool.state().log.find(({ id }) => id === "agent")).toEqual(log("agent", "2026-11-17", { rpe: 6, note: "Doigts frais", addedBy: "session-0" }));
	await expect(tool.call({ action: "log", log: { id: "mine", rpe: 9 } })).rejects.toThrow("workout log mine was written by the user, so an agent may not change it");
	await expect(tool.call({ action: "log", log: { id: "nobody" } })).rejects.toThrow("No log has id nobody; leave id out to add one.");
	expect(tool.left()).toHaveLength(1);
});

test("a log of the wrong shape is refused with the field and its rule", async () => {
	const tool = sport();
	await expect(tool.call({ action: "log", log: { date: "2026-11-17", rpe: 12 } })).rejects.toThrow("log.rpe");
	await expect(tool.call({ action: "log", log: "{not json" })).rejects.toThrow("log is not valid JSON.");
	expect(() => tool.left()).toThrow("ENOENT");
});

test("week shows each day's phase, workouts, and loads from the newest test, and the pain flags of the day", async () => {
	const tool = sport(withLogs(STATE, log("p", "2026-11-16", { pain: { level: 4, where: "elbow" } })));
	const { painFlags, days } = JSON.parse(await tool.call({ action: "week", date: "2026-11-19" }));
	expect(painFlags).toEqual([{ logId: "p", date: "2026-11-16", level: 4, where: "elbow", until: "2026-11-23" }]);
	expect(days.map(({ date, phase }: { date: string; phase: string }) => [date, phase])).toEqual(["16", "17", "18", "19", "20", "21", "22"].map(day => [`2026-11-${day}`, "transition"]));
	expect(days[1].workouts.map(({ id, kind }: { id: string; kind: string }) => [id, kind])).toEqual([["mardi", "hangboard"]]);
	const semi = days[1].workouts[0].blocks[1].items[0];
	expect(semi).toEqual({ key: "semi", name: SEMI.name, sets: 5, reps: null, holdSec: 10, restSec: 180, hang: true, note: "", load: loadFor(STATE, SEMI, "2026-11-17"), removed: false });
});

test("history draws a metric's measurements as a chart, and an unknown metric names the known ones", async () => {
	const tool = sport({ ...STATE, measurements: [...STATE.measurements, measurement("m3", "max", 117, "2026-11-17")] });
	const text = await tool.call({ action: "history", metric: "max" });
	expect(text).toBe(`Draw it with this in a \`\`\`chart block:\n${JSON.stringify({ type: "line", title: "Max total (kg)", x: "at", series: [{ key: "value", label: "Max total" }], data: [{ at: "2026-08-26", value: 112 }, { at: "2026-11-17", value: 117 }] })}`);
	await expect(tool.call({ action: "history", metric: "grip" })).rejects.toThrow("metric must be one of max, bodyweight.");
});

test("a measurement of a metric the state lacks is refused with its name, and passes once metrics adds it first", async () => {
	setSystemTime(new Date("2026-11-17T12:00:00"));
	const tool = sport();
	await expect(tool.call({ action: "measure", measurement: { metric: "grip", value: 50 } })).rejects.toThrow("it names a metric not in the metrics list, grip; add it to the metrics first");
	await tool.call({ action: "measure", measurement: { metric: "grip", value: 50 }, metrics: [{ id: "grip", label: "Pince", unit: "kg" }, { id: "max", label: "Max 10 s", unit: "kg" }] });
	expect(tool.left().map(({ op }) => op)).toEqual(["set-metrics", "add-measurement"]);
	const state = tool.state();
	expect(state.metrics).toEqual([{ id: "max", label: "Max 10 s", unit: "kg", better: "higher" }, STATE.metrics[1], { id: "grip", label: "Pince", unit: "kg", better: "higher" }]);
	expect(state.measurements.at(-1)).toMatchObject({ metric: "grip", value: 50, at: "2026-11-17", addedBy: "session-1" });
});

test("on a fresh state a plan needs its metrics, which set_plan takes along, and the targets follow", async () => {
	const tool = sport(null);
	await expect(tool.call({ action: "set_plan", plan: STATE.plan })).rejects.toThrow("add them to the metrics first");
	expect(() => tool.left()).toThrow("ENOENT");
	await tool.call({ action: "set_plan", plan: JSON.stringify(STATE.plan), metrics: STATE.metrics });
	await tool.call({ action: "set_targets", targets: STATE.targets });
	expect(tool.state()).toEqual({ ...EMPTY_SPORT, metrics: STATE.metrics, plan: STATE.plan, targets: STATE.targets });
	await expect(tool.call({ action: "set_plan" })).rejects.toThrow("set_plan needs plan, the whole plan, or null to clear it.");
	await tool.call({ action: "set_plan", plan: null });
	expect(tool.state().plan).toBeNull();
});

test("a plan with a workout that leaves out its kind is refused with the field, and nothing is left", async () => {
	const tool = sport();
	const plan = STATE.plan && { ...STATE.plan, workouts: STATE.plan.workouts.map(({ kind: _kind, ...workout }) => workout) };
	await expect(tool.call({ action: "set_plan", plan })).rejects.toThrow("plan.workouts[0].kind must be one of hangboard, boulder, route, hip, strength");
	expect(() => tool.left()).toThrow("ENOENT");
});

test("a plan over 64 KB is refused before anything is left", async () => {
	const tool = sport();
	const plan = { ...STATE.plan, title: "x".repeat(MAX_PLAN_BYTES) };
	await expect(tool.call({ action: "set_plan", plan })).rejects.toThrow(`keep it to at most ${MAX_PLAN_BYTES}. Nothing was left for the dashboard.`);
	expect(() => tool.left()).toThrow("ENOENT");
});

test("today's line names the phase, the deload, each workout and its log, and stays under 300 characters", () => {
	expect(todayLine({ ...STATE, plan: null }, "2026-11-17")).toBeNull();
	expect(todayLine(STATE, "2026-12-02")).toBe("Today 2026-12-02, sport: phase transition, deload week; Mobilité hanche; no pain flag.");
	expect(todayLine(withLogs(STATE, log("v", "2026-11-22", { workout: "voie", status: "skipped" })), "2026-11-22")).toBe("Today 2026-11-22, sport: phase transition; Voie (optional) (skipped); no pain flag.");
	expect(todayLine(STATE, "2027-03-01")).toBe("Today 2027-03-01, sport: no phase; rest day; no pain flag.");
	const flagged = withLogs(STATE, ...Array.from({ length: 20 }, (_, index) => log(`p${index}`, "2026-11-16", { pain: { level: 5, where: "shoulder" } })));
	const line = todayLine(flagged, "2026-11-17") ?? "";
	expect(line).toHaveLength(299);
	expect(line).toEndWith("…");
});
