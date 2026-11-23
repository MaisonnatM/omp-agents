import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { packageDir } from "../../src/omp/install";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ship-outputs-")));
process.env.XDG_CONFIG_HOME = scratch;
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Outputs = Record<string, unknown>;
type Post = { kind: "slack" | "linear"; pr: number; ref: string };
// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	default(pi: object): void;
	missingOutput(stage: string, from: string, outputs: Outputs | undefined): { stage: string; argument: string } | undefined;
	withPost(posts: Post[] | undefined, post: Post): { posts: Post[] } | { existing: Post };
	prOfUrl(url: string): { repo: string; pr: number } | undefined;
} = await import(join(import.meta.dir, "agent/extensions/ship.ts"));
const { missingOutput, withPost, prOfUrl } = extension;
// The zod omp hands extensions as `pi.zod`, so the tool's schema is built as omp builds it.
const zod: unknown = await import(createRequire(join(packageDir, "package.json")).resolve("@oh-my-pi/omptype/zod"));

interface Entry {
	type: string;
	customType?: string;
	data?: unknown;
	message?: object;
}
type Result = { content: { text: string }[]; isError?: boolean; details?: { state?: { stage: string; pr?: number; outputs?: Outputs; posts?: Post[] } } };
type Exec = (command: string, args: string[]) => { code: number; stdout: string; stderr: string };

/** A main session running ship with `exec` answering git and gh; its branch holds a passing `bun test`, so the verified stages pass. */
function session(exec: Exec) {
	let tool: { execute(id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: object): Promise<Result> } | undefined;
	const handlers = new Map<string, (event: object, ctx: object) => unknown>();
	const branch: Entry[] = [
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "t", arguments: { command: "bun test" } }] } },
		{ type: "message", message: { role: "toolResult", toolName: "bash", toolCallId: "t" } },
	];
	extension.default({
		zod,
		on: (name: string, handler: (event: object, ctx: object) => unknown) => handlers.set(name, handler),
		registerTool: (registered: typeof tool) => {
			tool = registered;
		},
		appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
		sendMessage: () => undefined,
		exec: async (command: string, args: string[]) => exec(command, args),
	});
	const ctx = {
		cwd: scratch,
		hasUI: false,
		agent: { kind: "main" },
		isIdle: () => true,
		sessionManager: { getBranch: () => branch, getSessionId: () => "s", getUsageStatistics: () => ({ totalTokens: 0, cost: 0 }) },
	};
	return {
		branch,
		async call(params: object) {
			const result = await tool?.execute("call", params, undefined, undefined, ctx);
			if (!result) throw new Error("ship_stage is not registered");
			return { text: result.content.map(part => part.text).join(""), isError: result.isError ?? false, state: result.details?.state };
		},
		bash: (command: string) => handlers.get("tool_call")?.({ toolName: "bash", input: { command } }, ctx) as Promise<{ block: true; reason: string } | undefined>,
	};
}

/** git names the branch `feat`, which left `main` at `base0` and changes `changed`; `gh pr list` lists `open`, and every other gh call fails. */
const github = (open: object[], changed = ["src/a.ts"]): Exec => (command, args) => {
	if (command === "git" && args[0] === "branch") return { code: 0, stdout: "feat\n", stderr: "" };
	if (command === "git" && args[0] === "merge-base") return { code: 0, stdout: "base0\n", stderr: "" };
	if (command === "git" && args.includes("diff")) return { code: 0, stdout: changed.map(path => `${path}\n`).join(""), stderr: "" };
	if (basename(command) === "gh" && args[0] === "pr" && args[1] === "list") return { code: 0, stdout: JSON.stringify(open), stderr: "" };
	return { code: 1, stdout: "", stderr: "offline" };
};

const CONTRACT = { goal: "Ship it.", files_to_change: ["src/a.ts"], done_when: ["bun test passes"] };
const IMPLEMENTED = { implement: { files_changed: ["src/a.ts"], checks_run: [{ command: "bun test", result: "3 pass, 0 fail" }] } };

async function implementing(exec: Exec) {
	const ship = session(exec);
	await ship.call({ stage: "plan" });
	expect((await ship.call({ stage: "implement", contract: CONTRACT })).isError).toBe(false);
	return ship;
}

describe("stage outputs", () => {
	test("advancing needs the output of the stage before it, and names its fields", () => {
		expect(missingOutput("draft_pr", "implement", {})?.argument).toBe("{implement: {files_changed: [repository-relative paths], checks_run: [{command, result}]}}");
		expect(missingOutput("live", "ready_gate", undefined)?.stage).toBe("ready_gate");
		expect(missingOutput("draft_pr", "implement", IMPLEMENTED)).toBeUndefined();
	});

	test("recording the current stage again, an earlier one, or live work needs no output", () => {
		expect(missingOutput("draft_pr", "draft_pr", {})).toBeUndefined();
		expect(missingOutput("implement", "ready_gate", {})).toBeUndefined();
		expect(missingOutput("fix_ci", "live", {})).toBeUndefined();
	});

	test("draft_pr without the implement output is refused with the missing fields", async () => {
		const ship = await implementing(github([]));
		const refused = await ship.call({ stage: "draft_pr" });
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain("draft_pr is not recorded");
		expect(refused.text).toContain("files_changed");
		expect(refused.text).toContain("checks_run");
	});

	test.each([
		[{ implement: { files_changed: ["../outside.ts"], checks_run: [{ command: "bun test", result: "ok" }] } }, "output.implement.files_changed"],
		[{ implement: { files_changed: ["src/a.ts"], checks_run: [] } }, "output.implement.checks_run"],
		[{ draft_pr: { pr: 7, url: "https://github.com/o/r/pull/8" } }, "output.draft_pr: must be the URL of PR `pr`"],
		[{ plan: {} }, "output"],
	])("an invalid output %j is refused naming %s", async (output, field) => {
		const ship = await implementing(github([]));
		const refused = await ship.call({ stage: "draft_pr", output });
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain(`${field}`);
		expect(refused.state).toBeUndefined();
	});

	test("a valid output records the stage, keeps the output, and goes in the trace", async () => {
		const ship = await implementing(github([]));
		const recorded = await ship.call({ stage: "draft_pr", output: IMPLEMENTED });
		expect(recorded.isError).toBe(false);
		expect(recorded.state?.stage).toBe("draft_pr");
		expect(recorded.state?.outputs).toEqual(IMPLEMENTED);
		const trace = readFileSync(join(scratch, "omp-agents", "ship-trace.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
		expect(trace.some(line => line.stage === "draft_pr" && line.recorded && JSON.stringify(line.output) === JSON.stringify(IMPLEMENTED))).toBe(true);
		const next = await ship.call({ stage: "interface_review" });
		expect(next.isError).toBe(true);
		expect(next.text).toContain("{draft_pr: {pr: <number>, url: <the PR's URL>}}");
	});

	test("gh pr ready is blocked until the ready gate's output is recorded", async () => {
		const ship = await implementing(github([]));
		await ship.call({ stage: "draft_pr", output: IMPLEMENTED });
		const blocked = await ship.bash("gh pr ready 7");
		expect(blocked?.block).toBe(true);
		expect(blocked?.reason).toContain("ready_gate: {checks: [{command, result}]}");
	});
});

describe("check before create", () => {
	test("draft_pr reuses the branch's open PR instead of asking for a new one", async () => {
		const ship = await implementing(github([{ url: "https://github.com/o/r/pull/7", isDraft: true }]));
		const recorded = await ship.call({ stage: "draft_pr", output: IMPLEMENTED });
		expect(recorded.text).toContain("PR #7 (https://github.com/o/r/pull/7) is already open for branch `feat`, so ship reuses it: do not run `gh pr create`.");
		expect(recorded.state?.pr).toBe(7);
		expect(recorded.state?.outputs?.draft_pr).toEqual({ pr: 7, url: "https://github.com/o/r/pull/7" });
		expect((await ship.call({ stage: "interface_review" })).state?.stage).toBe("interface_review");
	});

	test("draft_pr with no open PR for the branch says nothing of reuse", async () => {
		const ship = await implementing(github([]));
		const recorded = await ship.call({ stage: "draft_pr", output: IMPLEMENTED });
		expect(recorded.text).not.toContain("reuses");
		expect(recorded.state?.pr).toBeUndefined();
	});

	test("a pull request URL gives its repository and number", () => {
		expect(prOfUrl("https://github.com/o/r/pull/12")).toEqual({ repo: "o/r", pr: 12 });
		expect(prOfUrl("https://github.com/o/r/issues/12")).toBeUndefined();
	});

	test("a second post of the same kind for the same PR is not added", () => {
		const first = withPost(undefined, { kind: "slack", pr: 7, ref: "a" });
		expect(first).toEqual({ posts: [{ kind: "slack", pr: 7, ref: "a" }] });
		const posts = "posts" in first ? first.posts : [];
		expect(withPost(posts, { kind: "slack", pr: 7, ref: "b" })).toEqual({ existing: { kind: "slack", pr: 7, ref: "a" } });
		expect(withPost(posts, { kind: "linear", pr: 7, ref: "c" })).toEqual({ posts: [...posts, { kind: "linear", pr: 7, ref: "c" }] });
	});

	test.each(["slack", "linear"])("recording a %s post twice for one PR is a no-op that says not to post again", async kind => {
		const ship = await implementing(github([{ url: "https://github.com/o/r/pull/7", isDraft: true }]));
		await ship.call({ stage: "draft_pr", output: IMPLEMENTED });
		const recorded = await ship.call({ posted: { kind, ref: "https://example.com/first" } });
		expect(recorded.state?.posts).toEqual([{ kind, pr: 7, ref: "https://example.com/first" }]);
		expect(recorded.text).toContain(`Posted: ${kind} for PR #7, https://example.com/first; do not post it again.`);
		const entries = ship.branch.length;
		const again = await ship.call({ posted: { kind, ref: "https://example.com/second" } });
		expect(again.isError).toBe(false);
		expect(again.text).toContain(`A ${kind} post for PR #7 is already recorded, https://example.com/first, so nothing changed. Do not post it again.`);
		expect(ship.branch.length).toBe(entries);
	});

	test("a post with no PR to name is refused", async () => {
		const ship = await implementing(github([]));
		expect((await ship.call({ posted: { kind: "slack", ref: "https://example.com/p" } })).isError).toBe(true);
	});
});

describe("contract checks", () => {
	test("a run on an issue refuses a contract that does not name it as its source", async () => {
		const ship = session(github([]));
		await ship.call({ stage: "plan", issue: "ENG-1" });
		const refused = await ship.call({ stage: "implement", contract: CONTRACT });
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain("this run ships ENG-1, but the contract names no source");
		expect((await ship.call({ stage: "implement", contract: { ...CONTRACT, source: "ENG-1" } })).state?.stage).toBe("implement");
	});

	test("draft_pr is refused while the branch changes a file outside files_to_change", async () => {
		const ship = await implementing(github([], ["src/a.ts", "bun.lock", "web/b.ts"]));
		const refused = await ship.call({ stage: "draft_pr", output: IMPLEMENTED });
		expect(refused.isError).toBe(true);
		expect(refused.text).toStartWith("draft_pr is not recorded: the branch changes `web/b.ts` against base0, outside the contract's files_to_change.");
		await ship.call({ contract: { ...CONTRACT, constraints: ["scope-change: the web client shows the new field"] } });
		expect((await ship.call({ stage: "draft_pr", output: IMPLEMENTED })).state?.stage).toBe("draft_pr");
	});
});
