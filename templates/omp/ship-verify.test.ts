import { describe, expect, test } from "bun:test";
import { join } from "node:path";

type Contract = { goal: string; constraints: string[]; files_to_change: string[]; test_first: string | null; done_when: string[] };
type ToolRun = { name: string; input: Record<string, unknown>; ok: boolean };
type BranchCommit = { sha: string; files: string[] };
// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	toolRuns(entries: readonly { type: string; message?: object }[]): ToolRun[];
	declaredChecks(landJson: string | undefined): string[][];
	isCheckCommand(words: string[], declared: string[][]): boolean;
	verificationRefusal(stage: string, runs: ToolRun[], declared: string[][]): string | undefined;
	parseBranchLog(stdout: string): BranchCommit[];
	testFirstRefusal(contract: Contract, commits: BranchCommit[], base: string): string | undefined;
} = await import(join(import.meta.dir, "agent/extensions/ship.ts"));
const { toolRuns, declaredChecks, isCheckCommand, verificationRefusal, parseBranchLog, testFirstRefusal } = extension;

const bash = (command: string, ok = true, input: Record<string, unknown> = {}): ToolRun => ({ name: "bash", input: { command, ...input }, ok });
const edit: ToolRun = { name: "edit", input: {}, ok: true };
const LAND = JSON.stringify({ checks: ["git diff --quiet \"$LAND_BASE\" HEAD -- CHANGELOG.md && { echo x; exit 1; } || true", "bun scripts/check-test-edits.ts", ["bun test", "bun run typecheck"]] });

describe("verified stages", () => {
	test("refuses draft_pr and ready_gate with no passing check after the last edit", () => {
		for (const stage of ["draft_pr", "ready_gate"]) {
			expect(verificationRefusal(stage, [], [])).toContain(`${stage} is not recorded`);
			expect(verificationRefusal(stage, [bash("bun test"), edit], [])).toContain("since the last `edit` call");
		}
	});

	test("allows a stage once a check exits 0 after the last edit", () => {
		expect(verificationRefusal("draft_pr", [edit, bash("bun test")], [])).toBeUndefined();
		expect(verificationRefusal("ready_gate", [edit, bash("cd /repo && bun run typecheck")], [])).toBeUndefined();
	});

	test("a failing, backgrounded, or unrelated command does not count", () => {
		expect(verificationRefusal("draft_pr", [edit, bash("bun test", false)], [])).toBeDefined();
		expect(verificationRefusal("draft_pr", [edit, bash("bun test", true, { async: true })], [])).toBeDefined();
		expect(verificationRefusal("draft_pr", [edit, bash("cat foo.test.ts")], [])).toBeDefined();
	});

	test("a task call, even a failed one, counts as an edit", () => {
		expect(verificationRefusal("draft_pr", [bash("bun test"), { name: "task", input: {}, ok: false }], [])).toContain("`task`");
	});

	test("the refusal names the repository's declared checks", () => {
		expect(verificationRefusal("draft_pr", [edit], declaredChecks(LAND))).toContain("`bun test`, `bun run typecheck`");
	});
});

describe("check commands", () => {
	const declared = declaredChecks(LAND);
	test("land.json contributes its single commands, not shell lines", () => {
		expect(declared).toEqual([["bun", "scripts/check-test-edits.ts"], ["bun", "test"], ["bun", "run", "typecheck"]]);
		expect(isCheckCommand(["true"], declared)).toBe(false);
		expect(isCheckCommand(["bun", "scripts/check-test-edits.ts"], declared)).toBe(true);
	});

	test("recognizes common test and typecheck commands", () => {
		for (const line of ["bun test x.test.ts", "bun run test:agent x", "npm test", "pnpm lint", "npx tsc --noEmit", "cargo test", "go vet ./...", "python3 -m pytest", "time bun test"]) {
			expect(isCheckCommand(line.split(" "), [])).toBe(true);
		}
		for (const line of ["bun install", "npm run build", "git status", "bun scripts/smoke.ts"]) {
			expect(isCheckCommand(line.split(" "), [])).toBe(false);
		}
	});

	test("looks through heavy.py", () => {
		expect(isCheckCommand(["python3", "/h/.omp/agent/scripts/heavy.py", "bun run typecheck && bun run lint"], [])).toBe(true);
		expect(isCheckCommand(["python3", "/h/heavy.py", "bun", "test"], [])).toBe(true);
		expect(isCheckCommand(["python3", "/h/heavy.py", "bun run build"], [])).toBe(false);
		expect(isCheckCommand(["python3", "heavy.py", "npm run lint && npm test", "2>&1"], [])).toBe(true);
	});
});

describe("session tool runs", () => {
	test("pairs each result with its call's arguments in result order", () => {
		const runs = toolRuns([
			{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "bash", arguments: { command: "bun test" } }, { type: "toolCall", id: "b", name: "edit", arguments: {} }] } },
			{ type: "message", message: { role: "toolResult", toolCallId: "b", toolName: "edit", isError: false } },
			{ type: "custom", message: undefined },
			{ type: "message", message: { role: "toolResult", toolCallId: "a", toolName: "bash", isError: true } },
		]);
		expect(runs).toEqual([{ name: "edit", input: {}, ok: true }, { name: "bash", input: { command: "bun test" }, ok: false }]);
	});
});

describe("test first", () => {
	const contract = (test_first: string | null): Contract => ({ goal: "fix", constraints: [], files_to_change: [], test_first, done_when: ["passes"] });
	const log = "\0aaa\n\nsrc/x.test.ts\n\0bbb\n\nsrc/x.ts\nCHANGELOG.md\n";

	test("parses git log into commits oldest first", () => {
		expect(parseBranchLog(log)).toEqual([{ sha: "aaa", files: ["src/x.test.ts"] }, { sha: "bbb", files: ["src/x.ts", "CHANGELOG.md"] }]);
	});

	test("allows a branch whose test commit comes before the code", () => {
		expect(testFirstRefusal(contract("src/x.test.ts: fails on empty input"), parseBranchLog(log), "base")).toBeUndefined();
		expect(testFirstRefusal(contract("a test for the empty input"), parseBranchLog(log), "base")).toBeUndefined();
		expect(testFirstRefusal(contract("src/x.test.ts"), [{ sha: "d", files: ["README.md"] }, ...parseBranchLog(log)], "base")).toBeUndefined();
	});

	test("skips a contract without test_first", () => {
		expect(testFirstRefusal(contract(null), [{ sha: "c", files: ["src/x.ts"] }], "base")).toBeUndefined();
	});

	test("refuses a test committed with or after the code, and says how to fix", () => {
		const together = testFirstRefusal(contract("src/x.test.ts"), [{ sha: "c", files: ["src/x.test.ts", "src/x.ts"] }], "base");
		expect(together).toContain("c changes code before any commit that changes only `src/x.test.ts`");
		expect(together).toContain("git reset --soft base");
		const after = testFirstRefusal(contract("src/x.test.ts"), [{ sha: "c", files: ["src/x.ts"] }, { sha: "d", files: ["src/x.test.ts"] }], "base");
		expect(after).toContain("draft_pr is not recorded");
	});

	test("refuses a branch with no test commit", () => {
		expect(testFirstRefusal(contract("src/x.test.ts"), [{ sha: "c", files: ["src/x.ts"] }], "base")).toContain("no commit on this branch changes a test file on its own");
		expect(testFirstRefusal(contract("src/x.test.ts"), [], "base")).toContain("no commit on this branch");
	});
});
