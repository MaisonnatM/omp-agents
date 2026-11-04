import { describe, expect, test } from "bun:test";
import type { TodoPhase, TodoTask } from "../src/shared/transcript";
import { shipStep, stripSummary } from "./todos-strip-model";

const tasks = (...statuses: TodoTask["status"][]): TodoPhase[] => [{ name: "Work", tasks: statuses.map((status, index) => ({ content: `Task ${index + 1}`, status })) }];
const none = { ship: null, phases: [], subagents: 0, files: 0, images: 0, sources: 0 };

describe("stripSummary", () => {
	test("with /ship, leads with the stage and the stepper's step, then each section's count in its header's words", () => {
		expect(stripSummary({ ...none, ship: { stage: "live" }, files: 7, images: 1, sources: 1 })).toEqual({
			lead: { kind: "ship", stage: "Live review", work: null, step: "step 8 of 9" },
			counts: ["7 Files", "1 Image", "1 Source"],
		});
		expect(shipStep({ stage: "live" })).toBe("Step 8 of 9");
	});

	test("says the /ship run's work, and no step once merged", () => {
		expect(stripSummary({ ...none, ship: { stage: "live", work: "fix_comments" } })?.lead).toEqual({ kind: "ship", stage: "Live review", work: "Fixing review comments", step: "step 8 of 9" });
		expect(stripSummary({ ...none, ship: { stage: "merged" } })?.lead).toEqual({ kind: "ship", stage: "Merged", work: null, step: null });
	});

	test("without /ship, leads with the task in progress and counts done and dropped tasks as done", () => {
		expect(stripSummary({ ...none, phases: tasks("completed", "abandoned", "in_progress", "pending"), subagents: 1, files: 2 })).toEqual({
			lead: { kind: "task", markdown: "Task 3" },
			counts: ["Todos 2/4", "1 Subagent", "2 Files"],
		});
	});

	test("with no task in progress, leads with the first count", () => {
		expect(stripSummary({ ...none, phases: tasks("completed", "completed"), images: 3 })).toEqual({ lead: { kind: "count", text: "Todos 2/2" }, counts: ["3 Images"] });
		expect(stripSummary({ ...none, files: 30, images: 51 })).toEqual({ lead: { kind: "count", text: "30 Files" }, counts: ["51 Images"] });
	});

	test("is null while no section has anything to show", () => {
		expect(stripSummary(none)).toBeNull();
	});
});
