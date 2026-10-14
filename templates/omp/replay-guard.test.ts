import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDir } from "../../src/omp/install";
import { judgeReplayTool } from "./agent/extensions/replay/replay-policy";
import type { Inspector } from "./agent/extensions/replay/replay-policy";

const native: unknown = createRequire(join(packageDir, "package.json"))("@oh-my-pi/pi-natives");
if (!native || typeof native !== "object" || !("editInspect" in native) || typeof native.editInspect !== "function") throw new Error("Installed omp has no native edit inspector");
const inspect = native.editInspect as Inspector;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "replay-guard-")); dirs.push(dir);
	const worktree = join(dir, "replay"), original = join(dir, "original");
	mkdirSync(worktree); mkdirSync(original);
	writeFileSync(join(worktree, "inside.ts"), "before\n");
	writeFileSync(join(original, "outside.ts"), "source\n");
	const policy = { worktree, originalRoots: [original] };
	return { worktree, original, policy, judge: (tool: string, input: Record<string, unknown>) => judgeReplayTool(tool, input, worktree, policy, inspect) };
}

describe("replay fail-closed tool policy", () => {
	test("audited local reads and normal in-root file writes remain callable", () => {
		const { judge } = fixture();
		for (const tool of ["read", "grep", "glob"]) expect(judge(tool, { path: "inside.ts" })).toBeNull();
		expect(judge("read", { path: "inside.ts:1-20" })).toBeNull();
		expect(judge("write", { path: "new/deep/file.ts", content: "new" })).toBeNull();
		expect(judge("edit", { path: "inside.ts", edits: [{ op: "update", diff: "@@\n-before\n+after\n" }] })).toBeNull();
	});
	test("shell, eval, task, direct LSP, MCP, and every unknown tool are blocked even when arguments look harmless", () => {
		const { judge } = fixture();
		for (const tool of ["bash", "eval", "task", "lsp", "mcp__slack_send_message", "mcp__gmail_create_draft", "unknown", "ship_stage", "user_todo"]) expect(judge(tool, { command: "pwd", action: "list" })).toContain("blocked");
	});
	test("URI devices, database mutation queries, archive targets, and aliases cannot hide inside file tools", () => {
		const { judge } = fixture();
		for (const path of ["xd://mcp__slack_send_message", "xd:/mcp__slack_send_message", "agent://Main", "proc://child/kill", "ssh://host/file", "file.db?q=DELETE%20FROM%20users"]) {
			expect(judge("write", { path, content: "{}" })).not.toBeNull();
			expect(judge("read", { path })).not.toBeNull();
		}
		expect(judge("write", { path: "archive.zip:member.ts", content: "new" })).not.toBeNull();
	});
	test("absolute, relative, and mixed batch escapes block the entire edit with an explicit source-root suggestion", () => {
		const { judge, original, worktree } = fixture();
		const absolute = join(original, "outside.ts");
		expect(judge("write", { path: absolute, content: "bad" })).toContain(join(worktree, "outside.ts"));
		expect(judge("write", { path: "../original/outside.ts", content: "bad" })).toContain("outside");
		const input = `*** Begin Patch\n*** Update File: inside.ts\n@@\n-before\n+after\n*** Update File: ${absolute}\n@@\n-source\n+bad\n*** End Patch\n`;
		expect(judge("edit", { input })).not.toBeNull();
		expect(readFileSync(absolute, "utf8")).toBe("source\n");
		expect(readFileSync(join(worktree, "inside.ts"), "utf8")).toBe("before\n");
	});
	test("native move and delete intents cannot bypass destination checks", () => {
		const { judge, original } = fixture();
		expect(judge("edit", { path: "inside.ts", edits: [{ op: "update", rename: join(original, "moved.ts"), diff: "@@\n-before\n+after\n" }] })).not.toBeNull();
		expect(judge("edit", { path: join(original, "outside.ts"), edits: [{ op: "delete" }] })).not.toBeNull();
		expect(existsSync(join(original, "moved.ts"))).toBe(false);
	});
	test("symlink parents, dangling links, hard links, and metadata aliases fail closed", () => {
		const { judge, original, worktree } = fixture();
		symlinkSync(original, join(worktree, "escape"));
		symlinkSync(join(original, "not-yet-created.ts"), join(worktree, "dangling"));
		linkSync(join(original, "outside.ts"), join(worktree, "hard.ts"));
		mkdirSync(join(worktree, ".omp"));
		symlinkSync(join(worktree, ".omp"), join(worktree, "configuration"));
		for (const path of ["escape/new.ts", "dangling", "hard.ts", "configuration/config.yml", ".git", ".git/config", ".agents/replay.ts"]) expect(judge("write", { path, content: "bad" })).not.toBeNull();
		expect(judge("edit", {})).not.toBeNull();
	});
});
