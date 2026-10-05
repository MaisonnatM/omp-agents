import { describe, expect, test } from "bun:test";
import { HOME } from "./paths";
import { type FileChange, lineTotals } from "./shared";
import { Work } from "./work";

/** A tool result; `Work` reads a write's path from `details.resolvedPath` and its lines from the matching {@link writeCall}. */
const result = (toolName: string, details: unknown, { isError = false, id = `c-${toolName}`, timestamp }: { isError?: boolean; id?: string; timestamp?: string } = {}) => ({
	type: "message",
	timestamp,
	message: { role: "toolResult", toolCallId: id, toolName, details, isError },
});
const writeCall = (id: string, content: string) => ({
	type: "message",
	message: { role: "assistant", content: [{ type: "toolCall", id, name: "write", arguments: { content } }] },
});
const edited = (diff: string | null, added: number, removed: number, at: number | null = null): FileChange => ({ tool: "edit", kind: "edited", at, added, removed, diff });
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
		expect(work.applyEntry(result("todo", { op: "done", phases: [phase("Build", ["Write it", "completed"])] }, { isError: true }))).toBe(false);
		expect(work.applyEntry(result("todo", { op: "done", phases: [phase("Build", ["Write it", "finished"])] }))).toBe(false);
		expect(work.snapshot().phases).toEqual([{ name: "Build", tasks: [{ content: "Write it", status: "in_progress" }] }]);
	});

	test("changed files keep first-touch order and every change, with its time and the lines it added and removed", () => {
		const work = fold(
			{ type: "session", cwd: "/repo" },
			result("edit", { path: "/repo/src/a.ts", diff: "+1|a" }, { timestamp: "2026-10-04T10:00:00.000Z" }),
			result("write", { resolvedPath: "/repo/README.md" }),
			result("edit", { path: "/repo/src/a.ts", diff: " 1|x\n-2|a\n+2|b\n\n+9|c" }),
			result("edit", { path: "/repo/src/a.ts", diff: "+2|c" }, { isError: true }),
			result("write", { resolvedPath: `${HOME}/notes.md` }),
		);
		expect(work.snapshot().files).toEqual([
			{ path: "src/a.ts", changes: [edited("+1|a", 1, 0, Date.parse("2026-10-04T10:00:00.000Z")), edited(" 1|x\n-2|a\n+2|b\n\n+9|c", 2, 1)] },
			{ path: "README.md", changes: [{ tool: "write", kind: "created", at: null, lines: null }] },
			{ path: "~/notes.md", changes: [{ tool: "write", kind: "created", at: null, lines: null }] },
		]);
	});

	test("a write creates a file the transcript never read or changed, else rewrites it, and counts the lines its call carried", () => {
		const work = fold(
			{ type: "session", cwd: "/repo" },
			writeCall("w1", "one\ntwo\n"),
			result("write", { resolvedPath: "/repo/new.ts" }, { id: "w1" }),
			result("read", { resolvedPath: "/repo/old.ts" }),
			writeCall("w2", "a\nb\nc"),
			result("write", { resolvedPath: "/repo/old.ts" }, { id: "w2" }),
			writeCall("w3", ""),
			result("write", { resolvedPath: "/repo/new.ts" }, { id: "w3" }),
			result("edit", { path: "/repo/new.ts", op: "delete", diff: "" }),
			writeCall("w4", "back"),
			result("write", { resolvedPath: "/repo/new.ts" }, { id: "w4" }),
		);
		const [created, rewritten] = work.snapshot().files;
		expect(created.path).toBe("new.ts");
		expect(created.changes).toEqual([
			{ tool: "write", kind: "created", at: null, lines: 2 },
			{ tool: "write", kind: "rewritten", at: null, lines: 0 },
			{ tool: "edit", kind: "deleted", at: null, added: 0, removed: 0, diff: null },
			{ tool: "write", kind: "created", at: null, lines: 1 },
		]);
		// A created file's writes add every line they wrote; a rewrite adds none, as omp records no diff of it.
		expect(lineTotals(created.changes)).toEqual({ added: 3, removed: 0 });
		expect(rewritten).toEqual({ path: "old.ts", changes: [{ tool: "write", kind: "rewritten", at: null, lines: 3 }] });
		expect(lineTotals(rewritten.changes)).toEqual({ added: 0, removed: 0 });
	});

	test("a multi-file edit counts once per file it changed, skipping files it failed on, and a write to a device changes no file", () => {
		const work = fold(
			{ type: "session", cwd: "/repo" },
			result("edit", {
				diff: "+1|x\n+1|y",
				perFileResults: [
					{ path: "/repo/x.ts", diff: "+1|x" },
					{ path: "/repo/y.ts", diff: "" },
					{ path: "/repo/z.ts", diff: "", isError: true },
				],
			}),
			result("write", { message: { op: "send", to: "Main" } }),
		);
		expect(work.snapshot().files).toEqual([
			{ path: "x.ts", changes: [edited("+1|x", 1, 0)] },
			{ path: "y.ts", changes: [edited(null, 0, 0)] },
		]);
	});

	test("the plan is the plan file changed last, until the agent deletes that one", () => {
		const work = fold(
			{ type: "session", cwd: "/repo" },
			result("write", { resolvedPath: "/s/local/auth-plan.md" }),
			result("write", { resolvedPath: "/repo/notes.md" }),
			result("edit", { path: "/repo/docs/PLAN.md", diff: "+1|# Ship" }),
		);
		expect(work.planFile).toBe("/repo/docs/PLAN.md");
		expect(work.snapshot("# Ship").plan).toEqual({ path: "docs/PLAN.md", text: "# Ship" });
		expect(work.snapshot(null).plan).toBeNull();

		const version = work.planVersion;
		work.applyEntry(result("edit", { path: "/repo/src/a.ts", diff: "+1|a" }));
		expect(work.planVersion).toBe(version);
		work.applyEntry(result("edit", { path: "/s/local/auth-plan.md", op: "delete", diff: "" }));
		expect([work.planFile, work.planVersion]).toEqual(["/repo/docs/PLAN.md", version + 1]);
		work.applyEntry(result("edit", { path: "/repo/docs/PLAN.md", op: "delete", diff: "" }));
		expect(work.planFile).toBeNull();
	});
});
