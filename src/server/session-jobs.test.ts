import { describe, expect, test } from "bun:test";
import { SessionJobs } from "./session-jobs";

const start = (toolCallId: string, command: string) => ({ type: "tool_execution_start", toolCallId, toolName: "bash", args: { command } });
const frame = (toolCallId: string, command: string, state: string, text: string) => ({
	type: "tool_execution_update",
	toolCallId,
	toolName: "bash",
	args: { command },
	partialResult: { content: [{ type: "text", text }], details: { async: { state, jobId: "bg_1", type: "bash" } } },
});

function jobs() {
	let now = 1000;
	const tracker = new SessionJobs(() => now);
	return { tracker, tick: (ms: number) => (now += ms) };
}

describe("SessionJobs", () => {
	test("lists a backgrounded job from its start time, with its output's last non-empty lines", () => {
		const { tracker, tick } = jobs();
		expect(tracker.heard("s", start("c1", "bun x.ts"))).toBe(false);
		tick(500);
		expect(tracker.heard("s", frame("c1", "bun x.ts", "running", "a\n\n\x1b[32mb 1/3\x1b[0m\n"))).toBe(true);
		expect(tracker.all()).toEqual({ s: [{ id: "bg_1", command: "bun x.ts", startedAt: 1000, endedAt: null, state: "running", lines: ["a", "b 1/3"] }] });
	});

	test("keeps only the last 15 lines, and reports no change for the same output", () => {
		const { tracker } = jobs();
		const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
		tracker.heard("s", frame("c1", "x", "running", text));
		expect(tracker.all().s[0].lines).toHaveLength(15);
		expect(tracker.all().s[0].lines[0]).toBe("line 5");
		expect(tracker.heard("s", frame("c1", "x", "running", text))).toBe(false);
	});

	test("a job that exits 0 is done, one that exits otherwise failed, and it stays listed", () => {
		const { tracker, tick } = jobs();
		tracker.heard("s", frame("c1", "x", "running", "1/2"));
		tick(2000);
		expect(tracker.heard("s", frame("c1", "x", "completed", "2/2"))).toBe(true);
		expect(tracker.all().s[0]).toMatchObject({ state: "done", endedAt: 3000, lines: ["2/2"] });
		expect(tracker.heard("s", frame("c1", "x", "running", "late"))).toBe(false);

		const failing = new SessionJobs(() => 0);
		failing.heard("s", frame("c2", "y", "running", "go"));
		failing.heard("s", frame("c2", "y", "failed", "boom\nexit code 1"));
		expect(failing.all().s[0]).toMatchObject({ state: "failed", lines: ["boom", "exit code 1"] });
	});

	test("leaves out the eval harness, whose runs show as subagents, and frames of foreground calls", () => {
		const { tracker } = jobs();
		expect(tracker.heard("s", frame("c1", "bun scripts/evals/run.ts --jobs 4", "running", "1/60"))).toBe(false);
		expect(tracker.heard("s", { type: "tool_execution_update", toolCallId: "c2", toolName: "bash", args: { command: "x" }, partialResult: { content: [], details: {} } })).toBe(false);
		expect(tracker.all()).toEqual({});
	});

	test("forgets a session that left", () => {
		const { tracker } = jobs();
		tracker.heard("s", frame("c1", "x", "running", "go"));
		expect(tracker.forget("s")).toBe(true);
		expect(tracker.all()).toEqual({});
	});
});
