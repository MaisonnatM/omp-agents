import { describe, expect, test } from "bun:test";
import type { TodoPhase, TodoTask } from "../src/shared/transcript";
import { countLabel, shipStep, todoTally } from "./todos-card-model";

const tasks = (...statuses: TodoTask["status"][]): TodoPhase[] => [{ name: "Work", tasks: statuses.map((status, index) => ({ content: `Task ${index + 1}`, status })) }];

describe("shipStep", () => {
	test("numbers the current stage as the stepper does, and is null once merged", () => {
		expect(shipStep({ stage: "ticket" })).toBe("Step 1 of 9");
		expect(shipStep({ stage: "live" })).toBe("Step 8 of 9");
		expect(shipStep({ stage: "merged" })).toBeNull();
	});
});

describe("todoTally", () => {
	test("counts done and dropped tasks as done, and finds the task in progress", () => {
		const tally = todoTally(tasks("completed", "abandoned", "in_progress", "pending"));
		expect(tally).toMatchObject({ count: "2/4", done: 2, total: 4 });
		expect(tally.current?.content).toBe("Task 3");
	});

	test("has no current task while none is in progress", () => {
		expect(todoTally(tasks("completed", "pending")).current).toBeUndefined();
	});
});

describe("countLabel", () => {
	test("names one in the singular and any other count in the plural", () => {
		expect(countLabel(1, "File", "Files")).toBe("1 File");
		expect(countLabel(7, "File", "Files")).toBe("7 Files");
		expect(countLabel(0, "File", "Files")).toBe("0 Files");
	});
});
