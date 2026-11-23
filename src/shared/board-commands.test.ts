import { describe, expect, test } from "bun:test";
import { applyBoardChange, BOARD_COMMANDS, type BoardChange, commandChanges, emptyBoard, HOUR, LEASE_MS, type Member, MIN, type Thread } from "./board";

const me = emptyBoard("Maxence").extraMembers[0]!;
const agent: Member = { ...me, id: "s-1", name: "api2", kind: "agent", initials: undefined };
const members = [me, agent];
const thread: Thread = { id: "t-1", channel: "c-general", title: "Fix login", task: "open", lease: null, createdAt: 1 };
const now = 1_000_000;

function run(name: string, arg: string, on: Thread = thread): BoardChange[] {
	let n = 0;
	return commandChanges({ members, me: me.id, thread: on, command: BOARD_COMMANDS.find(item => item.name === name)!, arg, now, newId: () => `id-${++n}` });
}

describe("commandChanges", () => {
	test("/claim leases the task for an hour and says so", () => {
		expect(run("claim", "")).toEqual([
			{ op: "task", thread: "t-1", task: "claimed", lease: { by: me.id, until: now + LEASE_MS } },
			{ op: "post", message: { id: "id-1", thread: "t-1", author: me.id, at: now, text: "Claimed. Lease 1h." } },
		]);
	});

	test("/done settles the task and posts its note", () => {
		expect(run("done", "Shipped")).toEqual([
			{ op: "task", thread: "t-1", task: "done", lease: null },
			{ op: "post", message: { id: "id-1", thread: "t-1", author: me.id, at: now, text: "Shipped" } },
		]);
	});

	test("/schedule in 10m posts once, with the mention stripped and the name kept", () => {
		const [schedule] = run("schedule", "@API2 check the deploy in 10m");
		expect(schedule).toEqual({ op: "schedule", schedule: { id: "id-1", thread: "t-1", by: me.id, to: "s-1", toName: "api2", text: "check the deploy", at: now + 10 * MIN, every: null } });
	});

	test("/schedule every 2h repeats", () => {
		const [schedule] = run("schedule", "@api2 every 2h status");
		expect(schedule).toMatchObject({ schedule: { text: "status", at: now + 2 * HOUR, every: 2 * HOUR } });
	});

	test("/schedule without a mention only leaves an internal note", () => {
		expect(run("schedule", "later")).toEqual([{ op: "post", message: { id: "id-1", thread: "t-1", author: me.id, at: now, text: "/schedule needs an @member to post to.", internal: true } }]);
	});

	test("a workflow without a mention goes to the agent holding the lease", () => {
		const [posted] = run("review", "", { ...thread, task: "claimed", lease: { by: "s-1", until: now + HOUR } });
		expect(posted).toMatchObject({ op: "post", message: { text: "/review @api2", attachment: { kind: "workflow", command: "/review" } } });
	});

	test("an all change applies every change or none", () => {
		const board = applyBoardChange(emptyBoard("Maxence"), { op: "thread", thread });
		if (!("ok" in board)) throw new Error(board.error);
		const changes = run("claim", "");
		expect(applyBoardChange(board.ok, { op: "all", changes: [...changes, { op: "task", thread: "t-missing", task: null, lease: null }] })).toEqual({ error: "No thread t-missing." });
		const applied = applyBoardChange(board.ok, { op: "all", changes });
		expect("ok" in applied && applied.ok.threads[0]!.task).toBe("claimed");
	});
});
