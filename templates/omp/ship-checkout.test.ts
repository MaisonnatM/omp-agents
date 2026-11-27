import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDir } from "../../src/omp/install";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ship-checkout-")));
process.env.XDG_CONFIG_HOME = scratch;
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: { default(pi: object): void } = await import(join(import.meta.dir, "agent/extensions/ship.ts"));
// The zod omp hands extensions as `pi.zod`, so the tool's schema is built as omp builds it.
const zod: unknown = await import(createRequire(join(packageDir, "package.json")).resolve("@oh-my-pi/omptype/zod"));

type Result = { content: { text: string }[]; isError?: boolean; details?: { state?: { stage: string } } };

function git(cwd: string, ...args: string[]) {
	const done = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
	if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr.toString()}`);
}

/** A repository whose branch `feat` left `main` and adds `files`, as a worktree a session never moved into. */
function checkout(name: string, files: string[]): string {
	const dir = join(scratch, name);
	mkdirSync(dir);
	git(dir, "init", "-q", "-b", "main");
	git(dir, "commit", "-q", "--allow-empty", "-m", "base");
	git(dir, "checkout", "-q", "-b", "feat");
	for (const file of files) {
		mkdirSync(join(dir, file, ".."), { recursive: true });
		writeFileSync(join(dir, file), "x\n");
	}
	git(dir, "add", ".");
	git(dir, "commit", "-q", "-m", "change");
	return dir;
}

/** A main session in `cwd`, which is no repository, whose last tool call is the passing bash check `input`; git runs for real and gh is offline. */
function session(cwd: string, input: Record<string, unknown>) {
	let tool: { execute(id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: object): Promise<Result> } | undefined;
	const branch: object[] = [];
	extension.default({
		zod,
		on: () => undefined,
		registerTool: (registered: typeof tool) => {
			tool = registered;
		},
		appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
		sendMessage: () => undefined,
		exec: async (command: string, args: string[], options?: { cwd?: string }) => {
			if (command !== "git") return { code: 1, stdout: "", stderr: "offline" };
			const done = Bun.spawnSync(["git", ...args], { cwd: options?.cwd });
			return { code: done.exitCode, stdout: done.stdout.toString(), stderr: done.stderr.toString() };
		},
	});
	const ctx = {
		cwd,
		hasUI: false,
		agent: { kind: "main" },
		isIdle: () => true,
		sessionManager: { getBranch: () => branch, getSessionId: () => "s", getUsageStatistics: () => ({ totalTokens: 0, cost: 0 }) },
	};
	const call = async (params: object) => {
		const result = await tool?.execute("call", params, undefined, undefined, ctx);
		if (!result) throw new Error("ship_stage is not registered");
		return { text: result.content.map(part => part.text).join(""), isError: result.isError ?? false, stage: result.details?.state?.stage };
	};
	return {
		async draftPr() {
			await call({ stage: "plan" });
			await call({ stage: "implement", contract: { goal: "Ship it.", files_to_change: ["src/a.ts"], done_when: ["bun test passes"] } });
			branch.push(
				{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "check", arguments: input }] } },
				{ type: "message", message: { role: "toolResult", toolName: "bash", toolCallId: "check" } },
			);
			return call({ stage: "draft_pr", output: { implement: { files_changed: ["src/a.ts"], checks_run: [{ command: "bun test", result: "1 pass" }] } } });
		},
	};
}

describe("draft_pr's branch checks", () => {
	const home = join(scratch, "home");
	mkdirSync(home);

	test.each([
		["cd", (dir: string) => ({ command: `cd ${dir} && bun test` })],
		["cwd", (dir: string) => ({ command: "bun test", cwd: dir })],
	])("read the worktree the check ran in through its bash %s, not the session's directory", async (how, input) => {
		const strayed = checkout(`stray-${how}`, ["src/a.ts", "docs/stray.md"]);
		const refused = await session(home, input(strayed)).draftPr();
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain("`docs/stray.md`");

		const scoped = checkout(`scoped-${how}`, ["src/a.ts"]);
		const recorded = await session(home, input(scoped)).draftPr();
		expect(recorded.isError).toBe(false);
		expect(recorded.stage).toBe("draft_pr");
	});

	test("name the directory they read when it has no default branch", async () => {
		const refused = await session(home, { command: "bun test" }).draftPr();
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain(`${home}, where the last check ran, has no main or master branch`);
	});
});
