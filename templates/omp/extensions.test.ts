import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { packageDir } from "../../src/omp/install";
import { parseArtifactSave } from "../../src/shared/artifacts";

const loader = `
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
// The zod omp hands extensions as \`pi.zod\`, so a schema omp refuses to load fails here too.
const z = await import(createRequire(join(process.argv[2], "package.json")).resolve("@oh-my-pi/omptype/zod"));
const input = JSON.parse(process.argv[4]);
// Importing omp's exports takes about a second, so only a test that reads them asks for them.
const pi = input.omp ? await import(process.argv[2]) : undefined;
let tool;
// Every tool the extension registered, by name, for an extension that registers several.
const tools = {};
let confirmations = 0;
const executed = [];
let activeTools = ["artifact", "read"];
// input.entries seeds the session branch, such as the tool calls a stage gate reads.
const entries = [...(input.entries ?? [])];
// Each message the extension sent, with its delivery options.
const sent = [];
// input.usage lists the session's cumulative usage each read returns, as omp's usage statistics report it.
const sessionManager = { getSessionId: () => input.sessionId ?? "session", getArtifactsDir: () => input.artifactsDir ?? null, getUsageStatistics: () => input.usage?.shift() ?? { totalTokens: 0, cost: 0 }, getBranch: () => entries };
// Loads an extension as one omp session does and returns its handlers by event name.
function load(extension) {
	const hooks = {};
	extension({
		pi,
		zod: z,
		on(name, handler) { hooks[name] = handler; },
		registerTool(registered) { tool = registered; tools[registered.name] = registered; },
		getActiveTools() { return activeTools; },
		async setActiveTools(names) { activeTools = names; },
		appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
		// An idle session appends a next-turn message to its file, as omp does.
		sendMessage(message, options) {
			sent.push({ message, options });
			if (options?.deliverAs === "nextTurn") entries.push({ type: "custom_message", customType: message.customType, content: message.content });
		},
		// input.byArg answers by an argument anywhere in the call, such as "n=53" for one PR's read; input.responses answers by subcommand, such as "pr view" or "repo view", or "env -u GITHUB_TOKEN pr view" for gh run without that variable; input.at answers by directory first; input.response answers the rest.
		async exec(command, args, options) {
			// gh run as "env -u NAME… gh args" is recorded as "env -u NAME… args".
			const unset = [];
			let rest = args;
			if (command === "env") {
				while (rest[0] === "-u") {
					unset.push(...rest.slice(0, 2));
					rest = rest.slice(2);
				}
				rest = rest.slice(1);
			}
			const prefix = unset.length ? ["env", ...unset] : [];
			executed.push([...prefix, ...rest]);
			const key = [...prefix, ...rest.slice(0, 2)].join(" ");
			const byArg = Object.entries(input.byArg ?? {}).find(([arg]) => rest.includes(arg))?.[1];
			return byArg ?? input.sequence?.shift() ?? input.at?.[options.cwd]?.[key] ?? input.responses?.[key] ?? input.response;
		},
	});
	return hooks;
}
// The same harness loads whichever installed extension the caller selects.
const hooks = load((await import(process.argv[3])).default);
if (input.subToolStart) {
	await hooks.session_start({ type: "session_start" }, { agent: { kind: "sub" } });
	console.log(JSON.stringify({ activeTools }));
} else if (input.command) {
	if (!hooks.tool_call) throw new Error("No command gate registered");
	const result = await hooks.tool_call({ toolName: "bash", input: { command: input.command, cwd: input.bashCwd } }, {
		cwd: input.cwd ?? process.cwd(), hasUI: true,
		ui: { async confirm() { confirmations++; return input.approve; } },
	});
	console.log(JSON.stringify({ result: result ?? null, confirmations, executed }));
} else if (input.toolCall) {
	const result = await hooks.tool_call({ type: "tool_call", toolCallId: "call", ...input.toolCall }, { cwd: process.cwd(), hasUI: false, sessionManager, agent: { kind: "main" } });
	console.log(JSON.stringify({ result: result ?? null }));
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
	// The background jobs still running, as omp's job snapshot lists them.
	const running = new Set();
	for (const call of input.calls) {
		const cwd = call.cwd ?? process.cwd();
		const ctx = { cwd, hasUI: false, sessionManager: { getSessionId: () => call.sessionId ?? "session" }, agent: { kind: call.agent ?? "main" }, getAsyncJobSnapshot: () => ({ running: [...running].map(id => ({ id, type: "bash" })), recent: [] }) };
		const session = call.agent === "sub" ? sub : hooks;
		let reason = null;
		// external is another process changing the checkout outside omp.
		if (call.external) spawnSync("bash", ["-c", call.external], { cwd, stdio: "ignore" });
		else if (call.shutdown) await session.session_shutdown({ type: "session_shutdown" }, ctx);
		// ended is a background job that finished.
		else if (call.ended) running.delete(call.ended);
		// apply is an isolated subagent's changes about to land in that checkout.
		else if (call.apply) reason = (await session.before_subagent_apply({ type: "before_subagent_apply", agent: "task", agentId: "Child", invocationKind: "task", checkout: call.apply, merge: "patch" }, ctx))?.reason ?? null;
		else {
			const event = { toolCallId: String(results.length), ...(call.write ? { toolName: "write", input: { path: call.write } } : call.read ? { toolName: "read", input: { path: call.read } } : { toolName: "bash", input: { command: call.bash } }) };
			reason = (await session.tool_call(event, ctx))?.reason ?? null;
			// An allowed call runs, unless dry asks only for the guard's answer.
			if (reason === null && !call.dry && !call.read) {
				if (call.write) writeFileSync(call.write, ctx.sessionManager.getSessionId() + "\\n");
				// background is the id of the job omp moves the command to: its result comes back before the command runs.
				else if (call.background) {
					running.add(call.background);
					await session.tool_result({ ...event, isError: false, details: { async: { state: "running", jobId: call.background, type: "bash" } } }, ctx);
					spawnSync("bash", ["-c", call.bash], { cwd, stdio: "ignore" });
				} else await session.tool_result({ ...event, isError: spawnSync("bash", ["-c", call.bash], { cwd, stdio: "ignore" }).status !== 0 }, ctx);
			}
		}
		results.push(reason);
	}
	console.log(JSON.stringify({ results }));
} else if (input.starts) {
	// Each mode starts the same session file again, as a resume does; the entries are what the file gained.
	for (const mode of input.starts) await hooks.session_start({ type: "session_start" }, { mode, sessionManager: { getBranch: () => entries } });
	console.log(JSON.stringify({ entries }));
} else if (input.runs) {
	// Several calls in one session, one after another, or all at once with parallel, as an agent's parallel tool calls run.
	// A run with $tool calls the tool of that name, and one with $prompt starts a user turn, whose text is the message the extension adds.
	// A run with $event emits that session event; with $reload the extension loads again first, as a resumed session does, and session_compact first appends a compaction entry, as omp does.
	const ctx = { cwd: input.cwd ?? process.cwd(), hasUI: false, mode: "interactive", sessionManager, agent: { kind: input.agent ?? "main" }, setInterval() {}, isIdle: () => true };
	let session = hooks;
	let reloads = 0;
	const call = async ({ $tool, $prompt, $event, $reload, ...params }) => {
		if ($event) {
			if ($reload) session = load((await import(process.argv[3] + "?reload" + ++reloads)).default);
			if ($event === "session_compact") entries.push({ type: "compaction" });
			await session[$event]({ type: $event }, ctx);
			return { content: [] };
		}
		if (!$prompt) return ($tool ? tools[$tool] : tool).execute("call", params, undefined, undefined, ctx);
		const added = await hooks.before_agent_start({ type: "before_agent_start", reason: "user" }, ctx);
		return { content: [{ text: added?.message.content ?? null }] };
	};
	const results = [];
	if (input.parallel) results.push(...(await Promise.all(input.runs.map(call))));
	else for (const params of input.runs) results.push(await call(params));
	console.log(JSON.stringify({ runs: results.map(result => ({ isError: result.isError ?? false, text: result.content?.[0]?.text ?? null, details: result.details ?? null })), executed, entries, sent }));
} else if (input.run) {
	const result = await tool.execute("call", input.params, undefined, undefined, { cwd: input.cwd ?? process.cwd(), hasUI: false, sessionManager });
	console.log(JSON.stringify({ run: { isError: result.isError ?? false, stage: result.details?.state?.stage ?? null }, text: result.content?.[0]?.text ?? null, executed }));
} else {
	if (!tool) throw new Error("No tool schema registered");
	console.log(JSON.stringify({ valid: tool.parameters.safeParse(input.params).success }));
}
`;

function exercise(name: "artifact" | "ship" | "todos" | "project" | "worktree-guard" | "pr-description" | "headless-mark" | "arena" | "chrome-devtools-page" | "end-session", input: object, env: Record<string, string> = {}): {
	result: { block?: boolean; reason?: string; input?: Record<string, unknown> } | null;
	confirmations: number;
	valid: boolean;
	run: { isError: boolean; stage: string | null };
	runs: { isError: boolean; text: string | null; details: unknown }[];
	text: string | null;
	results: (string | null)[];
	executed: string[][];
	entries: { customType: string; data: unknown }[];
	sent: { message: { customType: string; content: string; display: boolean }; options: { deliverAs?: string } }[];
	activeTools: string[];
} {
	// A config directory of the call's own unless the test passes one, so what an extension records there, such as the ship trace, reaches no other test or the user's.
	const child = Bun.spawnSync([
		process.execPath, "run", "-", packageDir,
		join(import.meta.dir, `agent/extensions/${name}.ts`), JSON.stringify(input),
	], { stdin: Buffer.from(loader), stdout: "pipe", stderr: "pipe", env: { ...Bun.env, ...quotaConfig(), ...env } });
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
/**
 * A checkout of the test's own, with `reviewPaths` as its `.omp/review-paths` and `uiPaths` as its `.omp/ui-paths` when given, so this repository's files reach no test.
 * With `mainCheckout` it is a linked worktree of that checkout, whose `.git` is a file.
 */
function checkout(reviewPaths?: string, uiPaths?: string, mainCheckout?: string): string {
	const dir = mkdtempSync(join(tmpdir(), "ship-checkout-"));
	checkouts.push(dir);
	if (mainCheckout) writeFileSync(join(dir, ".git"), `gitdir: ${join(mainCheckout, ".git/worktrees", basename(dir))}\n`);
	else mkdirSync(join(dir, ".git"));
	mkdirSync(join(dir, ".omp"));
	if (reviewPaths !== undefined) writeFileSync(join(dir, ".omp/review-paths"), reviewPaths);
	if (uiPaths !== undefined) writeFileSync(join(dir, ".omp/ui-paths"), uiPaths);
	return dir;
}

/** `gh pr view --json body,changedFiles,additions,deletions,files,url` answering with this body and changed files, too many changed lines for the fast path, for PR 7 of `repository`, as `host/owner/name`. */
function prView(body: string, files: string[] = [], repository = "github.com/me/app") {
	return { code: 0, stdout: JSON.stringify({ body, changedFiles: files.length, additions: 200, deletions: 0, files: files.map(path => ({ path })), url: `https://${repository}/pull/7` }), stderr: "" };
}

/** gh's answers in a checkout of `checkoutOf`: `view` for the PR, and whether the user may push to the PR's repository `pr`, where `push: "error"` fails that read; both as `host/owner/name`. */
function answers(view: object, { checkoutOf = "github.com/me/app", pr = "github.com/me/app", push = true as boolean | "error" } = {}) {
	return {
		"pr view": view,
		[`api repos/${pr.slice(pr.indexOf("/") + 1)}`]: push === "error" ? { code: 1, stdout: "", stderr: "HTTP 404: Not Found" } : { code: 0, stdout: `${push}\n`, stderr: "" },
		"repo view": { code: 0, stdout: `https://${checkoutOf}\n`, stderr: "" },
	};
}

describe("ship publication gate", () => {
	test("a branch without a PR is blocked with draft-first recovery", () => {
		const { result } = exercise("ship", {
			command: "gh pr ready",
			response: { code: 1, stdout: "", stderr: 'no pull requests found for branch "feature"' },
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("gh pr create --draft");
	});

	test("authentication failure does not recommend creating another PR", () => {
		const { result } = exercise("ship", {
			command: "gh pr ready",
			response: { code: 1, stdout: "", stderr: "HTTP 401: Bad credentials" },
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("HTTP 401: Bad credentials");
		expect(result?.reason).not.toContain("gh pr create --draft");
	});

	test("an unreviewed PR cannot reach operator approval", () => {
		const { result, confirmations } = exercise("ship", {
			command: "gh pr ready", approve: true, cwd: checkout(),
			responses: answers(prView("Unreviewed PR", ["README.md"])),
		});
		expect(result?.block).toBe(true);
		expect(confirmations).toBe(0);
	});

	test.each([["README.md", false], ["src/shared/protocol.ts", true]])("with review paths, an unreviewed PR changing %s is blocked: %s", (file, blocked) => {
		const { result, confirmations } = exercise("ship", {
			command: "gh pr ready 7", approve: true, cwd: checkout("# Shared contracts\nsrc/shared/**\n"),
			responses: answers(prView("Unreviewed PR", [file])),
		});
		expect(result?.block ?? false).toBe(blocked);
		expect(confirmations).toBe(blocked ? 0 : 1);
	});

	test.each([false, true])("a reviewed PR requires operator approval (%s)", approve => {
		const { result, confirmations } = exercise("ship", {
			command: "gh pr ready", approve, cwd: checkout(),
			responses: answers(prView("- [x] Thermo-nuclear code quality review")),
		});
		expect(result?.block ?? false).toBe(!approve);
		expect(confirmations).toBe(1);
	});

	const UNCHECKED = "- [ ] Browser proof (UI changes: run verify-yampa, attach screenshot)";
	const CHECKED = "- [x] Browser proof (UI changes: run verify-yampa, attach screenshot)";
	test.each<[string, string | undefined, boolean]>([
		[UNCHECKED, "web/**/*.tsx\n", true],
		[CHECKED, "web/**/*.tsx\n", false],
		[UNCHECKED, "front/**\n", false],
		[UNCHECKED, undefined, false],
	])("a reviewed PR changing web/app.tsx with %j and ui paths %j is blocked: %s", (box, uiPaths, blocked) => {
		const { result, confirmations } = exercise("ship", {
			command: "gh pr ready 7", approve: true, cwd: checkout(undefined, uiPaths),
			responses: answers(prView(`## Checks\n${box}\n- [x] Interface review\n- [x] Thermo-nuclear code quality review`, ["web/app.tsx"])),
		});
		expect(result?.block ?? false).toBe(blocked);
		expect(confirmations).toBe(blocked ? 0 : 1);
		if (blocked) expect(result?.reason).toContain("- [ ] Browser proof");
	});

	test("a linked worktree without ui paths reads its main checkout's, so an unchecked proof box there blocks", () => {
		const worktree = checkout(undefined, undefined, checkout(undefined, "web/**/*.tsx\n"));
		const { result } = exercise("ship", {
			command: "gh pr ready 7", approve: true, cwd: worktree,
			responses: answers(prView(`## Checks\n${UNCHECKED}\n- [x] Interface review\n- [x] Thermo-nuclear code quality review`, ["web/app.tsx"])),
		});
		expect(result?.reason).toContain("- [ ] Browser proof");
	});

	test.each([[undefined, false], ["web/**/*.tsx\n", true]])("a reviewed PR changing web/app.tsx without the interface box, with ui paths %j, is blocked: %s", (uiPaths, blocked) => {
		const { result, confirmations } = exercise("ship", {
			command: "gh pr ready 7", approve: true, cwd: checkout(undefined, uiPaths),
			responses: answers(prView("- [x] Thermo-nuclear code quality review", ["web/app.tsx"])),
		});
		expect(result?.block ?? false).toBe(blocked);
		expect(confirmations).toBe(blocked ? 0 : 1);
		if (blocked) expect(result?.reason).toContain("- [x] Interface review");
	});

	// A reviewed PR, so an exempt one is never asked about, one of the user's is asked about, and one of another checkout's repository is refused.
	test.each<[string, string, boolean | "error", "unchecked" | "asked" | "refused"]>([
		["gh pr ready 7 -R dustinspecker/awesome-eslint >/dev/null", "github.com/dustinspecker/awesome-eslint", false, "unchecked"],
		["gh pr ready 7 -R me/app", "github.com/me/app", true, "asked"],
		["gh pr ready 7 -R me/app", "github.com/me/app", "error", "asked"],
		["gh pr ready 7 -R acme/app", "github.com/acme/app", true, "refused"],
		["gh pr ready 7 -R acme/app", "github.com/acme/app", "error", "refused"],
		["gh pr -R acme/app ready 7", "github.com/acme/app", true, "refused"],
		["gh pr ready https://github.com/acme/app/pull/7", "github.com/acme/app", true, "refused"],
		["gh pr ready 7 -R ghe.example.com/me/app", "ghe.example.com/me/app", true, "refused"],
	])("from a checkout of github.com/me/app, `%s` on a PR of %s with push permission %p is %s", (command, pr, push, outcome) => {
		const { result, confirmations } = exercise("ship", {
			command, approve: true, cwd: checkout(),
			responses: answers(prView("- [x] Thermo-nuclear code quality review", [], pr), { pr, push }),
		});
		expect(result?.block ?? false).toBe(outcome === "refused");
		expect(confirmations).toBe(outcome === "asked" ? 1 : 0);
		if (outcome === "refused") expect(result?.reason).toContain(`a checkout of ${pr}, but`);
	});

	test.each<[string, (dir: string) => { command: string; bashCwd?: string }]>([
		["cd", dir => ({ command: `cd ${dir} && gh pr ready 7` })],
		["env -C", dir => ({ command: `env -C ${dir} gh pr ready 7` })],
		["bash -c", dir => ({ command: `bash -c 'cd ${dir} && gh pr ready 7'` })],
		["the bash call's cwd", dir => ({ command: "gh pr ready 7", bashCwd: dir })],
	])("a publish run in another repository's checkout through %s reads the PR there", (_, call) => {
		const session = checkout();
		const app = checkout();
		const missing = { code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a PullRequest with the number of 7. (repository.pullRequest)" };
		const { result, confirmations } = exercise("ship", {
			...call(app), approve: true, cwd: session,
			at: { [session]: answers(missing, { checkoutOf: "github.com/me/agents" }), [app]: answers(prView("- [x] Thermo-nuclear code quality review")) },
		});
		expect(result).toBeNull();
		expect(confirmations).toBe(1);
	});

	test.each([["the linked worktree, which lists docs/**", false], ["the main checkout, which lists src/**", true]])("an unreviewed PR changing src/x.ts, published with a cd into %s, is blocked: %p", (target, blocked) => {
		const main = checkout("src/**\n");
		const worktree = checkout("docs/**\n", undefined, main);
		const [from, into] = target.startsWith("the main checkout") ? [worktree, main] : [main, worktree];
		const { result, confirmations } = exercise("ship", {
			command: `cd ${into} && gh pr ready 7`, approve: true, cwd: from,
			responses: answers(prView("Unreviewed PR", ["src/x.ts"])),
		});
		expect(result?.block ?? false).toBe(blocked);
		expect(confirmations).toBe(blocked ? 0 : 1);
	});

	test.each(['cd "$REPO" && gh pr ready 7', "GH_REPO=me/other gh pr ready 7"])("`%s` is blocked before gh reads any PR", command => {
		const { result, confirmations, executed } = exercise("ship", {
			command, approve: true, cwd: checkout(),
			responses: answers(prView("- [x] Thermo-nuclear code quality review")),
		});
		expect(result?.block).toBe(true);
		expect(confirmations).toBe(0);
		expect(executed).toEqual([]);
	});

	test("a publish run through `env` is gated", () => {
		const { result, confirmations } = exercise("ship", {
			command: "env -u GITHUB_TOKEN gh pr ready", approve: true, cwd: checkout(),
			responses: answers(prView("Unreviewed PR")),
		});
		expect(result?.block).toBe(true);
		expect(confirmations).toBe(0);
	});

	const rejectedToken = { state: "error", error: "non-200 OK status code: 401 Unauthorized", active: true, host: "github.com", login: "", tokenSource: "GITHUB_TOKEN", gitProtocol: "ssh" };
	const keyringLogin = { state: "success", active: false, host: "github.com", login: "octocat", tokenSource: "keyring", scopes: "repo", gitProtocol: "ssh" };
	const unauthorized = { code: 1, stdout: "", stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login -h github.com" };
	const authStatus = (credentials: object[]) => ({ code: 0, stdout: JSON.stringify({ hosts: { "github.com": credentials } }), stderr: "" });

	test("a rejected GITHUB_TOKEN ahead of a working login is dropped, and the gate reads the PR with that login", () => {
		const { result, confirmations, executed } = exercise("ship", {
			command: "gh pr ready", approve: true, cwd: checkout(),
			responses: {
				"pr view": unauthorized,
				"auth status": authStatus([rejectedToken, keyringLogin]),
				"env -u GITHUB_TOKEN pr view": prView("- [x] Thermo-nuclear code quality review"),
				"env -u GITHUB_TOKEN api repos/me/app": { code: 0, stdout: "true\n", stderr: "" },
				"env -u GITHUB_TOKEN repo view": { code: 0, stdout: "https://github.com/me/app\n", stderr: "" },
			},
		}, { GITHUB_TOKEN: "ghp_rejectedTokenForTest0000000000000000" });
		expect(result).toBeNull();
		expect(confirmations).toBe(1);
		expect(executed).toEqual([
			["pr", "view", "--json", "body,changedFiles,additions,deletions,files,url"],
			["auth", "status", "--json", "hosts"],
			["env", "-u", "GITHUB_TOKEN", "pr", "view", "--json", "body,changedFiles,additions,deletions,files,url"],
			["env", "-u", "GITHUB_TOKEN", "api", "repos/me/app", "--hostname", "github.com", "--jq", ".permissions.push"],
			["env", "-u", "GITHUB_TOKEN", "repo", "view", "--json", "url", "-q", ".url"],
		]);
	});

	test.each([["the token", true], ["ghp_launchValue", false]])("a rejected GITHUB_TOKEN with no working login and %s in the project's .env blames that file: %p", (fileValue, blamed) => {
		const project = mkdtempSync(join(tmpdir(), "ship-auth-"));
		const token = "ghp_rejectedTokenForTest0000000000000000";
		writeFileSync(join(project, ".env"), `GITHUB_TOKEN=${fileValue === "the token" ? token : fileValue}\n`);
		const { result, executed } = exercise("ship", {
			command: "gh pr ready", cwd: project,
			responses: { "pr view": unauthorized, "auth status": authStatus([rejectedToken]) },
		}, { GITHUB_TOKEN: token });
		rmSync(project, { recursive: true, force: true });
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("`GITHUB_TOKEN`");
		expect(result?.reason).toContain("gh auth login -h github.com");
		expect(result?.reason?.includes(join(project, ".env"))).toBe(blamed);
		expect(result?.reason).not.toContain(token);
		expect(executed.filter(words => words[0] === "pr")).toHaveLength(1);
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

	test("a rejected GITHUB_TOKEN ahead of a working login is dropped, and the tool reads the PR with that login", () => {
		const snapshot = { body: "Summary.", updated_at: "2026-10-26T12:00:00Z" };
		const result = exercise("pr-description", {
			run: true,
			params: { repo: "acme/app", pr: 7, change: { kind: "read" } },
			responses: {
				"api repos/acme/app/pulls/7": { code: 1, stdout: "", stderr: "gh: Bad credentials (HTTP 401)" },
				"auth status": { code: 0, stdout: JSON.stringify({ hosts: { "github.com": [
					{ host: "github.com", state: "error", active: true, login: "", tokenSource: "GITHUB_TOKEN" },
					{ host: "github.com", state: "success", active: false, login: "octocat", tokenSource: "keyring" },
				] } }), stderr: "" },
				"env -u GITHUB_TOKEN api repos/acme/app/pulls/7": { code: 0, stdout: JSON.stringify(snapshot), stderr: "" },
			},
		}, quotaConfig());
		expect(result.run.isError).toBeFalsy();
		expect(result.text).toContain("Summary.");
	});
});

describe("ship_stage review gates", () => {
	const INTERFACE_BOX = "- [x] Interface review";
	const THERMONUCLEAR_BOX = "- [x] Thermo-nuclear code quality review";
	// GitHub's answer to the gate's read of a PR with this body changing `file` by `additions` lines, by default too many for the fast path.
	const prRead = (body: string, file: string, isDraft = true, statusCheckRollup: object = { state: "SUCCESS" }, additions = 200) => {
		const pullRequest = {
			state: "OPEN", isDraft, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: null, body,
			changedFiles: 1, additions, deletions: 0, files: { nodes: [{ path: file }] },
			reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
			commits: { nodes: [{ commit: { statusCheckRollup } }] },
		};
		return { code: 0, stderr: "", stdout: JSON.stringify({ data: { repository: { pullRequest } } }) };
	};
	// GitHub's REST answer for the PR body that the box check reads.
	const restRead = (body: string) => ({ code: 0, stderr: "", stdout: JSON.stringify({ body, updated_at: "2026-11-10T12:00:00Z" }) });
	const patched = { code: 0, stdout: "{}", stderr: "" };
	// A session branch where `bun test` passed, which the verified stages need.
	const entries = [
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "t", name: "bash", arguments: { command: "bun test" } }] } },
		{ type: "message", message: { role: "toolResult", toolCallId: "t", toolName: "bash", isError: false } },
	];
	// The output of the stage before each stage these tests record, which ship needs before it records the stage.
	const before: Record<string, object> = {
		thermonuclear: { interface_review: { verdicts: [] } },
		ready_gate: { thermonuclear: { verdicts: [] } },
		live: { ready_gate: { checks: [{ command: "bun test", result: "3 pass, 0 fail" }] } },
	};
	// Records `stage` for a PR with this body changing `file`, checked from a checkout with `reviewPaths` and `uiPaths`.
	const record = (stage: string, body: string, file: string, reviewPaths?: string, uiPaths?: string) => exercise("ship", {
		run: true, cwd: checkout(reviewPaths, uiPaths), params: { stage, pr: 7, repo: "owner/name", output: before[stage] }, entries,
		responses: { "api graphql": prRead(body, file), "api repos/owner/name/pulls/7": restRead(body), "api -X": patched },
	}, quotaConfig());
	// The body the box check wrote, or null when it wrote none.
	const written = (executed: string[][]) => executed.find(args => args[1] === "-X")?.at(-1)?.replace(/^body=/, "") ?? null;

	test("a box GitHub's status read misses but the PR body holds is left as it is", () => {
		const result = exercise("ship", {
			run: true, cwd: checkout(), params: { stage: "ready_gate", pr: 7, repo: "owner/name", output: before.ready_gate }, entries,
			responses: { "api graphql": prRead("Unreviewed PR", "README.md"), "api repos/owner/name/pulls/7": restRead(THERMONUCLEAR_BOX), "api -X": patched },
		}, quotaConfig());
		expect(result.run).toEqual({ isError: false, stage: "ready_gate" });
		expect(written(result.executed)).toBeNull();
	});

	test("recording ready_gate appends a missing thermonuclear box to the PR body", () => {
		const result = record("ready_gate", "Unreviewed PR", "README.md");
		expect(result.run).toEqual({ isError: false, stage: "ready_gate" });
		expect(written(result.executed)).toBe(`Unreviewed PR\n${THERMONUCLEAR_BOX}`);
		expect(result.text).toStartWith(`Checked \`${THERMONUCLEAR_BOX}\` in the PR body.`);
	});

	test.each([
		["a small PR skips both reviews on the fast path, with no verdicts", 10, true],
		["a large PR still needs the thermonuclear verdicts", 200, false],
	])("%s", (_, additions, fast) => {
		const env = quotaConfig();
		const result = exercise("ship", {
			run: true, cwd: checkout(), params: { stage: "ready_gate", pr: 7, repo: "owner/name", output: before.live }, entries,
			responses: { "api graphql": prRead("Small PR", "README.md", true, { state: "SUCCESS" }, additions), "api repos/owner/name/pulls/7": restRead("Small PR"), "api -X": patched },
		}, env);
		expect(result.run.isError).toBe(!fast);
		if (!fast) expect(result.text).toContain("Thermonuclear stage's output");
		expect(written(result.executed)).toBeNull();
		const line = JSON.parse(readFileSync(join(env.XDG_CONFIG_HOME!, "omp-agents/ship-trace.jsonl"), "utf8").trim());
		expect(line).toMatchObject({ stage: "ready_gate", recorded: fast, fastPath: fast });
	});

	test("recording ready_gate ticks the template's unchecked boxes in place", () => {
		const body = "## Checks\n- [ ] Interface review\n- [ ] Thermo-nuclear code quality review\n- [ ] Browser proof\n";
		const result = record("ready_gate", body, "web/app.tsx", undefined, "web/**/*.tsx\n");
		expect(result.run).toEqual({ isError: false, stage: "ready_gate" });
		expect(written(result.executed)).toBe(`## Checks\n${INTERFACE_BOX}\n${THERMONUCLEAR_BOX}\n- [ ] Browser proof\n`);
	});

	test("recording thermonuclear checks only the interface box, before its own review runs", () => {
		const result = record("thermonuclear", "Unreviewed PR", "web/app.tsx", undefined, "web/**/*.tsx\n");
		expect(result.run).toEqual({ isError: false, stage: "thermonuclear" });
		expect(written(result.executed)).toBe(`Unreviewed PR\n${INTERFACE_BOX}`);
	});

	test.each([["README.md", null], ["src/shared/protocol.ts", `Unreviewed PR\n${THERMONUCLEAR_BOX}`]])("with review paths, a PR changing %s gets the box only when it needs the review", (file, body) => {
		const result = record("ready_gate", "Unreviewed PR", file, "src/shared/**\n");
		expect(result.run).toEqual({ isError: false, stage: "ready_gate" });
		expect(written(result.executed)).toBe(body);
	});

	test("a PR body with both boxes records ready_gate without writing", () => {
		const result = record("ready_gate", `${INTERFACE_BOX}\n${THERMONUCLEAR_BOX}`, "web/app.tsx", undefined, "web/**/*.tsx\n");
		expect(result.run).toEqual({ isError: false, stage: "ready_gate" });
		expect(result.executed.filter(args => args[1] !== "graphql")).toEqual([]);
	});

	test("without ui paths, a PR changing web/app.tsx records thermonuclear without the interface box", () => {
		const result = record("thermonuclear", "Unreviewed PR", "web/app.tsx");
		expect(result.run).toEqual({ isError: false, stage: "thermonuclear" });
		expect(written(result.executed)).toBeNull();
	});

	test("a PR body the box check cannot read leaves the stage unrecorded", () => {
		const result = exercise("ship", {
			run: true, cwd: checkout(), params: { stage: "ready_gate", pr: 7, repo: "owner/name", output: before.ready_gate }, entries,
			responses: { "api graphql": prRead("Unreviewed PR", "README.md"), "api repos/owner/name/pulls/7": { code: 0, stdout: "{}", stderr: "" }, "api -X": patched },
		}, quotaConfig());
		expect(result.run).toEqual({ isError: true, stage: null });
		expect(result.text).toContain("so ready_gate is not recorded");
		expect(written(result.executed)).toBeNull();
	});

	test.each([
		["live", "Run `gh pr ready 7`"],
		["fix_ci", "Do the work without recording it"],
	])("recording %s on a draft names the next step instead of failing", (stage, next) => {
		const result = exercise("ship", { run: true, cwd: checkout(), params: { stage, pr: 7, repo: "owner/name", output: before[stage] }, response: prRead(THERMONUCLEAR_BOX, "README.md") });
		expect(result.run.isError).toBe(false);
		expect(result.text).toStartWith(`PR #7 is still a draft, so ${stage} is not recorded and the stage stays`);
		expect(result.text).toContain(next);
	});

	test("recording live on a PR under review records it", () => {
		const result = exercise("ship", { run: true, cwd: checkout(), params: { stage: "live", pr: 7, repo: "owner/name", output: before.live }, response: prRead(THERMONUCLEAR_BOX, "README.md", false) });
		expect(result.run).toEqual({ isError: false, stage: "live" });
	});

	test.each([
		["only a review gate fails", "SUCCESS", "waiting for review"],
		["a review gate and lint fail", "FAILURE", "Fix CI (checks failing)"],
		["a review gate fails while lint runs", null, "waiting for review · checks running"],
	])("live on a PR where %s reads its status from the other checks", (_, lint, summary) => {
		const check = (name: string, conclusion: string | null) => ({ name, status: conclusion ? "COMPLETED" : "IN_PROGRESS", conclusion });
		const nodes = [check("human-review", "FAILURE"), check("run-tests", "SUCCESS"), check("lint", lint)];
		const rollup = { state: "FAILURE", contexts: { totalCount: nodes.length, nodes } };
		const result = exercise("ship", { run: true, cwd: checkout(), params: { stage: "live", pr: 7, repo: "owner/name", output: before.live }, response: prRead(THERMONUCLEAR_BOX, "README.md", false, rollup) });
		expect(result.text).toContain(`Live: ${summary}`);
	});

	test("quota exhaustion exposes stale status and cannot advance the ready gate", () => {
		const result = exercise("ship", {
			run: true,
			params: { stage: "ready_gate", pr: 7, repo: "owner/name", output: before.ready_gate },
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

	// A PR under review whose checks fail, so each fix_ci round is live work GitHub has not shown done.
	const failing = prRead(THERMONUCLEAR_BOX, "README.md", false, { state: "FAILURE" });
	const fixCi = { stage: "fix_ci", pr: 7, repo: "owner/name" };

	test("each call naming a stage appends a trace line with what the session spent since the previous one", () => {
		const env = quotaConfig();
		exercise("ship", {
			runs: [{ stage: "live", pr: 7, repo: "owner/name", output: before.live }, { ...fixCi, count: 2 }, {}],
			usage: [{ totalTokens: 100, cost: 0.5 }, { totalTokens: 250, cost: 1.25 }],
			cwd: checkout(), response: failing,
		}, env);
		const lines = readFileSync(join(env.XDG_CONFIG_HOME!, "omp-agents/ship-trace.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
		expect(lines.map(({ ts, ...line }) => (expect(Date.parse(ts)).not.toBeNaN(), line))).toEqual([
			{ session: "session", repo: "owner/name", pr: 7, stage: "live", tokens: 100, cost: 0.5, checks: "fail", recorded: true, output: before.live, fastPath: false },
			{ session: "session", repo: "owner/name", pr: 7, stage: "fix_ci", tokens: 150, cost: 0.75, round: 1, checks: "fail", recorded: true, fastPath: false },
		]);
	});

	test("a sixth fix_ci round on one PR is refused, traced, and sends the agent to the user", () => {
		const env = quotaConfig();
		const { runs } = exercise("ship", { runs: Array(6).fill(fixCi), cwd: checkout(), response: failing }, env);
		expect(runs.map(run => run.isError)).toEqual([false, false, false, false, false, true]);
		expect(runs[5]!.text).toContain("ask them with `ask`");
		const last = JSON.parse(readFileSync(join(env.XDG_CONFIG_HOME!, "omp-agents/ship-trace.jsonl"), "utf8").trim().split("\n").at(-1)!);
		expect(last).toMatchObject({ stage: "fix_ci", round: 6, recorded: false, refusal: runs[5]!.text });
	});

	test("the user's approval of more rounds starts the fix over", () => {
		const { runs } = exercise("ship", { runs: [...Array(6).fill(fixCi), { ...fixCi, moreRounds: true }], cwd: checkout(), response: failing });
		expect(runs.map(run => run.isError)).toEqual([false, false, false, false, false, true, false]);
	});
});

describe("ship_stage contract", () => {
	const contract = { goal: "Refuse a contract without checks", constraints: ["Keep the tool's schema"], files_to_change: ["src/a.ts", "src/new.test.ts"], test_first: "src/new.test.ts", done_when: ["bun test passes"] };
	// git's answer naming the files HEAD has among those asked for.
	const atHead = (...files: string[]) => ({ "ls-tree --full-tree": { code: 0, stdout: files.map(file => `${file}\n`).join(""), stderr: "" } });

	test.each([
		["an empty goal", { ...contract, goal: " " }, "contract.goal: must be non-empty"],
		["no done_when", { ...contract, done_when: [] }, "contract.done_when: must be at least length 1"],
		["an absolute path", { ...contract, files_to_change: ["/etc/passwd"] }, "contract.files_to_change.0: must be repository-relative"],
		["a path through ..", { ...contract, files_to_change: ["src/../../x.ts"] }, "contract.files_to_change.0: must be repository-relative"],
	])("a contract with %s is refused and the plan stays without one", (_, invalid, reason) => {
		const { runs, entries } = exercise("ship", { runs: [{ stage: "plan" }, { stage: "plan", contract: invalid }], cwd: checkout() });
		expect(runs[1]).toMatchObject({ isError: true });
		expect(runs[1]!.text).toContain(reason);
		expect(JSON.stringify(entries)).not.toContain("contract");
	});

	test("a contract changing a test HEAD already has is refused unless a constraint names test-change", () => {
		const old = { ...contract, files_to_change: ["src/old.test.ts"] };
		const refused = exercise("ship", { runs: [{ stage: "plan", contract: old }], cwd: checkout(), responses: atHead("src/old.test.ts") });
		expect(refused.runs[0]).toMatchObject({ isError: true });
		expect(refused.runs[0]!.text).toContain("files_to_change holds src/old.test.ts, which HEAD already has");
		expect(refused.executed).toEqual([["ls-tree", "--full-tree", "-r", "--name-only", "HEAD", "--", "src/old.test.ts"]]);
		const allowed = exercise("ship", { runs: [{ stage: "plan", contract: { ...old, constraints: ["test-change: the refusal text changes on purpose"] } }], cwd: checkout(), responses: atHead("src/old.test.ts") });
		expect(allowed.runs[0]!.isError).toBe(false);
		expect(allowed.executed).toEqual([]);
	});

	test("a contract adding a test HEAD lacks is recorded and shows on every read", () => {
		const { runs } = exercise("ship", { runs: [{ stage: "plan", contract }, {}], cwd: checkout(), responses: atHead() });
		expect(runs.map(run => run.isError)).toEqual([false, false]);
		expect(runs[1]!.text).toContain("Contract goal: Refuse a contract without checks\nConstraints:\n- Keep the tool's schema\nFiles to change:\n- src/a.ts\n- src/new.test.ts\nTest first: src/new.test.ts\nDone when:\n- bun test passes");
	});

	test("implement is refused until the plan records a contract", () => {
		const { runs } = exercise("ship", { runs: [{ stage: "plan" }, { stage: "implement" }, { stage: "plan", contract }, { stage: "implement" }], cwd: checkout(), responses: atHead() });
		expect(runs.map(run => run.isError)).toEqual([false, true, false, false]);
		expect(runs[1]!.text).toStartWith("Record the plan's contract before implementing");
		expect(runs[3]).toMatchObject({ details: { state: { stage: "implement" } } });
	});

	test("rejected approaches dedupe, survive a reload, and come back once after a resume and after each compaction", () => {
		const { runs, sent } = exercise("ship", {
			runs: [
				{ stage: "plan", contract }, { rejected: "Poll GitHub" }, { rejected: "  poll  github " }, { rejected: "A second queue" },
				{ $event: "session_start", $reload: true }, {}, { $event: "session_start", $reload: true }, { $event: "session_compact" },
			],
			cwd: checkout(), responses: atHead(),
		});
		expect(runs[5]!.text).toContain("Rejected approaches, never to propose again:\n- Poll GitHub\n- A second queue");
		expect(runs[5]!.text?.match(/poll github/gi)).toHaveLength(1);
		expect(sent).toHaveLength(2);
		for (const { message, options } of sent) {
			expect(message).toMatchObject({ customType: "omp-ship.brief", display: false });
			expect(message.content).toContain("Contract goal: Refuse a contract without checks");
			expect(message.content).toContain("- A second queue");
			expect(options).toEqual({ deliverAs: "nextTurn" });
		}
	});
});

describe("ship_stage merged", () => {
	// GitHub's answer to a read of a PR in `state`.
	const prIn = (state: "OPEN" | "MERGED") => {
		const pullRequest = {
			state, isDraft: false, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", reviewDecision: null, body: "",
			changedFiles: 1, additions: 200, deletions: 0, files: { nodes: [{ path: "README.md" }] },
			reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
			commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
		};
		return { code: 0, stderr: "", stdout: JSON.stringify({ data: { repository: { pullRequest } } }) };
	};
	const byArg = { "n=53": prIn("MERGED"), "n=54": prIn("OPEN"), "n=55": prIn("MERGED") };
	const merged = (pr: number) => ({ stage: "merged", pr, repo: "owner/name" });
	const reads = (executed: string[][], pr: number) => executed.filter(args => args.includes(`n=${pr}`)).length;

	test("each merged PR named after another merged one records merged, reading its own status", () => {
		const result = exercise("ship", { runs: [merged(55), merged(53)], byArg });
		expect(result.runs.map(run => run.isError)).toEqual([false, false]);
		expect(reads(result.executed, 53)).toBe(1);
	});

	test("an open PR named after a merged one is refused", () => {
		const result = exercise("ship", { runs: [merged(55), merged(54)], byArg });
		expect(result.runs.map(run => run.isError)).toEqual([false, true]);
		expect(result.runs[1]!.text).toBe("GitHub has not reported this PR merged.");
		expect(reads(result.executed, 54)).toBe(1);
	});

	test("parallel calls each check the PR they name", () => {
		const result = exercise("ship", { runs: [merged(55), merged(54), merged(53)], parallel: true, byArg });
		expect(result.runs.map(run => run.isError)).toEqual([false, true, false]);
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
	// `pinned` is on `main` with an `origin/HEAD` that holds a commit, not a branch, so it names no default; `detached` has no branch checked out.
	git("clone", "-q", "upstream", "pinned");
	git("-C", "pinned", "switch", "-q", "-c", "main");
	const tip = Bun.spawnSync(["git", "-C", join(root, "upstream"), "rev-parse", "HEAD"]).stdout.toString().trim();
	writeFileSync(join(root, "pinned", ".git", "refs", "remotes", "origin", "HEAD"), `${tip}\n`);
	git("clone", "-q", "upstream", "detached");
	git("-C", "detached", "switch", "-q", "--detach");
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test.each([["main", true], ["plain", true], ["feature", false], ["isolated/m", false]])("a first write in the %s clone", (checkout, blocked) => {
		const { result } = exercise("worktree-guard", { write: join(root, checkout, "file.txt") });
		expect(result?.block ?? false).toBe(blocked);
	});

	// `downstream` is on `trunk`, the default branch its `origin/HEAD` names; `feature` has no remote and is on neither `main` nor `master`.
	test.each([["main", true], ["downstream", true], ["pinned", true], ["feature", false], ["detached", false]])("a retried write in the %s checkout is blocked: %s", (checkout, blocked) => {
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
	// Each list runs in one new omp process; a call is a write, a bash command, an isolated subagent's apply, another process's command, or a shutdown.
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
		// omp's shell exports `GIT_SEQUENCE_EDITOR=true`, which outranks `-c sequence.editor`, so the editor goes in the environment.
		execFileSync("git", ["-C", dir, "rebase", "-q", "-i", "--keep-empty", "main"], { stdio: "pipe", env: { ...process.env, ...env, GIT_SEQUENCE_EDITOR: "sed -i.bak s/^pick/edit/" } });
		claimByAnother(dir);
		const [reason] = calls([{ bash: "git switch main", cwd: dir }]);
		expect(held(reason, dir)).toBe(true);
	});

	test("once the session works in a linked worktree, a relative path that opens the main checkout is blocked, and an absolute one passes", () => {
		const dir = repo();
		const worktree = `${dir}-mine`;
		git(dir, "worktree", "add", "-q", "-b", "mine", worktree, "main");
		const results = calls([
			{ read: "file.txt", cwd: dir },
			{ write: join(worktree, "file.txt") },
			{ read: "file.txt:1-5", cwd: dir },
			{ write: "file.txt", cwd: dir, dry: true },
			{ read: join(dir, "file.txt"), cwd: dir },
			{ read: join(worktree, "file.txt"), cwd: dir },
		]);
		expect(results.map(reason => reason?.includes(`works in the worktree ${worktree}`) ?? null)).toEqual([null, null, true, true, null, null]);
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
			"git checkout feat": false, "git checkout feat 2>/dev/null": false, "git switch feat": false, "gh pr checkout 7": false,
			"git checkout -b x": true, "git checkout -- file.txt": true, "git checkout .": true, "git checkout feat file.txt": true, "git checkout --theirs file.txt": true, "git switch -c x": true,
			"git stash": true, "git stash pop": true, "git reset --hard": true, "git branch -m x": true,
			"git -c core.pager=cat commit": true, "git switch feat; git commit": true,
			"env GIT_EDITOR=true git rebase --continue": true, "env -u GIT_DIR git commit": true, "nohup env -i git commit": true,
			"command git commit": true, 'bash -c "git commit -qam x"': true, "sh -c 'git checkout feat'": false,
			"if true; then git commit; fi": true, "for f in a; do git commit; done": true, "{ git commit; }": true, "! git commit": true, "echo then git commit": false,
			"git status": false, "git stash list": false, "git branch x": false, "git worktree list": false,
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

	// `feat` and `main` each change file.txt, so rebasing `feat` onto `main` stops on a conflict with HEAD detached.
	const conflicting = () => {
		const dir = repo();
		writeFileSync(join(dir, "file.txt"), "feat\n");
		git(dir, "commit", "-qam", "feat");
		git(dir, "switch", "-q", "main");
		writeFileSync(join(dir, "file.txt"), "main\n");
		git(dir, "commit", "-qam", "main");
		git(dir, "switch", "-q", "feat");
		return dir;
	};
	const drift = (reason: string | null) => reason?.includes("another process switched it") ?? null;

	test("this session's own rebase, run by a script it started, passes through its conflict to the end", () => {
		const dir = conflicting();
		const script = join(root, `rebase-${basename(dir)}.sh`);
		writeFileSync(script, "git rebase main\n");
		const results = calls([
			{ write: join(dir, "notes.txt") },
			{ bash: `sh ${script}`, cwd: dir },
			{ write: join(dir, "file.txt") },
			{ bash: "git checkout --theirs file.txt", cwd: dir },
			{ bash: "git add file.txt && GIT_EDITOR=true git rebase --continue", cwd: dir },
			{ bash: "git commit -q --allow-empty -m after", cwd: dir },
			{ write: join(dir, "file.txt") },
		]);
		expect(results).toEqual([null, null, null, null, null, null, null]);
		expect([git(dir, "branch", "--show-current"), git(dir, "log", "-1", "--format=%s")]).toEqual(["feat", "after"]);
	});

	test("a rebase under way takes edits and its abort, even one HEAD moved for without this session", () => {
		const dir = conflicting();
		const results = calls([
			{ write: join(dir, "notes.txt") },
			{ external: "git rebase main", cwd: dir },
			{ write: join(dir, "file.txt") },
			{ bash: "git rebase --abort", cwd: dir },
			{ write: join(dir, "notes.txt") },
		]);
		expect(results).toEqual([null, null, null, null, null]);
		expect(git(dir, "branch", "--show-current")).toBe("feat");
	});

	test("another process's switch still blocks after this session's bash calls that left HEAD alone", () => {
		const dir = repo();
		const results = calls([
			{ write: join(dir, "file.txt") },
			{ external: "git checkout -q main", cwd: dir },
			{ bash: "git status", cwd: dir },
			{ bash: "sh -c true", cwd: dir },
			{ write: join(dir, "file.txt") },
		]);
		expect(results.map(drift)).toEqual([null, null, null, null, true]);
	});

	test("HEAD a script of this session's bash call moved is its own once the call ends", () => {
		const dir = repo();
		const script = join(root, `switch-now-${basename(dir)}.sh`);
		writeFileSync(script, "git switch -q other\n");
		const results = calls([
			{ write: join(dir, "notes.txt") },
			{ bash: `sh ${script}`, cwd: dir },
			{ write: join(dir, "file.txt") },
		]);
		expect(results).toEqual([null, null, null]);
	});

	test("HEAD a background job of this session moves is its own while the job runs, and another process's switch once it ended and the session moved on blocks", () => {
		const dir = repo();
		const script = join(root, `switch-${basename(dir)}.sh`);
		writeFileSync(script, "git switch -q other\n");
		const results = calls([
			{ write: join(dir, "notes.txt") },
			{ bash: `sh ${script}`, cwd: dir, background: "bg_1" },
			{ write: join(dir, "file.txt") },
			{ ended: "bg_1" },
			{ bash: "git commit -qam work", cwd: dir },
			{ external: "git checkout -q main", cwd: dir },
			{ write: join(dir, "file.txt") },
		]);
		expect(results.map(drift)).toEqual([null, null, null, null, null, null, true]);
		expect(git(dir, "log", "-1", "--format=%s", "other")).toBe("work");
	});

	test("a background job does not cover another process's switch in a checkout it neither runs in nor changes, nor one made before it started", () => {
		const [dir, elsewhere, drifted] = [repo(), repo(), repo()];
		const results = calls([
			{ write: join(dir, "notes.txt") },
			{ write: join(elsewhere, "notes.txt") },
			{ write: join(drifted, "notes.txt") },
			{ external: "git checkout -q main", cwd: drifted },
			{ bash: "true", cwd: dir, background: "bg_1" },
			{ bash: "true", cwd: drifted, background: "bg_2" },
			{ external: "git checkout -q main", cwd: elsewhere },
			{ write: join(elsewhere, "file.txt") },
			{ write: join(drifted, "file.txt") },
		]);
		expect(results.map(drift)).toEqual([null, null, null, null, null, null, null, true, true]);
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

	test("a command changes the checkout its cd or -C names, one named through a variable waits, and one in a fresh mktemp directory passes", () => {
		const dir = repo();
		writeFileSync(join(dir, "file.txt"), "theirs\n");
		claimByAnother(dir);
		const name = basename(dir);
		const expected = {
			[`cd ${name} && git commit -qam x`]: "held",
			[`git -C ${name} commit -qam x`]: "held",
			[`git -C ${dir}/.. -C ${name} stash`]: "held",
			[`cd ${name}; cd ..; git commit -qam x`]: null,
			[`cd -P ${name} && git commit -qam x`]: "held",
			[`bash -c "cd ${name} && git commit -qam x"`]: "held",
			[`env -C ${name} git commit -qam x`]: "held",
			[`env -u GIT_DIR --chdir=${dir} git commit -qam x`]: "held",
			[`env -C ${name} true; git commit -qam x`]: null,
			[`env -C "$REPO" git commit -qam x`]: "unlocated",
			[`git -C "$REPO" commit -qam x`]: "unlocated",
			[`cd "$(mktemp -d)" && git commit`]: "unlocated",
			[`d=$(mktemp -d); cd $d && git init -q && git add f`]: null,
			[`d=$(mktemp -d) && git -C "\${d}/omp" apply x`]: null,
			[`d=$(mktemp -d); d=${name}; cd $d && git commit -qam x`]: "unlocated",
			[`pushd && git commit`]: "unlocated",
			[`git -C "$REPO" status`]: null,
		};
		const commands = Object.keys(expected);
		const results = calls(commands.map(bash => ({ bash, cwd: root, dry: true })));
		const outcome = (reason: string | null) => (reason === null ? null : reason.includes("cannot locate") ? "unlocated" : held(reason, dir) === true ? "held" : reason);
		expect(Object.fromEntries(commands.map((command, i) => [command, outcome(results[i])]))).toEqual(expected);
	});

	test("an isolated subagent's changes apply to the linked worktree its spawn names, never to the main checkout on its default branch", () => {
		const dir = repo();
		git(dir, "switch", "-q", "main");
		const worktree = `${dir}-wt`;
		git(dir, "worktree", "add", "-q", "-b", "work", worktree);
		const [onMain, inWorktree] = calls([{ apply: dir }, { apply: worktree }]);
		expect(onMain).toContain("main checkout, on its default branch `main`");
		expect(onMain).toContain("spawn each later editing subagent without `isolated`, naming that checkout's absolute path");
		expect(inWorktree).toBeNull();
	});

	test("an isolated subagent's changes do not apply to a checkout where another live session has uncommitted changes", () => {
		const dir = repo();
		writeFileSync(join(dir, "file.txt"), "theirs\n");
		claimByAnother(dir);
		const [reason] = calls([{ apply: dir }]);
		expect(held(reason, dir)).toBe(true);
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

describe("project_list, project_update, and the brief", () => {
	const roots: string[] = [];
	afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });
	/** A config directory whose project list has session `me` in Migration beside Launch, and the inbox the extension leaves its changes in. */
	function projectConfig(): { env: Record<string, string>; changes: () => unknown[] } {
		const root = mkdtempSync(join(tmpdir(), "project-update-"));
		roots.push(root);
		const config = join(root, "config", "omp-agents");
		mkdirSync(config, { recursive: true });
		const steps = [{ id: "s1", text: "Schema", done: true }, { id: "s2", text: "Backfill", done: false }];
		const projects = [
			{ id: "p1", name: "Migration", goal: "Move to Postgres", steps, decisions: [], log: [], sessionIds: ["me"], createdAt: "2026-11-20T00:00:00.000Z" },
			{ id: "p2", name: "Launch", goal: "", steps: [], decisions: ["Use pgvector"], log: [], sessionIds: [], createdAt: "2026-11-20T00:00:00.000Z" },
		];
		writeFileSync(join(config, "project-list.json"), JSON.stringify({ projects }));
		const inbox = join(config, "project-inbox");
		return { env: { XDG_CONFIG_HOME: join(root, "config") }, changes: () => (existsSync(inbox) ? readdirSync(inbox).sort().map(name => JSON.parse(readFileSync(join(inbox, name), "utf8"))) : []) };
	}
	const update = (params: object) => ({ $tool: "project_update", ...params });

	test("lists every project with its id, status, progress, and goal", () => {
		const { env } = projectConfig();
		const { runs } = exercise("project", { runs: [{ $tool: "project_list" }], sessionId: "me" }, env);
		expect(runs[0]!.text).toBe("- Migration (id p1), open, this session's project, 1 of 2 steps done, goal: Move to Postgres\n- Launch (id p2), open, 0 of 0 steps done");
	});

	test("joins any project by name, leaving a join for the dashboard, and returns its brief", () => {
		const { env, changes } = projectConfig();
		const { runs } = exercise("project", { runs: [update({ action: "join", projectId: "migration" }), update({ action: "join", projectId: "Nope" })], sessionId: "new" }, env);
		expect(runs[0]!.text).toContain("Joined Migration.");
		expect(runs[0]!.text).toContain("1. [x] Schema");
		expect(runs[1]).toMatchObject({ isError: true, text: 'No project has the id or name "Nope"; project_list lists them.' });
		expect(changes()).toEqual([{ op: "join", projectId: "p1", sessionId: "new" }]);
	});

	test("changes any project as its page does: its goal, name, archive, decisions, plan, sessions, and a new project", () => {
		const { env, changes } = projectConfig();
		const runs = [
			update({ action: "set_goal", projectId: "p2", goal: "Ship in May" }),
			update({ action: "archive", projectId: "launch" }),
			update({ action: "restore", projectId: "p2" }),
			update({ action: "rename", projectId: "p2", name: "Go live" }),
			update({ action: "remove_decision", projectId: "p2", text: "1" }),
			update({ action: "edit_step", step: "2", text: "Backfill rows" }),
			update({ action: "remove_step", step: "Schema" }),
			update({ action: "join", projectId: "p2", sessionId: "other" }),
			update({ action: "leave", sessionId: "other" }),
			update({ action: "create", name: "Launch  v2", goal: " Ship ", join: true }),
			update({ action: "leave" }),
		];
		const { runs: results } = exercise("project", { runs, sessionId: "me" }, env);
		expect(results.map(result => result.text)).toEqual([
			"Set the goal of Launch.",
			"Archived Launch.",
			"Restored Launch.",
			"Renamed Launch to Go live.",
			'Removed the decision "Use pgvector" from Go live.',
			'Changed the step "Backfill" to "Backfill rows".',
			'Removed the step "Schema" from Migration.',
			"Put session other in Go live.",
			"Session other left its project.",
			expect.stringMatching(/^Created the project Launch v2 \(id [\w-]+\), and this session joined it\.$/),
			"This session left its project.",
		]);
		expect(changes()).toEqual(
			expect.arrayContaining([
				{ op: "set-goal", projectId: "p2", goal: "Ship in May" },
				{ op: "archive", projectId: "p2", at: expect.any(String) },
				{ op: "restore", projectId: "p2" },
				{ op: "rename", projectId: "p2", name: "Go live" },
				{ op: "remove-decision", projectId: "p2", text: "Use pgvector" },
				{ op: "edit-step", projectId: "p1", stepId: "s2", text: "Backfill rows" },
				{ op: "remove-step", projectId: "p1", stepId: "s1" },
				{ op: "join", projectId: "p2", sessionId: "other" },
				{ op: "leave", sessionId: "other" },
				{ op: "create", id: expect.any(String), name: "Launch v2", goal: "Ship", at: expect.any(String) },
				{ op: "join", projectId: expect.any(String), sessionId: "me" },
				{ op: "leave", sessionId: "me" },
			]),
		);
		expect(changes()).toHaveLength(12);
	});

	test("ticks and unticks a step by number or text, adds a step, records a decision, and logs, each as a change for the dashboard", () => {
		const { env, changes } = projectConfig();
		const runs = [
			update({ action: "tick", step: "2" }),
			update({ action: "untick", step: "Schema" }),
			update({ action: "add_step", text: "Switch  the\nreads" }),
			update({ action: "add_decision", text: "Keep MySQL read-only" }),
			update({ action: "log", text: "Backfilled the rows" }),
		];
		const { runs: results } = exercise("project", { runs, sessionId: "me" }, env);
		expect(results.map(result => result.text)).toEqual(['Ticked "Backfill".', 'Unticked "Schema".', 'Added the step "Switch the reads" to Migration.', "Recorded the decision in Migration.", "Logged to Migration."]);
		expect(changes()).toEqual(
			expect.arrayContaining([
				{ op: "set-step", projectId: "p1", stepId: "s2", done: true },
				{ op: "set-step", projectId: "p1", stepId: "s1", done: false },
				{ op: "add-step", projectId: "p1", stepId: expect.any(String), text: "Switch the reads" },
				{ op: "add-decision", projectId: "p1", text: "Keep MySQL read-only" },
				{ op: "log", projectId: "p1", at: expect.any(String), sessionId: "me", text: "Backfilled the rows" },
			]),
		);
		expect(changes()).toHaveLength(5);
	});

	test("adds a whole plan with its sub-steps in one call, in order, on a new project or under a step", () => {
		const { env, changes } = projectConfig();
		const runs = [
			update({ action: "add_step", steps: [{ text: "Cut over", steps: [{ text: "Freeze writes" }, { text: "Switch  DNS" }] }, { text: "Clean up" }] }),
			update({ action: "add_step", parent: "2", steps: [{ text: "Verify counts" }] }),
			update({ action: "create", name: "Docs", steps: [{ text: "Outline" }] }),
			update({ action: "add_step", parent: "2", steps: [{ text: "Deep", steps: [{ text: "Deeper" }] }] }),
			update({ action: "add_step", steps: [{ text: " " }] }),
			update({ action: "add_step", steps: [] }),
		];
		const { runs: results } = exercise("project", { runs, sessionId: "me" }, env);
		expect(results.map(({ isError, text }) => ({ isError: isError ?? false, text }))).toEqual([
			{ isError: false, text: "Added 4 steps to Migration." },
			{ isError: false, text: 'Added 1 steps to Migration under "Backfill".' },
			{ isError: false, text: expect.stringMatching(/^Created the project Docs \(id [\w-]+\) with 1 plan steps\.$/) },
			{ isError: true, text: "A sub-step holds no steps of its own: a plan nests two levels at most." },
			{ isError: true, text: "Every step needs text." },
			{ isError: true, text: "add_step needs text or a non-empty steps." },
		]);
		const left = changes() as { op: string; stepId?: string; parentId?: string; text?: string; id?: string; projectId?: string }[];
		expect(left.map(change => change.text ?? change.op)).toEqual(["Cut over", "Freeze writes", "Switch DNS", "Clean up", "Verify counts", "create", "Outline"]);
		expect(left[1]!.parentId).toBe(left[0]!.stepId);
		expect(left[2]!.parentId).toBe(left[0]!.stepId);
		expect(left[3]!.parentId).toBeUndefined();
		expect(left[4]).toMatchObject({ projectId: "p1", parentId: "s2" });
		expect(left[6]).toMatchObject({ op: "add-step", projectId: left[5]!.id });
	});

	test("refuses an action missing what it needs, a step, decision, or project that is not there, and a session in no project, leaving no change", () => {
		const { env, changes } = projectConfig();
		const runs = [
			update({ action: "tick" }),
			update({ action: "tick", step: "nope" }),
			update({ action: "add_step", text: "  " }),
			update({ action: "add_decision" }),
			update({ action: "log" }),
			update({ action: "create" }),
			update({ action: "rename" }),
			update({ action: "set_goal" }),
			update({ action: "remove_decision", projectId: "p2", text: "9" }),
			update({ action: "archive", projectId: "Nope" }),
		];
		const { runs: results } = exercise("project", { runs, sessionId: "me" }, env);
		expect(results.map(({ isError, text }) => ({ isError, text }))).toEqual([
			{ isError: true, text: "tick needs the step's number or text." },
			{ isError: true, text: 'No step "nope" in the plan of Migration.' },
			{ isError: true, text: "add_step needs text." },
			{ isError: true, text: "add_decision needs text." },
			{ isError: true, text: "log needs text." },
			{ isError: true, text: "create needs a name." },
			{ isError: true, text: "rename needs a name." },
			{ isError: true, text: "set_goal needs a goal." },
			{ isError: true, text: 'No decision "9" in Launch.' },
			{ isError: true, text: 'No project has the id or name "Nope"; project_list lists them.' },
		]);
		expect(exercise("project", { runs: [update({ action: "log", text: "Done" })], sessionId: "stranger" }, env).runs[0]).toMatchObject({
			isError: true,
			text: "This session is in no open project; name one with projectId: Migration (id p1), Launch (id p2).",
		});
		expect(changes()).toEqual([]);
	});

	test("a prompt gets the brief again only once the project changed, counting a change the dashboard has not applied yet", () => {
		const { env } = projectConfig();
		const prompt = { $prompt: true };
		const { runs: results } = exercise("project", { runs: [prompt, prompt, update({ action: "add_step", text: "Ship it" }), prompt], sessionId: "me" }, env);
		expect(results[0]!.text).toContain("2. [ ] Backfill");
		expect(results[1]!.text).toBeNull();
		expect(results[3]!.text).toContain("3. [ ] Ship it");
	});
});

describe("user_todo Workspace", () => {
	const root = mkdtempSync(join(tmpdir(), "todos-extension-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const env = { XDG_CONFIG_HOME: join(root, "config"), HOME: root };
	const config = join(root, "config", "omp-agents");
	const inbox = join(config, "todo-inbox");
	const app = join(root, "code", "app");
	mkdirSync(app, { recursive: true });
	mkdirSync(config, { recursive: true });
	writeFileSync(
		join(config, "todos.json"),
		JSON.stringify({ todos: [{ id: "t1", text: "Ship the release", workspace: app, children: [{ id: "c1", text: "Tag it" }] }] }),
	);
	const call = (params: object) => exercise("todos", { run: true, params, cwd: root }, env);
	const left = () => (existsSync(inbox) ? readdirSync(inbox).sort().map(name => JSON.parse(readFileSync(join(inbox, name), "utf8"))) : []);
	const clear = () => rmSync(inbox, { recursive: true, force: true });

	test("add files a todo in the session's directory unless it names another, ~ allowed, or none", () => {
		clear();
		call({ action: "add", text: "Here" });
		call({ action: "add", text: "There", workspace: "~/code/app" });
		call({ action: "add", text: "Nowhere", workspace: "" });
		expect(left().map(change => [change.text, change.workspace])).toEqual([
			["Here", root],
			["There", app],
			["Nowhere", null],
		]);
	});

	test("a Workspace that is no directory is refused and nothing is written", () => {
		clear();
		const added = call({ action: "add", text: "Lost", workspace: join(root, "gone") });
		const edited = call({ action: "edit", id: "t1", text: "Renamed", workspace: join(root, "gone") });
		expect([added.run.isError, added.text, edited.run.isError]).toEqual([true, `Not a directory: ${join(root, "gone")}`, true]);
		expect(left()).toEqual([]);
	});

	test("edit sets or clears a top-level todo's Workspace and refuses one under another", () => {
		clear();
		call({ action: "edit", id: "t1", workspace: "code" });
		call({ action: "edit", id: "t1", workspace: "" });
		expect(call({ action: "edit", id: "c1", workspace: app }).run.isError).toBe(true);
		expect(left()).toEqual([
			{ op: "set-workspace", id: "t1", workspace: join(root, "code") },
			{ op: "set-workspace", id: "t1", workspace: null },
		]);
	});

	test("list names each todo's Workspace by its folder", () => {
		expect(call({ action: "list" }).text?.split("\n").slice(0, 2)).toEqual(["- Ship the release (id t1, Workspace app)", "  - Tag it (id c1)"]);
	});
});

describe("user_todo sections", () => {
	const root = mkdtempSync(join(tmpdir(), "todos-sections-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const env = { XDG_CONFIG_HOME: join(root, "config"), HOME: root };
	const config = join(root, "config", "omp-agents");
	const inbox = join(config, "todo-inbox");
	mkdirSync(config, { recursive: true });
	writeFileSync(join(config, "todos.json"), JSON.stringify({ todos: [{ id: "t1", text: "Ship the release" }] }));
	const call = (params: object) => exercise("todos", { run: true, params, cwd: root }, env);
	const left = () => (existsSync(inbox) ? readdirSync(inbox).sort().map(name => JSON.parse(readFileSync(join(inbox, name), "utf8"))) : []);

	test("add-section adds a section once, and add and edit file a todo in it before the dashboard applies it", () => {
		const added = call({ action: "add-section", section: " Website " });
		const again = call({ action: "add-section", section: "website" });
		const edited = call({ action: "edit", id: "t1", section: "Website" });
		const filed = call({ action: "add", text: "Review the page", section: "website" });
		const [section, categorized, add] = left();
		expect([added.run.isError, again.text, edited.run.isError, filed.text]).toEqual([false, 'The section "website" already exists.', false, `Added to the user's todo list (id ${add.id}).`]);
		expect(section).toMatchObject({ op: "add-category", name: "Website" });
		expect(categorized).toEqual({ op: "categorize", id: "t1", categoryId: section.id });
		expect(add).toMatchObject({ op: "add", text: "Review the page", categoryId: section.id });
	});
});

describe("headless-mark", () => {
	const starts = (...modes: string[]) => exercise("headless-mark", { starts: modes }).entries.map(entry => entry.data);

	test("marks a print or json run headless once, and an interactive or dashboard session not at all", () => {
		expect(starts("print", "print")).toEqual([{ headless: true }]);
		expect(starts("json")).toEqual([{ headless: true }]);
		expect(starts("tui", "rpc")).toEqual([]);
	});

	test("records the change when a session resumes in the other mode", () => {
		expect(starts("print", "tui", "print")).toEqual([{ headless: true }, { headless: false }, { headless: true }]);
	});
});

describe("chrome-devtools page", () => {
	const write = (path: string, content: string) => exercise("chrome-devtools-page", { toolCall: { toolName: "write", input: { path, content } } }).result;

	test("a page tool written without a pageId runs on page 1", () => {
		expect(write("xd://mcp__chrome_devtools_take_screenshot", '{"fullPage":true}')).toEqual({
			input: { path: "xd://mcp__chrome_devtools_take_screenshot", content: '{"fullPage":true,"pageId":1}' },
		});
	});

	test.each([
		["a call that names its page", "xd://mcp__chrome_devtools_take_screenshot", '{"pageId":2}'],
		["a tool that takes no page", "xd://mcp__chrome_devtools_list_pages", "{}"],
		["a tool whose page is the one it closes", "xd://mcp__chrome_devtools_close_page", "{}"],
		["a help request", "xd://mcp__chrome_devtools_take_screenshot", "help"],
		["another server's tool", "xd://mcp__linear_get_issue", "{}"],
		["a file", "/tmp/notes.json", "{}"],
	])("leaves %s alone", (_, path, content) => {
		expect(write(path, content)).toBeNull();
	});
});

describe("arena", () => {
	const runs = (calls: object[], agent = "main") => exercise("arena", { runs: calls, agent });
	const fanOut = { task: "Build the lanes", runners: ["RunA", "RunB", "RunC"] };

	test("records the whole arena on each call, from fan-out to the pick", () => {
		const { runs: results, entries } = runs([fanOut, { ...fanOut, judge: "Judge", base: "RunB", grafts: [{ from: "RunA", what: "Copy" }] }]);
		expect(results.map(result => result.isError)).toEqual([false, false]);
		expect(entries.map(entry => [entry.customType, entry.data])).toEqual([
			["omp-arena.state", { ...fanOut, judge: null, base: null, grafts: [] }],
			["omp-arena.state", { ...fanOut, judge: "Judge", base: "RunB", grafts: [{ from: "RunA", what: "Copy" }] }],
		]);
	});

	test.each([
		["a base outside the runners", { ...fanOut, base: "Other" }],
		["a graft from the base", { ...fanOut, base: "RunB", grafts: [{ from: "RunB", what: "Copy" }] }],
		["a graft from outside the runners", { ...fanOut, base: "RunB", grafts: [{ from: "Other", what: "Copy" }] }],
		["a runner named twice", { task: "T", runners: ["RunA", "RunA"] }],
		["a single runner", { task: "T", runners: ["RunA"] }],
		["a judge who is a runner", { ...fanOut, judge: "RunA" }],
	])("refuses %s and records nothing", (_case, params) => {
		const { runs: results, entries } = runs([params]);
		expect(results[0].isError).toBe(true);
		expect(entries).toEqual([]);
	});

	test("a subagent cannot record an arena", () => {
		const { runs: results, entries } = runs([fanOut], "sub");
		expect(results[0].isError).toBe(true);
		expect(entries).toEqual([]);
	});
});

describe("artifact", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-artifact-"));
	const local = join(dir, "local");
	mkdirSync(local);
	afterAll(() => rmSync(dir, { recursive: true, force: true }));
	const save = (path: string, extra: object = {}) => exercise("artifact", { artifactsDir: dir, runs: [{ path, title: "Example" }], ...extra }).runs[0]!;
	test("subagents omit the artifact schema", () => {
		expect(exercise("artifact", { subToolStart: true }).activeTools).toEqual(["read"]);
	});
	test("notes are optional, trimmed, short, and on one line", () => {
		writeFileSync(join(local, "noted.html"), "<p>noted</p>");
		const run = (note?: string) => save("local://noted.html", { runs: [{ path: "local://noted.html", title: "Noted", ...(note !== undefined && { note }) }] });
		expect(parseArtifactSave(run().details)?.note).toBeNull();
		expect(parseArtifactSave(run("  Changed heading  ").details)?.note).toBe("Changed heading");
		expect(parseArtifactSave(run("x".repeat(120)).details)?.note).toBe("x".repeat(120));
		for (const note of [" ", "x".repeat(121), "two\nlines"]) expect(run(note).isError).toBe(true);
	});
	test("symlinks cannot escape the local root", () => {
		writeFileSync(join(dir, "outside.html"), "<p>outside</p>");
		symlinkSync(join(dir, "outside.html"), join(local, "escape.html"));
		expect(save("local://escape.html").isError).toBe(true);
	});

	test("each kit source extension produces details accepted by the shared parser", () => {
		for (const [extension, kind, text] of [["html", "html", "<p>page</p>"], ["htm", "html", "<p>page</p>"], ["HTML", "html", "<p>page</p>"], ["md", "markdown", "# Page"], ["markdown", "markdown", "# Page"], ["svg", "svg", "<svg/>"]]) {
			writeFileSync(join(local, `page.${extension}`), text!);
			const before = Date.now();
			const result = save(`local://page.${extension}`);
			expect(result.isError).toBe(false);
			const parsed = parseArtifactSave(result.details);
			expect(parsed).toMatchObject({ file: `page.${extension}`, kind, title: "Example", bytes: Buffer.byteLength(text!) });
			expect(parsed!.savedAt).toBeGreaterThanOrEqual(before);
		}
	});
	test("equal bytes keep one copy and leave no staging files", () => {
		writeFileSync(join(local, "same.html"), "<p>same</p>");
		const results = exercise("artifact", { artifactsDir: dir, parallel: true, runs: [{ path: "local://same.html", title: "Same" }, { path: "local://same.html", title: "Same" }] }).runs;
		const { savedAt: _first, ...first } = results[0]!.details as Record<string, unknown>;
		const { savedAt: _second, ...second } = results[1]!.details as Record<string, unknown>;
		expect(first).toEqual(second);
		const parsed = parseArtifactSave(results[0]!.details)!;
		expect(readFileSync(join(dir, "artifact-versions", `${parsed.sha256}.${parsed.kind}`), "utf8")).toBe("<p>same</p>");
		expect(readdirSync(join(dir, "artifact-versions")).filter(name => name.startsWith(parsed.sha256))).toEqual([`${parsed.sha256}.html`]);
	});
	test("a file of exactly 2 MiB saves", () => {
		writeFileSync(join(local, "limit.md"), "x".repeat(2 * 1024 * 1024));
		expect(parseArtifactSave(save("local://limit.md").details)?.bytes).toBe(2 * 1024 * 1024);
	});
	test("refuses unsupported, empty, oversized, invalid UTF-8, and non-SVG files", () => {
		for (const [file, content] of [["empty.html", ""], ["large.html", "x".repeat(2 * 1024 * 1024 + 1)], ["bad.html", Buffer.from([0xff])], ["bad.svg", "<p>not svg</p>"], ["page.txt", "text"]] as const) {
			writeFileSync(join(local, file), content);
			expect(save(`local://${file}`).isError).toBe(true);
		}
	});
	test("refuses paths outside local, missing files, and sessions without an artifacts directory", () => {
		for (const path of ["/tmp/page.html", "local://../page.html", "local:///tmp/page.html", "local://a/../page.html", "local://missing.html"]) expect(save(path).isError).toBe(true);
		expect(save("local://page.html", { artifactsDir: null }).isError).toBe(true);
		expect(save("local://page.html", { agent: "sub" }).isError).toBe(true);
	});
});

describe("end_session", () => {
	test("ends the session on its first call", () => {
		expect(exercise("end-session", { runs: [{}] }).runs[0]).toMatchObject({ isError: false, text: "When this turn ends, the dashboard ends this session and removes its worktree. Give your final reply now." });
	});
});
