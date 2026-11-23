import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstRequest, namedSessionFiles, survivingCheckout } from "./replay-sessions";

const dir = mkdtempSync(join(tmpdir(), "omp-replay-sessions-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("named sessions are found by their full id or its last 8 characters, in every cwd folder, not in subagent folders", () => {
	const full = "01a208b0-2005-70c5-8134-a790587b5d43";
	const other = "01a2086e-9ae6-771e-8f5f-08bd98ca820a";
	mkdirSync(join(dir, "-code-yampa", `2026-11-23T13-54-49-989Z_${full}`), { recursive: true });
	mkdirSync(join(dir, "-code-omp-agents"), { recursive: true });
	writeFileSync(join(dir, "-code-yampa", `2026-11-23T13-54-49-989Z_${full}.jsonl`), "");
	writeFileSync(join(dir, "-code-yampa", `2026-11-23T13-54-49-989Z_${full}`, "0-Worker.jsonl"), "");
	writeFileSync(join(dir, "-code-omp-agents", `2026-11-23T14-00-00-000Z_${other}.jsonl`), "");
	writeFileSync(join(dir, "-code-omp-agents", "2026-11-23T15-00-00-000Z_01a20000-0000-7000-8000-00000000000a.jsonl"), "");

	expect(namedSessionFiles(dir, [full, other.slice(-8)]).sort()).toEqual([
		join(dir, "-code-omp-agents", `2026-11-23T14-00-00-000Z_${other}.jsonl`),
		join(dir, "-code-yampa", `2026-11-23T13-54-49-989Z_${full}.jsonl`),
	]);
	expect(namedSessionFiles(join(dir, "missing"), [full])).toEqual([]);
});

test("a session's request is a subagent's task, a skill the user invoked, or the user's first message, with the words the user wrote", () => {
	const header = { type: "session", id: "x", cwd: "/repo" };
	const memory = { type: "custom_message", customType: "omp-agents.project-memory", content: "<project_memory>" };
	expect(firstRequest([header, { type: "session_init", agent: "task", task: "Fix the parser" }, { type: "message", message: { role: "user", content: "later" } }])).toEqual({ prompt: "Fix the parser", written: "Fix the parser" });
	const skill = { type: "custom_message", customType: "skill-prompt", content: "# poteto-mode\nWrite local://plan.md\nUser: ENG-3107", details: { name: "poteto-mode", args: "ENG-3107" } };
	expect(firstRequest([header, memory, skill])).toEqual({ prompt: "# poteto-mode\nWrite local://plan.md\nUser: ENG-3107", written: "ENG-3107" });
	expect(
		firstRequest([
			header,
			memory,
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
			{
				type: "message",
				message: {
					role: "user",
					content: [
						{ type: "text", text: "Ship the fix" },
						{ type: "image", data: "" },
						{ type: "text", text: "on main" },
					],
				},
			},
		]),
	).toEqual({ prompt: "Ship the fix\non main", written: "Ship the fix\non main" });
	expect(firstRequest([header, memory])).toBeNull();
});

test("a removed worktree's session replays from its repository", () => {
	const present = new Set(["/code/yampa", "/code/omp-agents-wt/live"]);
	const exists = (path: string) => present.has(path);
	expect(survivingCheckout("/code/omp-agents-wt/live", exists)).toBe("/code/omp-agents-wt/live");
	expect(survivingCheckout("/code/yampa-wt/eng-3107", exists)).toBe("/code/yampa");
	expect(survivingCheckout("/code/gone-wt/x", exists)).toBeNull();
	expect(survivingCheckout("/code/gone", exists)).toBeNull();
});
