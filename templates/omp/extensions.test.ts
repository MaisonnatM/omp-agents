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
let agentStart;
let tool;
let confirmations = 0;
const sessionManager = { getSessionId: () => input.sessionId ?? "session" };
extension({
	zod: z,
	on(name, handler) {
		if (name === "tool_call") gate = handler;
		if (name === "before_agent_start") agentStart = handler;
	},
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
} else if (input.write || input.edit) {
	const call = input.edit ? { toolName: "edit", input: input.edit } : { toolName: "write", input: { path: input.write } };
	const result = await gate(call, { cwd: process.cwd(), sessionManager, agent: { kind: input.agentKind ?? "main" } });
	console.log(JSON.stringify({ result: result ?? null }));
} else if (input.agentStart) {
	const result = await agentStart({ systemPrompt: ["base"] }, { cwd: process.cwd(), sessionManager, agent: { kind: input.agentKind ?? "main" } });
	console.log(JSON.stringify({ prompt: result?.systemPrompt ?? null }));
} else if (input.run) {
	const result = await tool.execute("call", input.params, undefined, undefined, { cwd: process.cwd(), hasUI: false });
	console.log(JSON.stringify({ run: { isError: result.isError ?? false, stage: result.details?.state?.stage ?? null } }));
} else {
	if (!tool) throw new Error("No tool schema registered");
	console.log(JSON.stringify({ valid: tool.parameters.safeParse(input.params).success }));
}
`;

function exercise(name: "ship" | "todos" | "worktree-guard" | "projects", input: object, env: Record<string, string> = {}): {
	result: { block: boolean; reason: string } | null;
	confirmations: number;
	valid: boolean;
	run: { isError: boolean; stage: string | null };
	prompt: string[] | null;
} {
	const child = Bun.spawnSync([
		process.execPath, "run", "-", packageDir,
		join(import.meta.dir, `agent/extensions/${name}.ts`), JSON.stringify(input),
	], { stdin: Buffer.from(loader), stdout: "pipe", stderr: "pipe", env: { ...Bun.env, ...env } });
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

describe("projects", () => {
	const root = mkdtempSync(join(tmpdir(), "projects-extension-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const env = { XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data") };
	const notes = join(root, "data", "omp-agents", "projects", "p1");
	mkdirSync(join(root, "config", "omp-agents"), { recursive: true });
	writeFileSync(
		join(root, "config", "omp-agents", "projects.json"),
		JSON.stringify({ projects: [{ id: "p1", name: "Billing", coordinator: { sessionId: "s-c" }, workers: [{ id: "w2", title: "Schema", sessionId: "s-w2" }] }] }),
	);

	test("the coordinator and each worker are told their role and the notes, a subagent in the session too; other sessions are told nothing", () => {
		const coordinator = exercise("projects", { agentStart: true, sessionId: "s-c" }, env).prompt;
		expect(coordinator?.[0]).toBe("base");
		expect(coordinator?.[1]).toStartWith('You are the coordinator of the omp-agents project "Billing".');
		expect(coordinator?.[1]).toContain(`Read ${join(notes, "README.md")} first.`);
		expect(coordinator?.[1]).toContain("[omp-agents]");
		const worker = exercise("projects", { agentStart: true, sessionId: "s-w2" }, env).prompt;
		expect(worker?.[1]).toStartWith('You are worker w2 ("Schema") of the omp-agents project "Billing"');
		expect(worker?.[1]).toContain(notes);
		expect(exercise("projects", { agentStart: true, sessionId: "s-other" }, env).prompt).toBeNull();
		expect(exercise("projects", { agentStart: true, sessionId: "s-c", agentKind: "sub" }, env).prompt?.[1]).toStartWith("You are the coordinator");
	});

	test.each([
		["s-c", join(root, "repo", "src", "app.ts"), true],
		["s-c", join(notes, "testing.md"), false],
		["s-c", `${notes}-other/x.md`, true],
		["s-c", "local://plan.md", false],
		["s-c", "artifact://12", false],
		["s-c", `file://${join(notes, "testing.md")}`, true],
		["s-w2", join(root, "repo", "src", "app.ts"), false],
		["s-other", join(root, "repo", "src", "app.ts"), false],
	])("session %s writing %s is blocked: %s", (sessionId, path, blocked) => {
		const { result } = exercise("projects", { write: path, sessionId }, env);
		expect(result?.block ?? false).toBe(blocked);
		if (blocked) expect(result?.reason).toContain("start_worker");
	});

	test("a subagent in the coordinator's session is held to its limit as the coordinator is", () => {
		expect(exercise("projects", { write: join(root, "repo", "a.ts"), sessionId: "s-c", agentKind: "sub" }, env).result?.block).toBe(true);
		expect(exercise("projects", { write: join(notes, "a.md"), sessionId: "s-c", agentKind: "sub" }, env).result).toBeNull();
	});

	test("a coordinator's hashline edit is checked file by file, and an edit naming no file it can read is refused", () => {
		const edit = (input: object) => exercise("projects", { edit: input, sessionId: "s-c" }, env).result;
		expect(edit({ input: `[${join(notes, "README.md")}#1A2B]\nPUT 1.=1:\n+x` })).toBeNull();
		expect(edit({ input: `[${join(notes, "README.md")}#1A2B]\nPUT 1.=1:\n+x\n[${join(root, "repo", "a.ts")}#3C4D]\nPUT 1.=1:\n+y` })?.block).toBe(true);
		expect(edit({ input: "*** Begin Patch\n*** Update File: src/a.ts" })?.reason).toContain("names no file");
		expect(exercise("projects", { edit: { input: "anything" }, sessionId: "s-w2" }, env).result).toBeNull();
	});
});
