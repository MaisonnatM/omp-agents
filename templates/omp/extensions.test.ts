import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDir } from "../../src/omp/install";

const loader = `
import { createRequire } from "node:module";
import { join } from "node:path";
const { z } = createRequire(join(process.argv[2], "package.json"))("zod");
// The same harness loads whichever installed extension the caller selects.
const { default: extension } = await import(process.argv[3]);
const input = JSON.parse(process.argv[4]);
let gate;
let tool;
let confirmations = 0;
extension({
	zod: z,
	on(name, handler) { if (name === "tool_call") gate = handler; },
	registerTool(registered) { tool = registered; },
	appendEntry() {},
	async exec() { return input.response; },
});
if (input.command) {
	if (!gate) throw new Error("No command gate registered");
	const result = await gate({ toolName: "bash", input: { command: input.command } }, {
		cwd: process.cwd(), hasUI: true,
		ui: { async confirm() { confirmations++; return input.approve; } },
	});
	console.log(JSON.stringify({ result: result ?? null, confirmations }));
} else if (input.write) {
	const result = await gate({ toolName: "write", input: { path: input.write } }, { cwd: process.cwd() });
	console.log(JSON.stringify({ result: result ?? null }));
} else if (input.run) {
	const result = await tool.execute("call", input.params, undefined, undefined, { cwd: process.cwd(), hasUI: false });
	console.log(JSON.stringify({ run: { isError: result.isError ?? false, stage: result.details?.state?.stage ?? null } }));
} else {
	if (!tool) throw new Error("No tool schema registered");
	console.log(JSON.stringify({ valid: tool.parameters.safeParse(input.params).success }));
}
`;

function exercise(name: "ship" | "todos" | "worktree-guard", input: object): {
	result: { block: boolean; reason: string } | null;
	confirmations: number;
	valid: boolean;
	run: { isError: boolean; stage: string | null };
} {
	const child = Bun.spawnSync([
		process.execPath, "run", "-", packageDir,
		join(import.meta.dir, `agent/extensions/${name}.ts`), JSON.stringify(input),
	], { stdin: Buffer.from(loader), stdout: "pipe", stderr: "pipe" });
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
	return JSON.parse(child.stdout.toString());
}

describe("ship publication gate", () => {
	test("a branch without a PR is blocked with draft-first recovery", () => {
		const { result } = exercise("ship", {
			command: "gt submit --publish",
			response: { code: 1, stdout: "", stderr: 'no pull requests found for branch "feature"' },
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("gt submit --draft");
		expect(result?.reason).toContain("gh pr create --draft");
	});

	test("authentication failure does not recommend creating another PR", () => {
		const { result } = exercise("ship", {
			command: "gt submit --publish",
			response: { code: 1, stdout: "", stderr: "HTTP 401: Bad credentials" },
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("HTTP 401: Bad credentials");
		expect(result?.reason).not.toContain("gt submit --draft");
	});

	test("an unreviewed PR cannot reach operator approval", () => {
		const { result, confirmations } = exercise("ship", {
			command: "gt submit --publish", approve: true,
			response: { code: 0, stdout: "Unreviewed PR", stderr: "" },
		});
		expect(result?.block).toBe(true);
		expect(confirmations).toBe(0);
	});

	test.each([false, true])("a reviewed PR requires operator approval (%s)", approve => {
		const { result, confirmations } = exercise("ship", {
			command: "gt submit --publish", approve,
			response: { code: 0, stdout: "- [x] Thermo-nuclear code quality review", stderr: "" },
		});
		expect(result?.block ?? false).toBe(!approve);
		expect(confirmations).toBe(1);
	});
});

describe("ship_stage ready gate", () => {
	test.each([["- [x] Thermo-nuclear code quality review", false], ["Unreviewed PR", true]])("the first call naming the PR reads its body (%s)", (body, isError) => {
		const pullRequest = {
			state: "OPEN", isDraft: true, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: null, body,
			reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
			commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
		};
		const { run } = exercise("ship", {
			run: true,
			params: { stage: "ready_gate", pr: 7, repo: "owner/name" },
			response: { code: 0, stderr: "", stdout: JSON.stringify({ data: { repository: { pullRequest } } }) },
		});
		expect(run).toEqual({ isError, stage: isError ? null : "ready_gate" });
	});
});

describe("worktree guard", () => {
	const root = mkdtempSync(join(tmpdir(), "worktree-guard-"));
	const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root, stdout: "ignore", stderr: "ignore" });
	git("init", "-q", "main");
	mkdirSync(join(root, "isolated"));
	writeFileSync(join(root, "isolated", ".omp-isolation-owner.json"), "{}");
	git("clone", "-q", "main", "isolated/m");
	git("clone", "-q", "main", "plain");
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test.each([["main", true], ["plain", true], ["isolated/m", false]])("a first write in the %s clone", (checkout, blocked) => {
		const { result } = exercise("worktree-guard", { write: join(root, checkout, "file.txt") });
		expect(result?.block ?? false).toBe(blocked);
	});
});

describe("user_todo optional due date", () => {
	test.each(["list", "add", "check"])("%s accepts an empty optional date", action => {
		const { valid } = exercise("todos", { params: { action, text: "Review the PR", id: "todo-1", due: "" } });
		expect(valid).toBe(true);
	});

	test.each([undefined, "2026-10-07", "2026-1-7", "tomorrow"])("date format boundary %s", due => {
		const { valid } = exercise("todos", { params: { action: "add", text: "Review the PR", due } });
		expect(valid).toBe(due === undefined || due === "2026-10-07");
	});
});
