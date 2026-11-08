import { describe, expect, test } from "bun:test";
import { TurnWaits } from "./turn-waits";

const start = (toolCallId: string, toolName: string) => ({ type: "tool_execution_start", toolCallId, toolName });
const end = (toolCallId: string, toolName: string) => ({ type: "tool_execution_end", toolCallId, toolName });

describe("TurnWaits", () => {
	test("a main agent sitting in a wait call alone waits", () => {
		const waits = new TurnWaits();
		waits.heard("i1", { type: "agent_start" });
		waits.heard("i1", start("c1", "wait"));
		expect(waits.waits("i1")).toBe(true);
		expect(waits.waits("i2")).toBe(false);
	});

	test("a main agent sitting in a task call alone waits", () => {
		const waits = new TurnWaits();
		waits.heard("i1", start("c1", "task"));
		expect(waits.waits("i1")).toBe(true);
	});

	test("a wait alongside a bash call running in parallel does not wait, until the bash call ends", () => {
		const waits = new TurnWaits();
		waits.heard("i1", start("c1", "wait"));
		waits.heard("i1", start("c2", "bash"));
		expect(waits.waits("i1")).toBe(false);
		waits.heard("i1", end("c2", "bash"));
		expect(waits.waits("i1")).toBe(true);
	});

	test("a turn that thinks between two waits keeps waiting, until a working tool starts", () => {
		const waits = new TurnWaits();
		waits.heard("i1", start("c1", "wait"));
		waits.heard("i1", end("c1", "wait"));
		expect(waits.waits("i1")).toBe(true);
		waits.heard("i1", start("c2", "wait"));
		waits.heard("i1", end("c2", "wait"));
		waits.heard("i1", start("c3", "read"));
		expect(waits.waits("i1")).toBe(false);
		waits.heard("i1", end("c3", "read"));
		expect(waits.waits("i1")).toBe(false);
	});

	test("the end of a turn forgets a wait call it cut off, which never reports its end", () => {
		const waits = new TurnWaits();
		waits.heard("i1", start("c1", "wait"));
		waits.heard("i1", end("c1", "wait"));
		waits.heard("i1", { type: "agent_end" });
		expect(waits.waits("i1")).toBe(false);
	});

	test("heard answers true only when the session's waiting flips", () => {
		const waits = new TurnWaits();
		expect(waits.heard("i1", { type: "agent_start" })).toBe(false);
		expect(waits.heard("i1", start("c1", "wait"))).toBe(true);
		expect(waits.heard("i1", { type: "message_update", toolCallId: "c9" })).toBe(false);
		expect(waits.heard("i1", start("c2", "task"))).toBe(false);
		expect(waits.heard("i1", start("c3", "read"))).toBe(true);
		expect(waits.heard("i1", end("c3", "read"))).toBe(true);
		expect(waits.heard("i1", end("c1", "wait"))).toBe(false);
		expect(waits.heard("i1", end("c2", "task"))).toBe(false);
		expect(waits.heard("i1", { type: "agent_end" })).toBe(true);
		expect(waits.heard("i1", "not an event")).toBe(false);
	});

	test("forget drops the session's calls", () => {
		const waits = new TurnWaits();
		waits.heard("i1", start("c1", "wait"));
		waits.heard("i2", start("c2", "wait"));
		waits.forget("i1");
		expect(waits.waits("i1")).toBe(false);
		expect(waits.waits("i2")).toBe(true);
	});
});
