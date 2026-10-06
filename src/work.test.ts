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

function fold(...entries: unknown[]): Work {
	const work = new Work();
	for (const entry of entries) work.applyEntry(entry);
	return work;
}

describe("Work", () => {
	test("changed files keep first-touch order and every change, with its time and the lines it added and removed", () => {
		const work = fold(
			{ type: "session", cwd: "/repo" },
			result("edit", { path: "/repo/src/a.ts", diff: "+1|a" }, { timestamp: "2026-10-04T10:00:00.000Z" }),
			result("write", { resolvedPath: "/repo/README.md" }),
			result("edit", { path: "/repo/src/a.ts", diff: " 1|x\n-2|a\n+2|b\n\n+9|c" }),
			result("edit", { path: "/repo/src/a.ts", diff: "+2|c" }, { isError: true }),
			result("write", { resolvedPath: `${HOME}/notes.md` }),
		);
		expect(work.files()).toEqual([
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
		const [created, rewritten] = work.files();
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
		expect(work.files()).toEqual([
			{ path: "x.ts", changes: [edited("+1|x", 1, 0)] },
			{ path: "y.ts", changes: [edited(null, 0, 0)] },
		]);
	});
});
