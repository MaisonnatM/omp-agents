import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { packageDir } from "../../src/omp/install";
import { checkBoxes } from "./agent/extensions/github/description";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ship-fast-path-")));
process.env.XDG_CONFIG_HOME = scratch;
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type ChangedFile = { path: string; additions?: number; deletions?: number };
type Reviews = Record<"interface_review" | "thermonuclear", { needed: boolean; done: boolean }>;
// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	default(pi: object): void;
	whyNotSmall(files: ChangedFile[], changedFiles: number): string | null;
	reviewsOf(body: string, files: string[], changedFiles: number, read: (pathsFile: string) => string | undefined, small?: boolean): Reviews;
	publishBlocker(body: string, reviews: Reviews): string | undefined;
	SKIPPED: string;
} = await import(join(import.meta.dir, "agent/extensions/ship.ts"));
const { whyNotSmall, reviewsOf, publishBlocker, SKIPPED } = extension;
// The zod omp hands extensions as `pi.zod`, so the tool's schema is built as omp builds it.
const zod: unknown = await import(createRequire(join(packageDir, "package.json")).resolve("@oh-my-pi/omptype/zod"));

const THERMONUCLEAR_BOX = "- [x] Thermo-nuclear code quality review";
const SKIPPED_BOX = `${THERMONUCLEAR_BOX} (${SKIPPED})`;

describe("small change", () => {
	test("a few lines in a few ordinary files is small", () => {
		expect(whyNotSmall([{ path: "README.md", additions: 3, deletions: 1 }, { path: "src/a.ts", additions: 20, deletions: 10 }], 2)).toBeNull();
	});

	test.each([
		[[{ path: "src/a.ts", additions: 40, deletions: 11 }], 1, "it changes 51 lines, over 50"],
		[["a", "b", "c", "d"].map(path => ({ path, additions: 1, deletions: 0 })), 4, "it changes 4 files, over 3"],
		[[{ path: "src/a.ts", additions: 1, deletions: 0 }], 2, "GitHub listed 1 of its 2 changed files"],
		[[{ path: "src/a.ts" }], 1, "GitHub reported no line count for src/a.ts"],
		[[{ path: "db/migrations/0001_init.sql", additions: 2, deletions: 0 }], 1, "db/migrations/0001_init.sql matches a high-risk path"],
		[[{ path: "src/auth/session.ts", additions: 2, deletions: 0 }], 1, "src/auth/session.ts matches a high-risk path"],
		[[{ path: ".omp/review-paths", additions: 1, deletions: 1 }], 1, ".omp/review-paths matches a high-risk path"],
		[[{ path: ".github/workflows/checks.yml", additions: 1, deletions: 1 }], 1, ".github/workflows/checks.yml matches a high-risk path"],
	])("%j of %d files is not small: %s", (files, changedFiles, why) => {
		expect(whyNotSmall(files, changedFiles)).toBe(why);
	});
});

describe("skipped review boxes", () => {
	test("skipping checks the template's box with the note, and a later check drops the note", () => {
		const skipped = checkBoxes("## Checks\n- [ ] Thermo-nuclear code quality review\n- [ ] Browser proof\n", [THERMONUCLEAR_BOX], SKIPPED);
		expect(skipped).toBe(`## Checks\n${SKIPPED_BOX}\n- [ ] Browser proof\n`);
		expect(checkBoxes(skipped, [THERMONUCLEAR_BOX])).toBe(`## Checks\n${THERMONUCLEAR_BOX}\n- [ ] Browser proof\n`);
		expect(checkBoxes("## Summary", [THERMONUCLEAR_BOX], SKIPPED)).toBe(`## Summary\n${SKIPPED_BOX}`);
	});

	test("a skipped box counts as the review only while the PR is a small change", () => {
		const noPaths = () => undefined;
		expect(reviewsOf(SKIPPED_BOX, ["README.md"], 1, noPaths, true).thermonuclear).toEqual({ needed: true, done: true });
		expect(publishBlocker(SKIPPED_BOX, reviewsOf(SKIPPED_BOX, ["README.md"], 1, noPaths, true))).toBeUndefined();
		const grown = reviewsOf(SKIPPED_BOX, ["README.md"], 1, noPaths, false);
		expect(grown.thermonuclear).toEqual({ needed: true, done: false });
		expect(publishBlocker(SKIPPED_BOX, grown)).toContain("Thermonuclear stage is done");
		expect(reviewsOf(`${SKIPPED_BOX}\n${THERMONUCLEAR_BOX}`, ["README.md"], 1, noPaths, false).thermonuclear.done).toBe(true);
	});

	test("a skipped thermonuclear box does not count when a changed file matches the repository's .omp/review-paths", () => {
		const reviewPaths = (pathsFile: string) => (pathsFile === ".omp/review-paths" ? "src/**\n" : undefined);
		expect(reviewsOf(SKIPPED_BOX, ["src/a.ts"], 1, reviewPaths, true).thermonuclear).toEqual({ needed: true, done: false });
	});
});

type Exec = (command: string, args: string[]) => { code: number; stdout: string; stderr: string };
type Result = { content: { text: string }[]; isError?: boolean; details?: { state?: { stage: string } } };

/** A main session in checkout `cwd` running ship with `exec` answering git and gh; its branch holds a passing `bun test`, so the verified stages pass. */
function session(exec: Exec, cwd = scratch) {
	let tool: { execute(id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: object): Promise<Result> } | undefined;
	const branch: object[] = [
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "t", arguments: { command: "bun test" } }] } },
		{ type: "message", message: { role: "toolResult", toolName: "bash", toolCallId: "t" } },
	];
	extension.default({
		zod,
		on: () => undefined,
		registerTool: (registered: typeof tool) => {
			tool = registered;
		},
		appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
		sendMessage: () => undefined,
		exec: async (command: string, args: string[]) => exec(command, args),
	});
	const ctx = {
		cwd,
		hasUI: false,
		agent: { kind: "main" },
		isIdle: () => true,
		sessionManager: { getBranch: () => branch, getSessionId: () => "s", getUsageStatistics: () => ({ totalTokens: 0, cost: 0 }) },
	};
	return async (params: object) => {
		const result = await tool?.execute("call", params, undefined, undefined, ctx);
		if (!result) throw new Error("ship_stage is not registered");
		return { text: result.content.map(part => part.text).join(""), isError: result.isError ?? false, stage: result.details?.state?.stage };
	};
}

/** GitHub answering for PR 7 of `o/r`, with this body and changed files; `written` collects each body ship writes. */
function github(body: string, files: ChangedFile[], written: string[]): Exec {
	const pullRequest = {
		state: "OPEN", isDraft: true, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: null, body,
		changedFiles: files.length, files: { nodes: files },
		reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
		commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
	};
	return (command, args) => {
		if (basename(command) !== "gh" || args[0] !== "api") return { code: 1, stdout: "", stderr: "offline" };
		if (args[1] === "graphql") return { code: 0, stdout: JSON.stringify({ data: { repository: { pullRequest } } }), stderr: "" };
		if (args[1] === "-X") {
			written.push(args.at(-1)?.replace(/^body=/, "") ?? "");
			return { code: 0, stdout: "{}", stderr: "" };
		}
		return { code: 0, stdout: JSON.stringify({ body, updated_at: "2026-11-23T12:00:00Z" }), stderr: "" };
	};
}

const TEMPLATE = "## Checks\n- [ ] Thermo-nuclear code quality review\n";
const SKIP = { stage: "ready_gate", pr: 7, repo: "o/r", output: { thermonuclear: { verdicts: [], skipped: "small change" } } };

describe("ship_stage fast path", () => {
	test("a small change records the skipped review and notes it on the PR body's box", async () => {
		const written: string[] = [];
		const result = await session(github(TEMPLATE, [{ path: "README.md", additions: 8, deletions: 2 }], written))(SKIP);
		expect(result.isError).toBe(false);
		expect(result.stage).toBe("ready_gate");
		expect(written).toEqual([`## Checks\n${SKIPPED_BOX}\n`]);
		expect(result.text).toContain(`Checked \`${SKIPPED_BOX}\` in the PR body.`);
	});

	test.each([
		[[{ path: "src/a.ts", additions: 150, deletions: 50 }], "it changes 200 lines, over 50"],
		[[{ path: "src/auth/token.ts", additions: 1, deletions: 1 }], "src/auth/token.ts matches a high-risk path"],
	])("skipping is refused for %j", async (files, why) => {
		const written: string[] = [];
		const result = await session(github(TEMPLATE, files, written))(SKIP);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("the Thermonuclear may be skipped only on a small change");
		expect(result.text).toContain(why);
		expect(written).toEqual([]);
	});

	test("skipping the thermonuclear review is refused when a changed file matches the repository's .omp/review-paths", async () => {
		const checkout = join(scratch, "checkout");
		mkdirSync(join(checkout, ".git"), { recursive: true });
		mkdirSync(join(checkout, ".omp"), { recursive: true });
		writeFileSync(join(checkout, ".omp/review-paths"), "src/**\n");
		const written: string[] = [];
		const result = await session(github(TEMPLATE, [{ path: "src/a.ts", additions: 2, deletions: 1 }], written), checkout)(SKIP);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("the Thermonuclear may not be skipped, since a changed file matches the repository's .omp/review-paths");
		expect(written).toEqual([]);
	});
});
