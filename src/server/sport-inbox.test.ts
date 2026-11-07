import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Metric, SportState } from "../shared/sport";
import { applySport } from "../sport";
import { MAX_PLAN_BYTES } from "../sport-agent";
import { log, measurement, STATE, withLogs } from "../sport-fixtures";
import { SportInbox } from "./sport-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function inboxDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-inbox-"));
	dirs.push(dir);
	mkdirSync(join(dir, "sport-inbox"));
	return join(dir, "sport-inbox");
}

/** An inbox over `start`, which applies each change to the state it reads the next file against, as the dashboard's sport file does. */
function inboxOver(dir: string, start: SportState, active?: () => boolean) {
	let state = start;
	const inbox = new SportInbox(
		dir,
		() => state,
		change => {
			state = applySport(state, change);
		},
		active && { active },
	);
	return { inbox, state: () => state };
}

/** Writes the request one `sport` tool call leaves, as file `name`. */
const leave = (dir: string, name: string, change: unknown, metrics: Metric[] = []) => writeFileSync(join(dir, name), JSON.stringify({ metrics, change }));

const GRIP: Metric = { id: "grip", label: "Pince", unit: "kg", better: "higher" };

describe("SportInbox", () => {
	test("applies an agent's requests oldest first, each edit merged over the entry as the ones before it leave it", async () => {
		const dir = inboxDir();
		leave(dir, "2-x.json", { op: "add-log", log: log("a", "2026-11-17", { addedBy: "s1" }) });
		leave(dir, "1-x.json", { op: "add-measurement", measurement: { ...measurement("g1", "grip", 50, "2026-11-17"), addedBy: "s1" } }, [GRIP]);
		leave(dir, "3-x.json", { op: "edit-log", id: "a", fields: { rpe: 7 } });
		leave(dir, "4-x.json", { op: "edit-log", id: "a", fields: { note: "Bonne séance" } });
		const { inbox, state } = inboxOver(dir, STATE);
		await inbox.drain();
		expect(state().metrics).toEqual([...STATE.metrics, GRIP]);
		expect(state().measurements.at(-1)).toEqual({ ...measurement("g1", "grip", 50, "2026-11-17"), addedBy: "s1" });
		expect(state().log).toEqual([log("a", "2026-11-17", { rpe: 7, note: "Bonne séance", addedBy: "s1" })]);
		expect(readdirSync(dir)).toEqual([]);
	});

	test("sets aside each request an agent may not make, whole and with its reason", async () => {
		const errors = spyOn(console, "error").mockImplementation(() => {});
		const dir = inboxDir();
		const start = withLogs(STATE, log("mine", "2026-11-16"), log("theirs", "2026-11-16", { addedBy: "s1" }));
		const plan = { ...STATE.plan, title: "x".repeat(MAX_PLAN_BYTES) };
		leave(dir, "1-x.json", { op: "remove-log", id: "mine" });
		leave(dir, "2-x.json", { op: "edit-log", id: "mine", fields: { rpe: 9 } });
		leave(dir, "3-x.json", { op: "add-log", log: log("b", "2026-11-17") });
		leave(dir, "4-x.json", { op: "add-measurement", measurement: { ...measurement("g1", "grip", 50, "2026-11-17"), addedBy: "s1" } });
		leave(dir, "5-x.json", { op: "set-metrics", metrics: [GRIP] }, [GRIP]);
		leave(dir, "6-x.json", { op: "edit-log", id: "ghost", fields: { rpe: 3 } });
		leave(dir, "7-x.json", { op: "add-log", log: log("theirs", "2026-11-16", { rpe: 4, addedBy: "s2" }) });
		leave(dir, "8-x.json", { op: "edit-log", id: "theirs", fields: { addedBy: "s2" } });
		leave(dir, "9-x.json", { op: "set-plan", plan });
		writeFileSync(join(dir, "10-x.json"), "{not json");
		const { inbox, state } = inboxOver(dir, start);
		await inbox.drain();
		expect(state()).toEqual(start);
		const names = Array.from({ length: 10 }, (_, i) => `${i + 1}-x.json`);
		expect(readdirSync(dir).toSorted()).toEqual(names.map(name => `${name}.invalid`).toSorted());
		const reasons = Object.fromEntries(errors.mock.calls.map(([line]) => String(line).match(/(\d+-x\.json): (.*)$/)?.slice(1) ?? []));
		errors.mockRestore();
		expect(reasons).toMatchObject({
			"1-x.json": "an agent may not remove a log; only the Sport page removes or restores one",
			"2-x.json": "workout log mine was written by the user, so an agent may not change it",
			"3-x.json": "an agent's workout log must name the session that added it",
			"4-x.json": "it names a metric not in the metrics list, grip; add it to the metrics first",
			"5-x.json": "an agent passes metrics beside its change, added or replaced by id, never the whole list",
			"6-x.json": "no workout log has id ghost; leave id out to add one",
			"7-x.json": "workout log theirs exists already; leave id out to add one, or edit it",
			"8-x.json": "workout log theirs was added by s1, which an edit may not change",
			"9-x.json": `the plan is ${Buffer.byteLength(JSON.stringify(plan))} bytes as JSON; keep it to at most ${MAX_PLAN_BYTES}`,
		});
		expect(Object.keys(reasons).toSorted()).toEqual(names.toSorted());
	});

	test("a request it applied already applies again as nothing and is deleted", async () => {
		const dir = inboxDir();
		const start = withLogs(STATE, log("a", "2026-11-17", { rpe: 7, addedBy: "s1" }));
		leave(dir, "1-x.json", { op: "add-log", log: log("a", "2026-11-17", { rpe: 7, addedBy: "s1" }) });
		leave(dir, "2-x.json", { op: "edit-log", id: "a", fields: { rpe: 7 } });
		const { inbox, state } = inboxOver(dir, start);
		await inbox.drain();
		expect(state()).toEqual(start);
		expect(readdirSync(dir)).toEqual([]);
	});

	test("a server that does not own the unattended work leaves the requests for the one that does", async () => {
		const dir = inboxDir();
		leave(dir, "1-x.json", { op: "add-log", log: log("a", "2026-11-17", { addedBy: "s1" }) });
		let owns = false;
		const { inbox, state } = inboxOver(dir, STATE, () => owns);
		await inbox.drain();
		expect(readdirSync(dir)).toEqual(["1-x.json"]);
		owns = true;
		await inbox.drain();
		expect(state().log).toHaveLength(1);
		expect(readdirSync(dir)).toEqual([]);
	});
});
