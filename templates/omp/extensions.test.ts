import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const sessionManager = { getSessionId: () => input.sessionId ?? "session", getSessionFile: () => input.sessionFile };
extension({
	// Importing omp's exports takes about a second, so only a test that reads them asks for them.
	pi: input.omp ? await import(process.argv[2]) : undefined,
	zod: z,
	on(name, handler) {
		if (name === "tool_call") gate = handler;
		if (name === "before_agent_start") agentStart = handler;
	},
	registerTool(registered) { tool = registered; },
	appendEntry() {},
	// input.responses answers by subcommand, such as "pr view" or "repo view"; input.response answers the rest.
	async exec(_command, args) { return input.responses?.[args.slice(0, 2).join(" ")] ?? input.response; },
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
	// attempts repeats the call, as an agent retrying after a block does; the last answer counts.
	let result;
	for (let i = 0; i < (input.attempts ?? 1); i++) result = await gate(call, { cwd: process.cwd(), sessionManager, agent: { kind: input.agentKind ?? "main" } });
	console.log(JSON.stringify({ result: result ?? null }));
} else if (input.agentStart) {
	const result = await agentStart({ systemPrompt: ["base"] }, { cwd: input.cwd ?? process.cwd(), sessionManager, agent: { kind: input.agentKind ?? "main" } });
	console.log(JSON.stringify({ prompt: result?.systemPrompt ?? null }));
} else if (input.run) {
	const result = await tool.execute("call", input.params, undefined, undefined, { cwd: process.cwd(), hasUI: false, sessionManager });
	console.log(JSON.stringify({ run: { isError: result.isError ?? false, stage: result.details?.state?.stage ?? null }, text: result.content?.[0]?.text ?? null }));
} else {
	if (!tool) throw new Error("No tool schema registered");
	console.log(JSON.stringify({ valid: tool.parameters.safeParse(input.params).success }));
}
`;

function exercise(name: "ship" | "todos" | "notes" | "worktree-guard" | "projects" | "google-accounts", input: object, env: Record<string, string> = {}): {
	result: { block: boolean; reason: string } | null;
	confirmations: number;
	valid: boolean;
	run: { isError: boolean; stage: string | null };
	text: string | null;
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

	test.each([["- [ ] Browser proof (UI changes: run verify-yampa, attach screenshot)", true], ["- [x] Browser proof (UI changes: run verify-yampa, attach screenshot)", false]])("a reviewed PR with %j is blocked: %s", (box, blocked) => {
		const { result, confirmations } = exercise("ship", {
			command: "gh pr ready 7", approve: true,
			responses: { "pr view": { code: 0, stdout: `## Checks\n${box}\n- [x] Thermo-nuclear code quality review`, stderr: "" } },
		});
		expect(result?.block ?? false).toBe(blocked);
		expect(confirmations).toBe(blocked ? 0 : 1);
		if (blocked) expect(result?.reason).toContain("- [ ] Browser proof");
	});

	test.each([["dustinspecker/awesome-eslint", false], ["me/app", true], ["ME/other", true]])("gh pr ready -R %s is gated: %s", (repo, gated) => {
		const { result, confirmations } = exercise("ship", {
			command: `gh pr ready 5 -R ${repo} >/dev/null`, approve: true,
			responses: {
				"repo view": { code: 0, stdout: "me/app", stderr: "" },
				"pr view": { code: 0, stdout: "Unreviewed PR", stderr: "" },
			},
		});
		expect(result?.block ?? false).toBe(gated);
		expect(confirmations).toBe(0);
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
	git("init", "-q", "-b", "main", "main");
	git("init", "-q", "-b", "feature", "feature");
	git("init", "-q", "-b", "trunk", "upstream");
	git("-C", "upstream", "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "start");
	git("clone", "-q", "upstream", "downstream");
	mkdirSync(join(root, "isolated"));
	writeFileSync(join(root, "isolated", ".omp-isolation-owner.json"), "{}");
	git("clone", "-q", "main", "isolated/m");
	git("clone", "-q", "main", "plain");
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test.each([["main", true], ["plain", true], ["feature", false], ["isolated/m", false]])("a first write in the %s clone", (checkout, blocked) => {
		const { result } = exercise("worktree-guard", { write: join(root, checkout, "file.txt") });
		expect(result?.block ?? false).toBe(blocked);
	});

	// `downstream` is on `trunk`, the default branch its `origin/HEAD` names; `feature` has no remote and is on neither `main` nor `master`.
	test.each([["main", true], ["downstream", true], ["feature", false]])("a retried write in the %s checkout is blocked: %s", (checkout, blocked) => {
		const { result } = exercise("worktree-guard", { write: join(root, checkout, "file.txt"), attempts: 2 });
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

describe("user_note", () => {
	const root = mkdtempSync(join(tmpdir(), "notes-extension-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const env = { XDG_CONFIG_HOME: join(root, "config") };
	const config = join(root, "config", "omp-agents");
	const inbox = join(config, "note-inbox");
	const at = "2026-10-05T09:00:00.000Z";
	mkdirSync(config, { recursive: true });
	writeFileSync(
		join(config, "notes.json"),
		JSON.stringify({
			notes: [
				{ id: "n1", title: "Deploy checklist", body: "Run the staging smoke first.", todoId: "t1", addedBy: null, createdAt: at, updatedAt: at },
				{ id: "n2", title: "Reading list", body: "Designing Data-Intensive Applications", todoId: null, addedBy: null, createdAt: at, updatedAt: at },
			],
		}),
	);
	writeFileSync(join(config, "todos.json"), JSON.stringify({ todos: [{ id: "t1", text: "Ship the release" }] }));
	writeFileSync(
		join(config, "projects.json"),
		JSON.stringify({
			projects: [
				{ id: "p1", name: "Billing", archived: false, coordinator: { sessionId: "coord" }, workers: [{ id: "w", title: "Ledger", sessionId: "w1" }] },
				{ id: "p2", name: "Search", archived: true, coordinator: { sessionId: "old" }, workers: [] },
			],
		}),
	);
	const call = (params: object, sessionId = "s1", sessionFile?: string) => exercise("notes", { run: true, params, sessionId, sessionFile }, env);
	const left = () => readdirSync(inbox).sort().map(name => JSON.parse(readFileSync(join(inbox, name), "utf8")));

	test("list keeps the notes holding every word of the query, in any case, and names the todo each belongs to", () => {
		const { text } = call({ action: "list", query: "SMOKE staging" });
		expect(text?.split("\n")).toEqual([`- Deploy checklist (id n1, updated ${new Date(at).toLocaleDateString("en-CA")}, todo "Ship the release")`]);
		expect(call({ action: "list", query: "" }).text?.split("\n")).toHaveLength(2);
	});

	test("a session adding a note it already added gets the first one's id, and the note lists before the dashboard applies it", () => {
		const first = call({ action: "add", title: "Findings", body: "The cache misses." });
		const again = call({ action: "add", title: " Findings ", todo_id: "" });
		const [added] = left();
		expect(first.text).toBe(`Added to the user's notes (id ${added.note.id}).`);
		expect(again.text).toContain(`already added it (id ${added.note.id})`);
		expect(added.note).toMatchObject({ title: "Findings", body: "The cache misses.", todoId: null, projectId: null, addedBy: "s1" });
		call({ action: "add", title: "Findings" }, "s2");
		expect(left()).toHaveLength(2);
		expect(call({ action: "list", query: "cache" }).text).toContain(`Findings (id ${added.note.id}`);
	});

	test("append needs a note that exists, and read shows its title and body", () => {
		expect(call({ action: "append", id: "gone", text: "More" }).run.isError).toBe(true);
		expect(call({ action: "append", id: "n2", text: "Thinking in Systems" }).run.isError).toBe(false);
		expect(left().at(-1)).toMatchObject({ op: "append", id: "n2", text: "Thinking in Systems" });
		expect(call({ action: "read", id: "n1" }).text).toBe("Deploy checklist\n\nRun the staging smoke first.");
		expect(call({ action: "read", id: "n2" }).text).toBe("Reading list\n\nDesigning Data-Intensive Applications\n\nThinking in Systems");
		expect(call({ action: "list", query: "thinking systems" }).text).toContain("Reading list (id n2");
	});

	test("a note added from a project's session belongs to that project unless project_id names another, and list keeps one project's notes", () => {
		expect(call({ action: "add", title: "Elsewhere", project_id: "gone" }, "coord").run.isError).toBe(true);
		expect(call({ action: "add", title: "Ledger rounding" }, "w1").text).toEndWith(`, project "Billing").`);
		call({ action: "add", title: "Ranking idea", project_id: "p2" }, "coord");
		expect(left().slice(-2).map(change => change.note.projectId)).toEqual(["p1", "p2"]);
		expect(call({ action: "list", project_id: "p1" }).text?.split("\n")).toEqual([expect.stringMatching(/^- Ledger rounding \(id \S+, updated \S+, project p1 "Billing"\)$/)]);
		expect(call({ action: "list", project_id: "gone" }).run.isError).toBe(true);
	});

	test("a task subagent's note belongs to the project of the session it runs under", () => {
		const sessions = join(root, "sessions");
		mkdirSync(join(sessions, "2026-10-05T09-00-00_coord"), { recursive: true });
		writeFileSync(join(sessions, "2026-10-05T09-00-00_coord.jsonl"), "");
		const subagent = join(sessions, "2026-10-05T09-00-00_coord", "Explore.jsonl");
		expect(call({ action: "add", title: "Subagent finding" }, "sub", subagent).text).toEndWith(`, project "Billing").`);
	});
});

describe("projects", () => {
	const root = mkdtempSync(join(tmpdir(), "projects-extension-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const env = { XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data") };
	const notes = join(root, "data", "omp-agents", "projects", "p1");
	const user = join(root, "data", "omp-agents", "user");
	mkdirSync(join(root, "config", "omp-agents"), { recursive: true });
	writeFileSync(
		join(root, "config", "omp-agents", "projects.json"),
		JSON.stringify({ projects: [{ id: "p1", name: "Billing", coordinator: { sessionId: "s-c" }, workers: [{ id: "w2", title: "Schema", sessionId: "s-w2" }] }] }),
	);

	test("the coordinator and each worker are told their role and the notes, a subagent in the session too; other sessions are told nothing", () => {
		const coordinator = exercise("projects", { agentStart: true, sessionId: "s-c" }, env).prompt;
		expect(coordinator?.[0]).toBe("base");
		expect(coordinator?.[1]).toStartWith('You are the coordinator of the omp-agents project "Billing".');
		expect(coordinator?.[1]).toContain(`Read ${join(notes, "notes.md")} first:`);
		expect(coordinator?.[1]).toContain(`Read ${join(user, "preferences.md")}`);
		expect(coordinator?.[1]).toContain("[omp-agents]");
		const worker = exercise("projects", { agentStart: true, sessionId: "s-w2" }, env).prompt;
		expect(worker?.[1]).toStartWith('You are worker w2 ("Schema") of the omp-agents project "Billing"');
		expect(worker?.[1]).toContain(notes);
		expect(exercise("projects", { agentStart: true, sessionId: "s-other" }, env).prompt).toBeNull();
		expect(exercise("projects", { agentStart: true, sessionId: "s-c", agentKind: "sub" }, env).prompt?.[1]).toStartWith("You are the coordinator");
	});

	test.each([
		["s-c", join(root, "repo", "src", "app.ts"), true],
		["s-c", join(notes, "docs", "testing.md"), false],
		["s-c", join(user, "preferences.md"), false],
		["s-c", join(user, "workflows", "new-feature.md"), false],
		["s-c", `${user}-other/x.md`, true],
		["s-c", `${notes}-other/x.md`, true],
		["s-c", "local://plan.md", false],
		["s-c", "artifact://12", false],
		["s-c", `file://${join(notes, "docs", "testing.md")}`, true],
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
		expect(edit({ input: `[${join(notes, "notes.md")}#1A2B]\nPUT 1.=1:\n+x\n[${join(user, "preferences.md")}#3C4D]\nPUT 1.=1:\n+y` })).toBeNull();
		expect(edit({ input: `[${join(notes, "notes.md")}#1A2B]\nPUT 1.=1:\n+x\n[${join(root, "repo", "a.ts")}#3C4D]\nPUT 1.=1:\n+y` })?.block).toBe(true);
		expect(edit({ input: "*** Begin Patch\n*** Update File: src/a.ts" })?.reason).toContain("names no file");
		expect(exercise("projects", { edit: { input: "anything" }, sessionId: "s-w2" }, env).result).toBeNull();
	});
});

describe("google accounts", () => {
	const root = mkdtempSync(join(tmpdir(), "google-accounts-extension-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const env = { XDG_CONFIG_HOME: join(root, "config"), PI_CODING_AGENT_DIR: join(root, "agent") };
	const work = join(root, "work");
	mkdirSync(join(root, "config", "omp-agents"), { recursive: true });
	mkdirSync(join(root, "agent"));
	mkdirSync(join(work, "app"), { recursive: true });
	writeFileSync(
		join(root, "config", "omp-agents", "google-accounts.json"),
		JSON.stringify({ addresses: { gmail: "ana@example.com", "gmail-2": "ana@work.example" }, links: { "ana@work.example": [work] } }),
	);
	const servers = (names: string[]) =>
		writeFileSync(join(root, "agent", "mcp.json"), JSON.stringify({ mcpServers: Object.fromEntries(names.map(name => [name, { type: "http", url: "https://gmailmcp.googleapis.com/mcp/v1" }])) }));

	test("a session in a linked workspace hears each account of omp's mcp.json and the one linked to it; one account tells nothing", () => {
		servers(["gmail", "gmail-2"]);
		expect(exercise("google-accounts", { agentStart: true, omp: true, cwd: join(work, "app") }, env).prompt).toEqual([
			"base",
			[
				"omp is signed in to several Google accounts, one MCP server each, and each server's tools start with its prefix.",
				"Gmail:",
				"- gmail: ana@example.com, tools `mcp__gmail_`",
				"- gmail-2: ana@work.example, tools `mcp__gmail_2_`",
				`The user linked this workspace, ${work}, to ana@work.example: use that account for this workspace's mail and calendar unless the user names another account.`,
			].join("\n"),
		]);
		servers(["gmail"]);
		expect(exercise("google-accounts", { agentStart: true, omp: true, cwd: join(work, "app") }, env).prompt).toBeNull();
	});
});
