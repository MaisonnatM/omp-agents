import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SportState } from "../shared/sport";
import { applySport } from "../sport";
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

/** An inbox over `start`, which applies each change to the state it reads the next one against, as the dashboard's sport file does. */
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

const GRIP = { id: "grip", label: "Pince", unit: "kg", better: "higher" } as const;

describe("SportInbox", () => {
	test("applies an agent's changes oldest first, each against the state the ones before it leave", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ op: "add-measurement", measurement: { ...measurement("g1", "grip", 50, "2026-11-17"), addedBy: "s1" } }));
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ op: "set-metrics", metrics: [...STATE.metrics, GRIP] }));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ op: "add-log", log: log("a", "2026-11-17", { addedBy: "s1" }) }));
		writeFileSync(join(dir, "4-x.json"), JSON.stringify({ op: "edit-log", log: log("a", "2026-11-17", { rpe: 7, addedBy: "s1" }) }));
		const { inbox, state } = inboxOver(dir, STATE);
		await inbox.drain();
		expect(state().metrics).toEqual([...STATE.metrics, GRIP]);
		expect(state().measurements.at(-1)).toEqual({ ...measurement("g1", "grip", 50, "2026-11-17"), addedBy: "s1" });
		expect(state().log).toEqual([log("a", "2026-11-17", { rpe: 7, addedBy: "s1" })]);
		expect(readdirSync(dir)).toEqual([]);
	});

	test("sets aside a removal, a change to the user's log, an add in no session's name, a change naming an unknown metric, and a file that is not a change, each with its reason", async () => {
		const errors = spyOn(console, "error").mockImplementation(() => {});
		const dir = inboxDir();
		const start = withLogs(STATE, log("mine", "2026-11-16"));
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ op: "remove-log", id: "mine" }));
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ op: "edit-log", log: log("mine", "2026-11-16", { rpe: 9, addedBy: "s1" }) }));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ op: "add-log", log: log("b", "2026-11-17") }));
		writeFileSync(join(dir, "4-x.json"), JSON.stringify({ op: "add-measurement", measurement: { ...measurement("g1", "grip", 50, "2026-11-17"), addedBy: "s1" } }));
		writeFileSync(join(dir, "5-x.json"), JSON.stringify({ op: "set-metrics", metrics: [STATE.metrics[1]] }));
		writeFileSync(join(dir, "6-x.json"), "{not json");
		const { inbox, state } = inboxOver(dir, start);
		await inbox.drain();
		expect(state()).toEqual(start);
		expect(readdirSync(dir).sort()).toEqual(["1-x.json.invalid", "2-x.json.invalid", "3-x.json.invalid", "4-x.json.invalid", "5-x.json.invalid", "6-x.json.invalid"]);
		const reasons = Object.fromEntries(errors.mock.calls.map(([line]) => String(line).match(/(\d-x\.json): (.*)$/)?.slice(1) ?? []));
		errors.mockRestore();
		expect(reasons).toMatchObject({
			"1-x.json": "an agent may not remove a log; only the Sport page removes or restores one",
			"2-x.json": "workout log mine was written by the user, so an agent may not change it",
			"3-x.json": "an agent's workout log must name the session that added it",
			"4-x.json": "it names a metric not in the metrics list, grip; add it to the metrics first",
			"5-x.json": "it drops metrics a measurement, a target, or a load rule still names, max",
		});
		expect(Object.keys(reasons).toSorted()).toEqual(["1-x.json", "2-x.json", "3-x.json", "4-x.json", "5-x.json", "6-x.json"]);
	});

	test("a server that does not own the unattended work leaves the changes for the one that does", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ op: "add-log", log: log("a", "2026-11-17", { addedBy: "s1" }) }));
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
