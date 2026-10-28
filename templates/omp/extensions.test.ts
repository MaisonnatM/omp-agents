import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { packageDir } from "../../src/omp/install";

const loader = `
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
const { z } = createRequire(join(process.argv[2], "package.json"))("zod");
const input = JSON.parse(process.argv[4]);
// Importing omp's exports takes about a second, so only a test that reads them asks for them.
const pi = input.omp ? await import(process.argv[2]) : undefined;
let tool;
let confirmations = 0;
const executed = [];
const sessionManager = { getSessionId: () => input.sessionId ?? "session" };
// Loads an extension as one omp session does and returns its handlers by event name.
function load(extension) {
	const hooks = {};
	extension({
		pi,
		zod: z,
		on(name, handler) { hooks[name] = handler; },
		registerTool(registered) { tool = registered; },
		appendEntry() {},
		// input.responses answers by subcommand, such as "pr view" or "repo view"; input.response answers the rest.
		async exec(_command, args) {
			executed.push(args);
			return input.sequence?.shift() ?? input.responses?.[args.slice(0, 2).join(" ")] ?? input.response;
		},
	});
	return hooks;
}
// The same harness loads whichever installed extension the caller selects.
const hooks = load((await import(process.argv[3])).default);
if (input.command) {
	if (!hooks.tool_call) throw new Error("No command gate registered");
	const result = await hooks.tool_call({ toolName: "bash", input: { command: input.command } }, {
		cwd: input.cwd ?? process.cwd(), hasUI: true,
		ui: { async confirm() { confirmations++; return input.approve; } },
	});
	console.log(JSON.stringify({ result: result ?? null, confirmations }));
} else if (input.write) {
	// attempts repeats the call, as an agent retrying after a block does; the last answer counts.
	const ctx = {
		cwd: process.cwd(), sessionManager, agent: { kind: "main" }, hasUI: input.approve !== undefined,
		ui: { async confirm() { confirmations++; return input.approve; } },
	};
	let result;
	for (let i = 0; i < (input.attempts ?? 1); i++) result = await hooks.tool_call({ toolName: "write", input: { path: input.write } }, ctx);
	console.log(JSON.stringify({ result: result ?? null, confirmations }));
} else if (input.calls) {
	// One omp process: its session, and a subagent session that loads the extension again, as omp does for each session.
	const sub = load((await import(process.argv[3] + "?sub")).default);
	const results = [];
	for (const call of input.calls) {
		const cwd = call.cwd ?? process.cwd();
		const ctx = { cwd, hasUI: false, sessionManager: { getSessionId: () => call.sessionId ?? "session" }, agent: { kind: call.agent ?? "main" } };
		const session = call.agent === "sub" ? sub : hooks;
		let reason = null;
		// external is another process changing the checkout outside omp.
		if (call.external) spawnSync("bash", ["-c", call.external], { cwd, stdio: "ignore" });
		else if (call.shutdown) await session.session_shutdown({ type: "session_shutdown" }, ctx);
		else {
			const event = { toolCallId: String(results.length), ...(call.write ? { toolName: "write", input: { path: call.write } } : { toolName: "bash", input: { command: call.bash } }) };
			reason = (await session.tool_call(event, ctx))?.reason ?? null;
			// An allowed call runs, unless dry asks only for the guard's answer.
			if (reason === null && !call.dry) {
				if (call.write) writeFileSync(call.write, ctx.sessionManager.getSessionId() + "\\n");
				else await session.tool_result({ ...event, isError: spawnSync("bash", ["-c", call.bash], { cwd, stdio: "ignore" }).status !== 0 }, ctx);
			}
		}
		results.push(reason);
	}
	console.log(JSON.stringify({ results }));
} else if (input.agentStart) {
	const result = await hooks.before_agent_start({ systemPrompt: ["base"] }, { cwd: input.cwd ?? process.cwd(), sessionManager, agent: { kind: "main" } });
	console.log(JSON.stringify({ prompt: result?.systemPrompt ?? null }));
} else if (input.run) {
	const result = await tool.execute("call", input.params, undefined, undefined, { cwd: input.cwd ?? process.cwd(), hasUI: false, sessionManager });
	console.log(JSON.stringify({ run: { isError: result.isError ?? false, stage: result.details?.state?.stage ?? null }, text: result.content?.[0]?.text ?? null, executed }));
} else {
	if (!tool) throw new Error("No tool schema registered");
	console.log(JSON.stringify({ valid: tool.parameters.safeParse(input.params).success }));
}
`;

function exercise(name: "ship" | "todos" | "notes" | "worktree-guard" | "google-accounts" | "pr-description", input: object, env: Record<string, string> = {}): {
	result: { block: boolean; reason: string } | null;
	confirmations: number;
	valid: boolean;
	run: { isError: boolean; stage: string | null };
	text: string | null;
	prompt: string[] | null;
	results: (string | null)[];
	executed: string[][];
} {
	const child = Bun.spawnSync([
		process.execPath, "run", "-", packageDir,
		join(import.meta.dir, `agent/extensions/${name}.ts`), JSON.stringify(input),
	], { stdin: Buffer.from(loader), stdout: "pipe", stderr: "pipe", env: { ...Bun.env, ...env } });
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
	return JSON.parse(child.stdout.toString());
}

const quotaConfigs: string[] = [];
afterAll(() => { for (const dir of quotaConfigs) rmSync(dir, { recursive: true, force: true }); });
/** A config directory of the test's own, so the GitHub quota cooldown it records on disk reaches no other test. */
function quotaConfig(): Record<string, string> {
	const dir = mkdtempSync(join(tmpdir(), "github-quota-"));
	quotaConfigs.push(dir);
	return { XDG_CONFIG_HOME: dir };
}

const checkouts: string[] = [];
afterAll(() => { for (const dir of checkouts) rmSync(dir, { recursive: true, force: true }); });
/** A checkout of the test's own, with `reviewPaths` as its `.omp/review-paths` and `uiPaths` as its `.omp/ui-paths` when given, so this repository's files reach no test. */
function checkout(reviewPaths?: string, uiPaths?: string): string {
	const dir = mkdtempSync(join(tmpdir(), "ship-checkout-"));
	checkouts.push(dir);
	mkdirSync(join(dir, ".git"));
	mkdirSync(join(dir, ".omp"));
	if (reviewPaths !== undefined) writeFileSync(join(dir, ".omp/review-paths"), reviewPaths);
	if (uiPaths !== undefined) writeFileSync(join(dir, ".omp/ui-paths"), uiPaths);
	return dir;
}

/** `gh pr view --json body,changedFiles,files` answering with this body and changed files. */
function prView(body: string, files: string[] = []) {
	return { code: 0, stdout: JSON.stringify({ body, changedFiles: files.length, files: files.map(path => ({ path })) }), stderr: "" };
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
			command: "gt submit --publish", approve: true, cwd: checkout(),
			response: prView("Unreviewed PR", ["README.md"]),
		});
		expect(result?.block).toBe(true);
		expect(confirmations).toBe(0);
	});

	test.each([["README.md", false], ["src/shared/protocol.ts", true]])("with review paths, an unreviewed PR changing %s is blocked: %s", (file, blocked) => {
		const { result, confirmations } = exercise("ship", {
			command: "gh pr ready 7", approve: true, cwd: checkout("# Shared contracts\nsrc/shared/**\n"),
			responses: { "pr view": prView("Unreviewed PR", [file]) },
		});
		expect(result?.block ?? false).toBe(blocked);
		expect(confirmations).toBe(blocked ? 0 : 1);
	});

	test.each([false, true])("a reviewed PR requires operator approval (%s)", approve => {
		const { result, confirmations } = exercise("ship", {
			command: "gt submit --publish", approve, cwd: checkout(),
			response: prView("- [x] Thermo-nuclear code quality review"),
		});
		expect(result?.block ?? false).toBe(!approve);
		expect(confirmations).toBe(1);
	});

	test.each([["- [ ] Browser proof (UI changes: run verify-yampa, attach screenshot)", true], ["- [x] Browser proof (UI changes: run verify-yampa, attach screenshot)", false]])("a reviewed PR with %j is blocked: %s", (box, blocked) => {
		const { result, confirmations } = exercise("ship", {
			command: "gh pr ready 7", approve: true, cwd: checkout(),
			responses: { "pr view": prView(`## Checks\n${box}\n- [x] Thermo-nuclear code quality review`) },
		});
		expect(result?.block ?? false).toBe(blocked);
		expect(confirmations).toBe(blocked ? 0 : 1);
		if (blocked) expect(result?.reason).toContain("- [ ] Browser proof");
	});

	test.each([[undefined, false], ["web/**/*.tsx\n", true]])("a reviewed PR changing web/app.tsx without the interface box, with ui paths %j, is blocked: %s", (uiPaths, blocked) => {
		const { result, confirmations } = exercise("ship", {
			command: "gh pr ready 7", approve: true, cwd: checkout(undefined, uiPaths),
			responses: { "pr view": prView("- [x] Thermo-nuclear code quality review", ["web/app.tsx"]) },
		});
		expect(result?.block ?? false).toBe(blocked);
		expect(confirmations).toBe(blocked ? 0 : 1);
		if (blocked) expect(result?.reason).toContain("- [x] Interface review");
	});

	test.each([["dustinspecker/awesome-eslint", false], ["me/app", true], ["ME/other", true]])("gh pr ready -R %s is gated: %s", (repo, gated) => {
		const { result, confirmations } = exercise("ship", {
			command: `gh pr ready 5 -R ${repo} >/dev/null`, approve: true, cwd: checkout(),
			responses: {
				"repo view": { code: 0, stdout: "me/app", stderr: "" },
				"pr view": prView("Unreviewed PR"),
			},
		});
		expect(result?.block ?? false).toBe(gated);
		expect(confirmations).toBe(0);
	});

	test("a publish run through `env` is gated", () => {
		const { result, confirmations } = exercise("ship", {
			command: "env -u GITHUB_TOKEN gt submit --publish", approve: true, cwd: checkout(),
			response: prView("Unreviewed PR"),
		});
		expect(result?.block).toBe(true);
		expect(confirmations).toBe(0);
	});

	test.each([["the token", true], ["ghp_launchValue", false]])("a rejected GITHUB_TOKEN with %s in the project's .env blames that file: %p", (fileValue, blamed) => {
		const project = mkdtempSync(join(tmpdir(), "ship-auth-"));
		const token = "ghp_rejectedTokenForTest0000000000000000";
		writeFileSync(join(project, ".env"), `GITHUB_TOKEN=${fileValue === "the token" ? token : fileValue}\n`);
		const hosts = {
			"github.com": [
				{ state: "error", error: "non-200 OK status code: 401 Unauthorized", active: true, host: "github.com", login: "", tokenSource: "GITHUB_TOKEN", gitProtocol: "ssh" },
				{ state: "success", active: false, host: "github.com", login: "octocat", tokenSource: "keyring", scopes: "repo", gitProtocol: "ssh" },
			],
		};
		const { result } = exercise("ship", {
			command: "gt submit --publish", cwd: project,
			responses: {
				"pr view": { code: 1, stdout: "", stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login -h github.com" },
				"auth status": { code: 0, stdout: JSON.stringify({ hosts }), stderr: "" },
			},
		}, { GITHUB_TOKEN: token });
		rmSync(project, { recursive: true, force: true });
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("`GITHUB_TOKEN`");
		expect(result?.reason).toContain("octocat");
		expect(result?.reason.includes(join(project, ".env"))).toBe(blamed);
		expect(result?.reason).not.toContain("gh auth login");
		expect(result?.reason).not.toContain(token);
	});
});

describe("checked PR description CLI", () => {
	test.each([
		"gh pr edit 7 -R acme/app --body-file /tmp/body",
		"env -u GITHUB_TOKEN gh pr edit 7 --body=''",
		"gh api -X PATCH repos/acme/app/pulls/7 -f body=",
		"gh api repos/acme/app/pulls/7 --input /tmp/request.json",
	])("blocks unchecked description write: %s", command => {
		const { result } = exercise("pr-description", { command });
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("pr_description");
	});

	test("a nonzero read with empty stdout never sends a PATCH", () => {
		const result = exercise("pr-description", {
			run: true,
			params: { repo: "acme/app", pr: 7, change: { kind: "append", text: "- [x] Reviewed" } },
			sequence: [
				{ code: 1, stdout: "", stderr: "API rate limit exceeded" },
				{ code: 0, stdout: JSON.stringify({ resources: { core: { reset: Math.floor(Date.now() / 1000) + 3600 } } }), stderr: "" },
			],
		}, quotaConfig());
		expect(result.run.isError).toBe(true);
		expect(result.text).toContain("REST quota exhausted");
		expect(result.text).not.toContain("auth login");
		expect(result.executed).toEqual([["api", "repos/acme/app/pulls/7"], ["api", "rate_limit"]]);
	});

	test("the registered tool preserves original text, rechecks, then patches", () => {
		const response = { code: 0, stdout: JSON.stringify({ body: "Original summary.\n- [ ] Reviewed\n", updated_at: "2026-10-26T12:00:00Z" }), stderr: "" };
		const result = exercise("pr-description", {
			run: true,
			params: { repo: "acme/app", pr: 7, change: { kind: "replace-text", oldText: "- [ ] Reviewed", newText: "- [x] Reviewed" } },
			sequence: [response, response, { code: 0, stdout: "{}", stderr: "" }],
		});
		expect(result.run.isError).toBe(false);
		expect(result.text).toContain("Original description preserved");
		expect(result.executed).toEqual([
			["api", "repos/acme/app/pulls/7"],
			["api", "repos/acme/app/pulls/7"],
			["api", "-X", "PATCH", "repos/acme/app/pulls/7", "-f", "body=Original summary.\n- [x] Reviewed\n"],
		]);
	});
});

describe("ship_stage review gates", () => {
	// Records `stage` for a PR with this body changing `file`, checked from a checkout with `reviewPaths` and `uiPaths`.
	const record = (stage: string, body: string, file: string, reviewPaths?: string, uiPaths?: string) => {
		const pullRequest = {
			state: "OPEN", isDraft: true, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: null, body,
			changedFiles: 1, files: { nodes: [{ path: file }] },
			reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
			commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
		};
		return exercise("ship", {
			run: true, cwd: checkout(reviewPaths, uiPaths),
			params: { stage, pr: 7, repo: "owner/name" },
			response: { code: 0, stderr: "", stdout: JSON.stringify({ data: { repository: { pullRequest } } }) },
		}).run;
	};

	test.each([["- [x] Thermo-nuclear code quality review", false], ["Unreviewed PR", true]])("the first call naming the PR reads its body (%s)", (body, isError) => {
		expect(record("ready_gate", body, "README.md")).toEqual({ isError, stage: isError ? null : "ready_gate" });
	});

	test.each([["README.md", false], ["src/shared/protocol.ts", true]])("with review paths, an unreviewed PR changing %s is held: %s", (file, isError) => {
		expect(record("ready_gate", "Unreviewed PR", file, "src/shared/**\n")).toEqual({ isError, stage: isError ? null : "ready_gate" });
	});

	test.each(["thermonuclear", "ready_gate"])("with ui paths, recording %s without the interface box is refused", stage => {
		expect(record(stage, "- [x] Thermo-nuclear code quality review", "web/app.tsx", undefined, "web/**/*.tsx\n")).toEqual({ isError: true, stage: null });
	});

	test.each(["thermonuclear", "ready_gate"])("with ui paths, recording %s with the interface box passes", stage => {
		const body = "- [x] Interface review\n- [x] Thermo-nuclear code quality review";
		expect(record(stage, body, "web/app.tsx", undefined, "web/**/*.tsx\n")).toEqual({ isError: false, stage });
	});

	test("without ui paths, a PR changing web/app.tsx records thermonuclear without the interface box", () => {
		expect(record("thermonuclear", "Unreviewed PR", "web/app.tsx")).toEqual({ isError: false, stage: "thermonuclear" });
	});

	test("quota exhaustion exposes stale status and cannot advance the ready gate", () => {
		const result = exercise("ship", {
			run: true,
			params: { stage: "ready_gate", pr: 7, repo: "owner/name" },
			sequence: [
				{ code: 1, stdout: JSON.stringify({ data: { repository: null }, errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }), stderr: "" },
				{ code: 0, stdout: JSON.stringify({ resources: { graphql: { remaining: 0, reset: Math.floor(Date.now() / 1000) + 3600 } } }), stderr: "" },
			],
		}, quotaConfig());
		expect(result.run.isError).toBe(true);
		expect(result.text).toContain("stale GitHub status");
		expect(result.text).toContain("GraphQL quota exhausted");
		expect(result.executed).toHaveLength(2);
		expect(result.executed[1]).toEqual(["api", "rate_limit"]);
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
	writeFileSync(join(root, "main", ".gitignore"), ".env\nforced.txt\n");
	writeFileSync(join(root, "main", "forced.txt"), "");
	git("-C", "main", "add", "-f", "forced.txt");
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

	test.each([[true, false], [false, true]])("an ignored file in the main checkout, approved %p, is blocked: %p", (approve, blocked) => {
		const { result, confirmations } = exercise("worktree-guard", { write: join(root, "main", ".env"), approve });
		expect(result?.block ?? false).toBe(blocked);
		expect(confirmations).toBe(1);
	});

	test("an ignored file in a session that cannot ask stays blocked without sending the agent to a worktree", () => {
		const { result } = exercise("worktree-guard", { write: join(root, "main", ".env") });
		expect(result?.block).toBe(true);
		expect(result?.reason).not.toContain("git worktree add");
	});

	test.each(["file.txt", "forced.txt"])("%s, which git does not ignore, is blocked without asking", file => {
		const { result, confirmations } = exercise("worktree-guard", { write: join(root, "main", file), approve: true });
		expect(result?.block).toBe(true);
		expect(confirmations).toBe(0);
	});
});

describe("checkout ownership", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "checkout-owner-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	// No user or system config: a hook or a signing key there would change what the commands below do.
	const env = {
		GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com",
	};
	const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe", env: { ...process.env, ...env } }).trim();
	let repos = 0;
	// A repository with one commit on `main` and `other`, checked out on `feat`.
	const repo = () => {
		const dir = join(root, `repo-${++repos}`);
		mkdirSync(dir);
		git(dir, "init", "-q", "-b", "main");
		writeFileSync(join(dir, "file.txt"), "start\n");
		git(dir, "add", "file.txt");
		git(dir, "commit", "-q", "-m", "start");
		git(dir, "branch", "other");
		git(dir, "switch", "-q", "-c", "feat");
		return dir;
	};
	// Each list runs in one new omp process; a call is a write, a bash command, another process's command, or a shutdown.
	const calls = (list: object[]) => exercise("worktree-guard", { calls: list }, env).results;
	const claimFile = (dir: string) => join(git(dir, "rev-parse", "--path-format=absolute", "--git-dir"), "omp-checkout-owner.json");
	// The test process is alive for as long as the omp processes it starts, so its claim reads as another live session's.
	const claimByAnother = (dir: string, owner: object = {}) => {
		const started = execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).trim();
		writeFileSync(claimFile(dir), JSON.stringify({ pid: process.pid, started, session: "theirs", at: new Date().toISOString(), ...owner }));
	};
	// `true` for the block that names the test's claim on `dir`, else the reason itself, so a mismatch shows which reason came back.
	const held = (reason: string | null, dir: string) => (reason?.includes(`session theirs, pid ${process.pid}`) && reason.includes(`delete ${claimFile(dir)}`)) || reason;

	test("another live session's checkout with uncommitted changes takes no switch, commit, or edit, while reads and a worktree of one's own pass", () => {
		const dir = repo();
		writeFileSync(join(dir, "file.txt"), "theirs\n");
		claimByAnother(dir);
		const worktree = `${dir}-wt`;
		const results = calls([
			{ bash: "git checkout main", cwd: dir },
			{ bash: "git commit -qam mine", cwd: dir },
			{ write: join(dir, "file.txt") },
			{ bash: "git status && git log -1", cwd: dir },
			{ bash: `git worktree add -q -b mine ${worktree} main`, cwd: dir },
			{ write: join(worktree, "file.txt") },
			{ bash: "git commit -qam mine", cwd: worktree },
		]);
		expect(results.map(reason => held(reason, dir))).toEqual([true, true, true, null, null, null, null]);
		expect([git(dir, "branch", "--show-current"), readFileSync(join(dir, "file.txt"), "utf8")]).toEqual(["feat", "theirs\n"]);
		expect(git(worktree, "log", "-1", "--format=%s")).toBe("mine");
	});

	test("another live session's linked worktree with uncommitted changes cannot be removed or moved from another checkout", () => {
		const dir = repo();
		const worktree = `${dir}-theirs`;
		git(dir, "worktree", "add", "-q", "-b", "theirs", worktree);
		writeFileSync(join(worktree, "file.txt"), "theirs\n");
		claimByAnother(worktree);
		const results = calls([
			{ bash: `git worktree remove --force ${worktree}`, cwd: dir },
			{ bash: `git worktree move ${basename(worktree)} ${dir}-moved`, cwd: root },
		]);
		expect(results.map(reason => held(reason, worktree))).toEqual([true, true]);
		expect(readFileSync(join(worktree, "file.txt"), "utf8")).toBe("theirs\n");
	});

	test("a rebase paused on a clean tree still holds the checkout", () => {
		const dir = repo();
		git(dir, "commit", "-q", "--allow-empty", "-m", "theirs");
		git(dir, "-c", "sequence.editor=sed -i.bak s/^pick/edit/", "rebase", "-q", "-i", "--keep-empty", "main");
		claimByAnother(dir);
		const [reason] = calls([{ bash: "git switch main", cwd: dir }]);
		expect(held(reason, dir)).toBe(true);
	});

	test("a clean checkout passes to the next session that changes it", () => {
		const dir = repo();
		claimByAnother(dir);
		expect(calls([{ bash: "git merge -q other", cwd: dir, sessionId: "next" }])).toEqual([null]);
		expect(JSON.parse(readFileSync(claimFile(dir), "utf8"))).toMatchObject({ session: "next" });
	});

	test.each([
		["has ended", { pid: spawnSync("true").pid }],
		["reused its pid", { started: "Thu Jan  1 00:00:00 1970" }],
	])("a claim whose process %s passes to the next session", (_, owner) => {
		const dir = repo();
		writeFileSync(join(dir, "file.txt"), "theirs\n");
		claimByAnother(dir, owner);
		expect(calls([{ bash: "git commit -qam mine", cwd: dir, sessionId: "next" }])).toEqual([null]);
		expect(JSON.parse(readFileSync(claimFile(dir), "utf8"))).toMatchObject({ session: "next" });
	});

	test.each(["feat", "main"])("after another process switches the checkout to main, changes wait for a switch to %s that succeeds", target => {
		const dir = repo();
		const results = calls([
			{ write: join(dir, "file.txt") },
			{ external: "git checkout -q main", cwd: dir },
			{ write: join(dir, "file.txt") },
			{ bash: "git switch -c rescue", cwd: dir },
			{ bash: "git switch -q nope", cwd: dir },
			{ bash: `git switch -q ${target} && git commit -qam work`, cwd: dir },
			{ bash: `git switch -q ${target}`, cwd: dir },
			{ bash: "git commit -qam work", cwd: dir },
		]);
		const drift = "is on `main`, but this session left it on `feat`: another process switched it.";
		expect(results.map(reason => reason?.includes(drift) ?? null)).toEqual([null, null, true, true, null, true, null, null]);
		expect([git(dir, "branch", "--show-current"), git(dir, "log", "-1", "--format=%s")]).toEqual([target, "work"]);
	});

	test("after another process switches the checkout, switches pass and every other change waits", () => {
		const dir = repo();
		const blocked = {
			"git checkout feat": false, "git checkout feat 2>/dev/null": false, "git switch feat": false, "gt co feat": false, "gh pr checkout 7": false,
			"git checkout -b x": true, "git checkout -- file.txt": true, "git checkout .": true, "git checkout feat file.txt": true, "git switch -c x": true,
			"gt create x": true, "gt m -a": true, "git stash": true, "git stash pop": true, "git reset --hard": true, "git branch -m x": true,
			"git -c core.pager=cat commit": true, "git switch feat; git commit": true,
			"env GIT_EDITOR=true git rebase --continue": true, "env -u GIT_DIR git commit": true, "nohup env -i git commit": true,
			"command git commit": true, 'bash -c "git commit -qam x"': true, "sh -c 'git checkout feat'": false,
			"git status": false, "git stash list": false, "git branch x": false, "git worktree list": false, "gt log": false, "gt submit": false,
			"gh pr view": false, "echo git commit": false, "git constructor": false, "bash -lc 'git status'": false,
		};
		const commands = Object.keys(blocked);
		const results = calls([
			{ write: join(dir, "file.txt") },
			{ external: "git checkout -q main", cwd: dir },
			...commands.map(bash => ({ bash, cwd: dir, dry: true })),
		]);
		expect(Object.fromEntries(commands.map((command, i) => [command, results[i + 2] !== null]))).toEqual(blocked);
	});

	test("this session's own branch changes move where it expects HEAD, a failed command that moved HEAD included", () => {
		const dir = repo();
		const results = calls([
			{ write: join(dir, "file.txt") },
			{ bash: "git switch -q -c feat2", cwd: dir },
			{ write: join(dir, "file.txt") },
			{ bash: "git switch -q other && false", cwd: dir },
			{ bash: "git commit -qam work", cwd: dir },
		]);
		expect(results).toEqual([null, null, null, null, null]);
		expect([git(dir, "branch", "--show-current"), git(dir, "log", "-1", "--format=%s")]).toEqual(["other", "work"]);
	});

	test("a subagent shares its session's checkout and its view of HEAD", () => {
		const dir = repo();
		const results = calls([
			{ write: join(dir, "file.txt") },
			{ write: join(dir, "file.txt"), agent: "sub", sessionId: "sub" },
			{ bash: "git commit -qam work", cwd: dir, agent: "sub" },
			{ external: "git checkout -q main", cwd: dir },
			{ write: join(dir, "file.txt"), agent: "sub" },
		]);
		expect(results.map(reason => reason?.includes("but this session left it on `feat`") ?? null)).toEqual([null, null, null, null, true]);
	});

	test.each([["main", false], ["sub", true]])("shutting down a %s session keeps the claim: %p", (agent, kept) => {
		const dir = repo();
		calls([{ write: join(dir, "file.txt") }, { shutdown: true, agent }]);
		expect(existsSync(claimFile(dir))).toBe(kept);
	});

	test("a command changes the checkout its cd, -C, or --cwd names, and one named through a variable waits", () => {
		const dir = repo();
		writeFileSync(join(dir, "file.txt"), "theirs\n");
		claimByAnother(dir);
		const name = basename(dir);
		const expected = {
			[`cd ${name} && git commit -qam x`]: "held",
			[`git -C ${name} commit -qam x`]: "held",
			[`git -C ${dir}/.. -C ${name} stash`]: "held",
			[`gt --cwd ${dir} modify -a`]: "held",
			[`gt --cwd=${dir} modify -a`]: "held",
			[`cd ${name}; cd ..; git commit -qam x`]: null,
			[`cd -P ${name} && git commit -qam x`]: "held",
			[`bash -c "cd ${name} && git commit -qam x"`]: "held",
			[`env -C ${name} git commit -qam x`]: "held",
			[`env -u GIT_DIR --chdir=${dir} git commit -qam x`]: "held",
			[`env -C ${name} true; git commit -qam x`]: null,
			[`env -C "$REPO" git commit -qam x`]: "unlocated",
			[`git -C "$REPO" commit -qam x`]: "unlocated",
			[`cd "$(mktemp -d)" && git commit`]: "unlocated",
			[`pushd && git commit`]: "unlocated",
			[`git -C "$REPO" status`]: null,
		};
		const commands = Object.keys(expected);
		const results = calls(commands.map(bash => ({ bash, cwd: root, dry: true })));
		const outcome = (reason: string | null) => (reason === null ? null : reason.includes("cannot locate") ? "unlocated" : held(reason, dir) === true ? "held" : reason);
		expect(Object.fromEntries(commands.map((command, i) => [command, outcome(results[i])]))).toEqual(expected);
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
	const call = (params: object, sessionId = "s1") => exercise("notes", { run: true, params, sessionId }, env);
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
		expect(added.note).toMatchObject({ title: "Findings", body: "The cache misses.", todoId: null, addedBy: "s1" });
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
