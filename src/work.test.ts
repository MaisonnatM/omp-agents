import { describe, expect, test } from "bun:test";
import { HOME } from "./paths";
import { Work } from "./work";

const result = (toolName: string, details: unknown, isError = false) => ({
	type: "message",
	message: { role: "toolResult", toolCallId: `c-${toolName}`, toolName, details, isError },
});
const phase = (name: string, ...tasks: [string, string][]) => ({ name, tasks: tasks.map(([content, status]) => ({ content, status })) });

function fold(...entries: unknown[]): Work {
	const work = new Work();
	for (const entry of entries) work.applyEntry(entry);
	return work;
}

describe("Work", () => {
	test("the latest todo list wins, whether the agent's todo call or the user's edit in omp wrote it", () => {
		const work = fold(
			result("todo", { op: "init", phases: [phase("Build", ["Write it", "pending"])] }),
			result("todo", { op: "start", phases: [phase("Build", ["Write it", "in_progress"])] }),
			{ type: "custom", customType: "user_todo_edit", data: { phases: [phase("Build", ["Write it", "completed"]), phase("Ship", ["Merge", "pending"])] } },
		);
		expect(work.snapshot().phases).toEqual([
			{ name: "Build", tasks: [{ content: "Write it", status: "completed" }] },
			{ name: "Ship", tasks: [{ content: "Merge", status: "pending" }] },
		]);

		work.applyEntry(result("todo", { op: "drop", phases: [phase("Build", ["Write it", "abandoned"])] }));
		expect(work.snapshot().phases).toEqual([{ name: "Build", tasks: [{ content: "Write it", status: "abandoned" }] }]);
	});

	test("a todo view, a failed todo call, or a malformed list leaves the plan as it was", () => {
		const plan = [phase("Build", ["Write it", "in_progress"])];
		const work = fold(result("todo", { op: "init", phases: plan }));
		expect(work.applyEntry(result("todo", { op: "view", phases: [] }))).toBe(false);
		expect(work.applyEntry(result("todo", { op: "done", phases: [phase("Build", ["Write it", "completed"])] }, true))).toBe(false);
		expect(work.applyEntry(result("todo", { op: "done", phases: [phase("Build", ["Write it", "finished"])] }))).toBe(false);
		expect(work.snapshot().phases).toEqual([{ name: "Build", tasks: [{ content: "Write it", status: "in_progress" }] }]);
	});

	test("changed files keep first-touch order, count each change, and keep the latest diff", () => {
		const work = fold(
			{ type: "session", cwd: "/repo" },
			result("edit", { path: "/repo/src/a.ts", diff: "+1|a" }),
			result("write", { resolvedPath: "/repo/README.md" }),
			result("edit", { path: "/repo/src/a.ts", diff: "-1|a\n+1|b" }),
			result("edit", { path: "/repo/src/a.ts", diff: "+2|c" }, true),
			result("write", { resolvedPath: `${HOME}/notes.md` }),
		);
		expect(work.snapshot().files).toEqual([
			{ path: "src/a.ts", edits: 2, diff: "-1|a\n+1|b" },
			{ path: "README.md", edits: 1, diff: null },
			{ path: "~/notes.md", edits: 1, diff: null },
		]);
	});

	test("a multi-file edit counts once per file it lists, and a write to a device changes no file", () => {
		const work = fold(
			{ type: "session", cwd: "/repo" },
			result("edit", { diff: "+1|x\n+1|y", perFileResults: [{ path: "/repo/x.ts", diff: "+1|x" }, { path: "/repo/y.ts", diff: "" }] }),
			result("write", { message: { op: "send", to: "Main" } }),
		);
		expect(work.snapshot().files).toEqual([
			{ path: "x.ts", edits: 1, diff: "+1|x" },
			{ path: "y.ts", edits: 1, diff: null },
		]);
	});
});
