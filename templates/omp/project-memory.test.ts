import { afterAll, describe, expect, setSystemTime, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { packageDir } from "../../src/omp/install";
import { MEMORY_REF, parseDoc, parseOps, planOps, type MemoryOp, type RawOp } from "./agent/extensions/project-memory/memory";
import { intentOf } from "./agent/extensions/project-memory/news";

interface Note {
	customType: string;
	content: string;
	display: boolean;
	details: unknown;
}
interface Entry extends Partial<Note> {
	type: string;
	message?: { role: string; content: string };
}
interface Ctx {
	cwd: string;
	mode: string;
	agent: { kind: "main" | "sub" };
	sessionManager: { getBranch(): Entry[]; getSessionId(): string };
}
type Hook = (event: { type: string; reason: "prompt" | "revive"; prompt: string; systemPrompt: string[] }, ctx: Ctx) => { message?: Note } | undefined;
interface Tool {
	execute(id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: Ctx): Promise<{ content: { text: string }[]; isError?: boolean }>;
}

// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const { default: projectMemory }: { default(pi: object): void } = await import(join(import.meta.dir, "agent/extensions/project-memory.ts"));
// The zod omp hands extensions as `pi.zod`, so the tool's schema is built as omp builds it.
const zod: unknown = await import(createRequire(join(packageDir, "package.json")).resolve("@oh-my-pi/omptype/zod"));

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "project-memory-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const withoutSessionTrailer = { ...process.env, PI_SESSION_ID: "" };
const today = new Date().toISOString().slice(0, 10);

function git(dir: string, ...args: string[]): string {
	return execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: withoutSessionTrailer, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(dir: string, file: string, subject: string, session?: string): string {
	mkdirSync(dirname(join(dir, file)), { recursive: true });
	writeFileSync(join(dir, file), `${subject}\n`);
	git(dir, "add", file);
	git(dir, "commit", "-q", "-m", subject, ...(session ? ["-m", `Omp-Session: ${session}`] : []));
	return git(dir, "rev-parse", "HEAD");
}

function land(dir: string, branch: string, file: string, session: string, merger?: string): string {
	git(dir, "switch", "-q", "-c", branch);
	commit(dir, file, `Change ${file}`, session);
	git(dir, "switch", "-q", "main");
	git(dir, "merge", "-q", "--no-ff", branch, "-m", `Merge branch '${branch}'`, ...(merger ? ["-m", `Omp-Session: ${merger}`] : []));
	return git(dir, "rev-parse", "HEAD");
}

let repos = 0;
function world() {
	const dir = join(scratch, `repo-${++repos}`);
	mkdirSync(dir);
	git(dir, "init", "-q", "-b", "main");
	const start = commit(dir, "README.md", "Start");
	const wt = join(scratch, `repo-${repos}-mine`);
	git(dir, "worktree", "add", "-q", "-b", "mine", wt);
	commit(wt, "src/shared.ts", "Share helpers");
	return { dir, wt, start, name: basename(dir), intents: join(dir, ".git", "omp-project-memory", "intents") };
}

function session(id: string, cwd: string, options: { kind?: "main" | "sub"; mode?: string; branch?: Entry[] } = {}) {
	let hook: Hook | undefined;
	let tool: Tool | undefined;
	projectMemory({
		zod,
		on(name: string, handler: Hook) {
			if (name === "before_agent_start") hook = handler;
		},
		registerTool(registered: Tool) {
			tool = registered;
		},
	});
	const branch: Entry[] = options.branch ?? [];
	const ctx: Ctx = { cwd, mode: options.mode ?? "tui", agent: { kind: options.kind ?? "main" }, sessionManager: { getBranch: () => branch, getSessionId: () => id } };
	return {
		branch,
		attempt: (prompt: string, reason: "prompt" | "revive" = "prompt") => hook?.({ type: "before_agent_start", reason, prompt, systemPrompt: ["base"] }, ctx),
		prompt(prompt: string, reason: "prompt" | "revive" = "prompt"): string | null {
			const message = this.attempt(prompt, reason)?.message;
			if (message) branch.push({ type: "custom_message", ...message });
			branch.push({ type: "message", message: { role: "user", content: prompt } });
			return message?.content ?? null;
		},
		async call(params: { read?: string; ops?: RawOp[] }): Promise<{ text: string; isError: boolean }> {
			const result = await tool?.execute("call", params, undefined, undefined, ctx);
			return { text: result?.content.map(part => part.text).join("") ?? "", isError: result?.isError ?? false };
		},
	};
}

const add = (slug: string, kind: "decision" | "fact" | "lesson", line: string, body = `Why ${slug}.`): RawOp => ({ op: "add", slug, kind, line, body });
const ops = (raw: RawOp[]): MemoryOp[] => {
	const parsed = parseOps(raw);
	if (!parsed.ok) throw new Error(parsed.reasons.join(" "));
	return parsed.ops;
};
const sha7 = (sha: string) => sha.slice(0, 7);

describe("planOps", () => {
	const doc = parseDoc(JSON.stringify({ memories: { a: { kind: "fact", line: "A.", body: "", source: "#s", updated: "2026-10-01" } } }));

	test("refuses a batch with every reason and leaves the doc as it was", () => {
		const plan = planOps(
			doc,
			ops([
				add("a", "fact", "Again."),
				{ op: "update", slug: "missing", line: "M." },
				{ op: "update", slug: "a" },
				add("long", "fact", "x".repeat(121)),
				add("two-lines", "lesson", "One\nTwo"),
				add("big", "decision", "Big.", "y".repeat(2001)),
				{ op: "delete", slug: "gone" },
			]),
			"#me",
			"2026-10-31",
		);
		expect(plan).toEqual({
			ok: false,
			reasons: [
				"add a: the slug exists; use update.",
				"update missing: no memory has this slug; use add.",
				"update a: give at least one of kind, line, and body.",
				"add long: line is 121 characters; the limit is 120.",
				"add two-lines: line must be one line.",
				"add big: body is 2001 characters; the limit is 2000.",
				"delete gone: no memory has this slug.",
			],
		});
		expect(Object.keys(doc.memories)).toEqual(["a"]);
	});

	test("checks each op against the doc as the ops before it leave it", () => {
		const plan = planOps(doc, ops([add("x", "decision", "X."), { op: "update", slug: "x", line: "X, revised." }, { op: "delete", slug: "a" }]), "#me", "2026-10-31");
		expect(plan).toEqual({
			ok: true,
			summary: "Added x, updated x, deleted a",
			doc: parseDoc(JSON.stringify({ memories: { x: { kind: "decision", line: "X, revised.", body: "Why x.", source: "#me", updated: "2026-10-31" } } })),
		});
	});

	test("counts the cap after the whole batch", () => {
		const full = parseDoc(JSON.stringify({ memories: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`m${i}`, { kind: "fact", line: "M.", body: "", source: "#s", updated: "2026-10-01" }])) }));
		expect(planOps(full, ops([add("new", "fact", "New.")]), "#me", "2026-10-31")).toEqual({ ok: false, reasons: ["The batch would leave 151 memories; the limit is 150."] });
		const swapped = planOps(full, ops([add("new", "fact", "New."), { op: "delete", slug: "m0" }]), "#me", "2026-10-31");
		expect(swapped.ok && Object.keys(swapped.doc.memories).length).toBe(150);
	});

	test("parseOps refuses every malformed op with its reason", () => {
		expect(parseOps([{ op: "add", slug: "Bad Slug", kind: "fact", line: "L.", body: "" }, { op: "add", slug: "half", line: "L." }, { op: "delete", slug: "d", line: "L." }])).toEqual({
			ok: false,
			reasons: [
				"add Bad Slug: a slug is 1 to 48 lowercase letters, digits, and hyphens, starting with a letter or digit.",
				"add half: add needs kind, body.",
				"delete d: delete takes only a slug.",
			],
		});
		expect(parseOps([])).toEqual({ ok: false, reasons: ["ops is empty; pass at least one op."] });
	});
});

describe("memory store", () => {
	test("a refused batch leaves the ref where it was", async () => {
		const { dir } = world();
		const me = session("bbbbbbbb-mine", dir);
		await me.call({ ops: [add("a", "fact", "A.")] });
		const tip = git(dir, "rev-parse", MEMORY_REF);
		expect(await me.call({ ops: [add("b", "fact", "B."), add("a", "fact", "A again.")] })).toEqual({ text: "Refused, nothing written: add a: the slug exists; use update.", isError: true });
		expect(git(dir, "rev-parse", MEMORY_REF)).toBe(tip);
		expect(git(dir, "log", "--format=%s%n%(trailers:key=Omp-Session,valueonly)", MEMORY_REF)).toBe("Added a\nbbbbbbbb-mine");
	});

	test("two processes writing at once keep every memory, one commit per batch", async () => {
		const { dir } = world();
		const script = join(scratch, "writer.ts");
		writeFileSync(
			script,
			`const { applyMemoryOps, parseOps } = await import(${JSON.stringify(join(import.meta.dir, "agent/extensions/project-memory/memory.ts"))});
const [commonDir, prefix] = process.argv.slice(2);
for (let i = 0; i < 15; i++) {
	const parsed = parseOps([{ op: "add", slug: prefix + "-" + i, kind: "fact", line: "L.", body: "" }]);
	const plan = applyMemoryOps(commonDir, prefix, parsed.ops, "2026-10-31");
	if (!plan.ok) throw new Error(plan.reasons.join(" "));
}
`,
		);
		const writers = ["left", "right"].map(prefix => Bun.spawn([process.execPath, script, join(dir, ".git"), prefix], { env: withoutSessionTrailer, stderr: "pipe" }));
		expect(await Promise.all(writers.map(writer => writer.exited))).toEqual([0, 0]);
		const index = (await session("bbbbbbbb-mine", dir).call({})).text.split("\n").map(line => line.split(" ")[0]);
		expect(index.sort()).toEqual([...Array.from({ length: 15 }, (_, i) => `left-${i}`), ...Array.from({ length: 15 }, (_, i) => `right-${i}`)].sort());
		expect(git(dir, "rev-list", "--count", MEMORY_REF)).toBe("30");
	});

	test("a linked worktree reads the memory the main checkout wrote", async () => {
		const { dir, wt } = world();
		await session("aaaaaaaa-main", dir).call({ ops: [add("shared", "decision", "One memory per repository.")] });
		expect(await session("bbbbbbbb-mine", wt).call({})).toEqual({ text: `shared [decision] — One memory per repository. (updated ${today})`, isError: false });
	});
});

describe("before_agent_start", () => {
	test("a first prompt gets the brief with the index and the landings, and a second prompt with nothing new gets nothing", async () => {
		const { dir, wt, start, name } = world();
		const other = session("aaaaaaaa-other", dir);
		other.prompt("Add the login page\nwith a form");
		const merge = land(dir, "feature-login", "src/login.ts", "aaaaaaaa-other");
		await other.call({ ops: [add("release-needs-tag", "fact", "Releases ship from a tag.")] });
		const me = session("bbbbbbbb-mine", wt);
		const brief = me.prompt("Fix the flaky test")?.split("\n") ?? [];
		expect(brief[0]).toBe(`<project_memory repository="${name}" target="main">`);
		expect(brief.slice(-5)).toEqual([
			`release-needs-tag [fact] — Releases ship from a tag. (updated ${today})`,
			"Last 2 landings on main, newest first (git log --first-parent main for older):",
			`${sha7(merge)} feature-login (session aaaaaaaa-other, "Add the login page")`,
			`${sha7(start)} Start`,
			"</project_memory>",
		]);
		expect(me.branch.at(0)).toMatchObject({ type: "custom_message", customType: "omp-agents.project-memory", display: false, details: { seen: { tip: merge, memory: git(dir, "rev-parse", MEMORY_REF) } } });
		expect(me.prompt("And the other one")).toBeNull();
	});

	test("a catch-up lists what other sessions landed, overlapping landings first, with their intents", async () => {
		const { dir, wt, start, name } = world();
		const me = session("bbbbbbbb-mine", wt);
		me.prompt("Fix the flaky test");
		setSystemTime(new Date(Date.now() + 60_000));
		session("cccccccc-alpha", dir).prompt("Refactor shared helpers");
		setSystemTime();
		const overlapping = land(dir, "feature-a", "src/shared.ts", "cccccccc-alpha");
		const other = land(dir, "feature-b", "docs/b.md", "dddddddd-beta");
		expect(me.prompt("Next")).toBe(
			[
				`<project_memory_update target="main" since="${sha7(start)}">`,
				`Meanwhile in ${name}:`,
				"Landed on main, overlapping your branch first:",
				`- ${sha7(overlapping)} feature-a (session cccccccc-alpha, "Refactor shared helpers"); touches src/shared.ts, which your branch changed.`,
				`- ${sha7(other)} feature-b (session dddddddd-beta)`,
				"Sessions started here since:",
				'- "Refactor shared helpers" (session cccccccc-alpha)',
				"</project_memory_update>",
			].join("\n"),
		);
	});

	test("a catch-up leaves out a landing whose merge carries this session's trailer", () => {
		const { dir, wt, start, name } = world();
		const me = session("bbbbbbbb-mine", wt);
		me.prompt("Fix the flaky test");
		land(dir, "feature-c", "c.md", "eeeeeeee-other", "bbbbbbbb-mine");
		const theirs = land(dir, "feature-d", "d.md", "eeeeeeee-other");
		expect(me.prompt("Next")).toBe(
			[`<project_memory_update target="main" since="${sha7(start)}">`, `Meanwhile in ${name}:`, "Landed on main:", `- ${sha7(theirs)} feature-d (session eeeeeeee-other)`, "</project_memory_update>"].join("\n"),
		);
	});

	test("a catch-up lists another session's memory changes, never this session's own", async () => {
		const { dir, wt, start, name } = world();
		const me = session("bbbbbbbb-mine", wt);
		me.prompt("Fix the flaky test");
		await me.call({ ops: [add("own-note", "fact", "Mine.")] });
		await session("eeeeeeee-other", dir).call({ ops: [add("their-note", "lesson", "Theirs.")] });
		expect(me.prompt("Next")).toBe(
			[`<project_memory_update target="main" since="${sha7(start)}">`, `Meanwhile in ${name}:`, "Memory changed by other sessions:", "- added their-note [lesson] — Theirs.", "</project_memory_update>"].join("\n"),
		);
		await me.call({ ops: [{ op: "update", slug: "own-note", line: "Mine, revised." }] });
		expect(me.prompt("Again")).toBeNull();
	});

	test("a forked branch inherits the baseline and gets a catch-up, not a brief", () => {
		const { dir, wt, start, name } = world();
		const me = session("bbbbbbbb-mine", wt);
		me.prompt("Fix the flaky test");
		const merge = land(dir, "feature-f", "f.md", "eeeeeeee-other");
		const fork = session("ffffffff-fork", wt, { branch: [...me.branch] });
		expect(fork.prompt("Carry on")).toBe(
			[`<project_memory_update target="main" since="${sha7(start)}">`, `Meanwhile in ${name}:`, "Landed on main:", `- ${sha7(merge)} feature-f (session eeeeeeee-other)`, "</project_memory_update>"].join("\n"),
		);
	});

	test("subagents, revives, print and json runs, and a cwd outside git get nothing and record no intent", () => {
		const { dir, intents } = world();
		const outside = join(scratch, "not-git");
		mkdirSync(outside, { recursive: true });
		expect(session("s-sub", dir, { kind: "sub" }).prompt("Task")).toBeNull();
		expect(session("s-revive", dir).prompt("", "revive")).toBeNull();
		expect(session("s-print", dir, { mode: "print" }).prompt("Task")).toBeNull();
		expect(session("s-json", dir, { mode: "json" }).prompt("Task")).toBeNull();
		expect(session("s-outside", outside).prompt("Task")).toBeNull();
		expect(existsSync(intents)).toBe(false);
	});

	test("a retried start of the first prompt records one intent, the first", () => {
		const { dir, intents } = world();
		const me = session("bbbbbbbb-mine", dir);
		me.attempt("First try");
		me.attempt("Second try");
		expect(readdirSync(intents)).toEqual(["bbbbbbbb-mine.json"]);
		expect(JSON.parse(readFileSync(join(intents, "bbbbbbbb-mine.json"), "utf8")).intent).toBe("First try");
	});
});

describe("intentOf", () => {
	test("reads the user's words under omp's expansion", () => {
		expect(intentOf("<system-reminder>\nBe brief.\n</system-reminder>\n\n  Ship   the   fix  \nmore")).toBe("Ship the fix");
		expect(intentOf('[IMPORTANT: User invoked the "ship" skill; follow its instructions. Full skill below.]\n\n# Ship\nUser: not this\n\n---\n\n[Skill directory: /s/ship]\nResolve relative paths.\nUser: the login page')).toBe("the login page");
		expect(intentOf('[IMPORTANT: User invoked the "ship" skill; follow its instructions. Full skill below.]\n\n# Ship\n\n---\n\n[Skill directory: /s/ship]\nResolve relative paths.')).toBe("/skill:ship");
		expect(intentOf("z".repeat(100))).toBe(`${"z".repeat(79)}…`);
		expect(intentOf(" \n ")).toBeNull();
	});
});

describe("project_memory tool", () => {
	test("lists the index, reads one memory, and names the call that lists them for an unknown slug", async () => {
		const { dir } = world();
		const me = session("bbbbbbbb-mine", dir);
		expect(await me.call({})).toEqual({ text: "This repository has no memories yet.", isError: false });
		expect(await me.call({ ops: [add("a", "fact", "A.", "The body of a."), add("b", "lesson", "B.")] })).toEqual({ text: "Added a, added b. 2 of 150 memories.", isError: false });
		expect(await me.call({})).toEqual({ text: `a [fact] — A. (updated ${today})\nb [lesson] — B. (updated ${today})`, isError: false });
		expect(await me.call({ read: "a" })).toEqual({ text: `a [fact] — A. (updated ${today}, source #bbbbbbbb-mine)\n\nThe body of a.`, isError: false });
		expect(await me.call({ read: "nope" })).toEqual({ text: "No memory has the slug nope; project_memory with no arguments lists them.", isError: true });
	});

	test("refuses a bad batch with every reason, ops from a subagent, read with ops, and a cwd outside git", async () => {
		const { dir } = world();
		const me = session("bbbbbbbb-mine", dir);
		expect(await me.call({ ops: [{ op: "update", slug: "a", line: "A." }, { op: "delete", slug: "b" }] })).toEqual({
			text: "Refused, nothing written: update a: no memory has this slug; use add. delete b: no memory has this slug.",
			isError: true,
		});
		expect(await session("s-sub", dir, { kind: "sub" }).call({ ops: [add("a", "fact", "A.")] })).toEqual({
			text: "A subagent may read project memory but not change it; tell your parent session what to remember.",
			isError: true,
		});
		expect(await me.call({ read: "a", ops: [add("a", "fact", "A.")] })).toEqual({ text: "Pass either read or ops, not both.", isError: true });
		const outside = join(scratch, "not-git");
		mkdirSync(outside, { recursive: true });
		expect(await session("s-outside", outside).call({})).toEqual({ text: `Project memory needs a git repository, and ${outside} is not in one.`, isError: true });
		expect(git(dir, "for-each-ref", MEMORY_REF)).toBe("");
	});
});
