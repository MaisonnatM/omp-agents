import { describe, expect, test } from "bun:test";
import { workerPhase } from "./projects";

describe("workerPhase", () => {
	test("a live worker shows its status; a stopped one is interrupted unless it was ended", () => {
		expect(workerPhase("working", false)).toBe("working");
		expect(workerPhase("needs-input", false)).toBe("asking");
		expect(workerPhase("idle", true)).toBe("idle");
		expect(workerPhase(null, true)).toBe("interrupted");
		expect(workerPhase(null, false)).toBe("ended");
	});
});
