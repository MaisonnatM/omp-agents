import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRoutine, type Routine, type RoutineSpec } from "../routines";
import type { BotId } from "../shared/bots";
import { RoutineInbox } from "./routine-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function inboxDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-inbox-"));
	dirs.push(dir);
	mkdirSync(join(dir, "routine-inbox"));
	return join(dir, "routine-inbox");
}

const SCOUT = "scout" as BotId;
const RELAY = "relay" as BotId;
const T0 = 1_000;
const spec = (id: string, botId: BotId, name: string): RoutineSpec => ({ id, botId, name, schedules: [{ kind: "every", minutes: 60 }], triggers: [], task: { kind: "prompt", prompt: "Check in." }, enabled: true });
const stored = (routine: RoutineSpec): Routine => ({ ...routine, createdAt: T0, scheduledAt: null, runs: [] });

/** An inbox over routines that start as `initial`, which each change it applies edits as the dashboard's would. */
function harness(dir: string, initial: Routine[], active = () => true) {
	let routines = initial;
	const inbox = new RoutineInbox(dir, () => routines, change => void (routines = applyRoutine(routines, change, T0)), { active });
	return { inbox, routines: () => routines };
}

describe("RoutineInbox", () => {
	test("applies a Bot's saves and removes of its own routines in order, and sets aside a change to another Bot's routine, a removal of a missing one, and garbage", async () => {
		const dir = inboxDir();
		const relayMail = stored(spec("r2", RELAY, "Relay mail"));
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "save", routine: spec("r1", SCOUT, "Standup") } }));
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "save", routine: spec("r1", SCOUT, "Daily standup") } }));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "save", routine: spec("r3", SCOUT, "Digest") } }));
		writeFileSync(join(dir, "4-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "remove", id: "r3" } }));
		writeFileSync(join(dir, "5-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "save", routine: spec("r4", RELAY, "Planted") } }));
		writeFileSync(join(dir, "6-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "save", routine: spec("r2", SCOUT, "Taken over") } }));
		writeFileSync(join(dir, "7-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "remove", id: "r2" } }));
		writeFileSync(join(dir, "8-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "remove", id: "r9" } }));
		writeFileSync(join(dir, "9-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "enable", id: "r1", enabled: false } }));
		writeFileSync(join(dir, "a-x.json"), "{not json");
		writeFileSync(join(dir, "b-x.tmp"), JSON.stringify({ botId: SCOUT, change: { op: "remove", id: "r1" } }));
		const { inbox, routines } = harness(dir, [relayMail]);
		await inbox.drain();
		expect(routines()).toEqual([relayMail, stored(spec("r1", SCOUT, "Daily standup"))]);
		expect(readdirSync(dir).sort()).toEqual(["5-x.json.invalid", "6-x.json.invalid", "7-x.json.invalid", "8-x.json.invalid", "9-x.json.invalid", "a-x.json.invalid", "b-x.tmp"]);
	});

	test("a server that does not own the unattended work leaves the changes for the one that does", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ botId: SCOUT, change: { op: "save", routine: spec("r1", SCOUT, "Standup") } }));
		let owns = false;
		const { inbox, routines } = harness(dir, [], () => owns);
		await inbox.drain();
		expect(readdirSync(dir)).toEqual(["1-x.json"]);
		expect(routines()).toEqual([]);
		owns = true;
		await inbox.drain();
		expect(routines()).toEqual([stored(spec("r1", SCOUT, "Standup"))]);
		expect(readdirSync(dir)).toEqual([]);
	});
});
