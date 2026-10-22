import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcHostTool } from "../omp/modules";
import { PLAIN_LAUNCH } from "../omp/rpc";
import type { TriageGitHubInput } from "../review-triage-input";
import { runChecked } from "../proc";
import { TRIAGE_TOOLS, type ReviewTriage, type ReviewTriageState, type TriageCode, type TriageSource } from "../shared/review-triage";
import { newSessionRequest, type StartRequest } from "../shared/sessions";
import type { ProjectJoin } from "./project-runner";
import { ReviewTriages } from "./review-triages";
import { ReviewTriagesFile } from "./review-triages-file";
import { endSession } from "./session-end";

const HEAD = "a".repeat(40);
const pr = { owner: "acme", repo: "app", number: 7 };
const plainJoin: ProjectJoin = { rpc: PLAIN_LAUNCH, attach() {} };

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const thread = (id: string, body = `Comment on ${id}.`): TriageSource => ({ kind: "thread", id, path: "src/a.ts", line: 2, resolved: false, comments: [{ id: `${id}c`, body, author: "rev", updatedAt: "t", url: "u" }] });
const review = (body = "Please handle the error."): TriageSource => ({ kind: "review", id: "R1", body, author: "reviewer", state: "CHANGES_REQUESTED", updatedAt: "2026-10-22T12:00:00Z", url: "https://github.com/acme/app/pull/7#pullrequestreview-1" });
const assessment = (verdict: "fix" | "push-back" | "already-done") => ({ verdict, rationale: "Because.", evidence: "src/a.ts:2", reply: `Reply ${verdict}.` });

/**
 * The service over a temporary store, with GitHub, the checkout, and session starts faked: each start binds a new session
 * the way the starter does, and `tools` holds every session's triage tools by session id.
 */
function setup() {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-review-triages-"));
	dirs.push(dir);
	const report = join(dir, "origin.jsonl");
	writeFileSync(report, '{"type":"session"}\n{"finding":"1. Off by one."}\n');
	const world = {
		// The user's own work on src/a.ts was already in the checkout when it was reviewed.
		code: { head: HEAD, index: "i", worktree: "w", dirty: [{ path: "src/a.ts", digest: "user" }], untracked: [] } as TriageCode,
		github: { head: HEAD, branch: "feature", sources: [thread("T1"), thread("T2")] } as TriageGitHubInput,
		conflict: null as string | null,
		owner: true,
		starts: [] as StartRequest[],
		resumes: [] as string[],
		failStart: null as string | null,
	};
	const tools = new Map<string, RpcHostTool[]>();
	let ids = 0;
	let changes = 0;
	/** Starts `request`'s session as the starter does: joined, then attached under the next session id. */
	const bind = (request: StartRequest) => {
		const n = tools.size + 1;
		const joined = triages.join(request, plainJoin);
		const session = { instanceId: `i${n}`, sessionId: `s${n}`, cwd: request.kind === "new" ? request.cwd : "/tmp/app" };
		tools.set(session.sessionId, joined.rpc.tools);
		joined.attach(session);
		return session;
	};
	const path = join(dir, "review-triages.json");
	const file = new ReviewTriagesFile(path);
	const written: ReviewTriageState[] = [];
	const update = file.update.bind(file);
	file.update = next => update(state => {
		const changed = next(state);
		if (changed !== state) written.push(changed);
		return changed;
	});
	const deps: ConstructorParameters<typeof ReviewTriages>[0] = {
		file,
		acquire: () => world.owner,
		owner: () => (world.owner ? null : "http://127.0.0.1:20001"),
		start: async request => {
			world.starts.push(request);
			if (world.failStart) return { ok: false, error: world.failStart };
			const session = bind(request);
			return { ok: true, instanceId: session.instanceId, cwd: session.cwd, prompt: null };
		},
		resume: async sessionId => void world.resumes.push(sessionId),
		origin: sessionId => (sessionId === "s0" ? { cwd: "/tmp/app", file: report } : null),
		conflict: async () => world.conflict,
		onChange: () => void changes++,
		now: () => 5_000,
		newId: () => `id${++ids}`,
		github: async () => world.github,
		code: async () => world.code,
		checkout: async cwd => cwd,
	};
	const triages = new ReviewTriages(deps);
	const call = (sessionId: string, name: string, params: Record<string, unknown> = {}) => {
		const tool = tools.get(sessionId)?.find(each => each.name === name);
		if (!tool) throw new Error(`${sessionId} has no ${name}`);
		return tool.execute(params, { toolCallId: "t", signal: new AbortController().signal });
	};
	const latest = (): ReviewTriage => triages.answer.list.at(-1)!;
	/** A new server over the same store, as after a restart: it knows only what the file holds. */
	const restart = () => new ReviewTriages({ ...deps, file: new ReviewTriagesFile(join(dir, "review-triages.json")) });
	return { triages, world, call, latest, report, bind, restart, written, file, path, tools, changes: () => changes };
}

const commentsCapture = newSessionRequest("/tmp/app", "Triage it", { subject: { kind: "pull-request", pr }, reviewTriage: { kind: "capture", mode: "comments", originSessionId: null, existingReport: false } });
const commentsReport = { summary: "Two threads.", items: [{ sourceId: "T1", assessment: assessment("fix") }, { sourceId: "T2", assessment: assessment("push-back") }] };

/** A comments triage of `pr` captured by session s1 and saved, both threads accepted. */
async function accepted(env: ReturnType<typeof setup>): Promise<ReviewTriage> {
	env.bind(commentsCapture);
	await env.call("s1", TRIAGE_TOOLS.capture);
	await env.call("s1", TRIAGE_TOOLS.report, commentsReport);
	for (const itemId of ["T1", "T2"]) env.triages.edit({ id: env.latest().id, revision: env.latest().revision, itemId, op: "decision", decision: "accepted" });
	return env.latest();
}

describe("unavailable triage storage", () => {
	test("malformed JSON and invalid shapes leave lists usable, refuse mutations, and recover after repair", async () => {
		const diagnostic = spyOn(console, "error").mockImplementation(() => {});
		try {
			for (const invalid of ["{broken", '{"triages":{},"bindings":[]}']) {
				const env = setup();
				const held = await accepted(env);
				const valid = readFileSync(env.path, "utf8");
				writeFileSync(env.path, invalid);
				diagnostic.mockClear();
				expect(env.triages.answer).toEqual({ list: [held], owner: null });
				expect(env.triages.answer.list).toEqual([held]);
				expect(diagnostic.mock.calls).toHaveLength(1);
				expect(diagnostic.mock.calls[0]?.[0]).toContain("triage changes and bindings are unavailable until repair");
				expect(() => env.file.update(state => ({ ...state, triages: [] }))).toThrow("review triage");
				expect(() => env.triages.edit({ id: held.id, revision: held.revision, itemId: "T1", op: "reply", text: "Unsafe." })).toThrow("review triage");
				await expect(env.triages.apply({ id: held.id, revision: held.revision })).rejects.toThrow("review triage");
				await expect(env.call("s1", TRIAGE_TOOLS.capture)).rejects.toThrow("review triage");
				await expect(env.call("s1", TRIAGE_TOOLS.report, commentsReport)).rejects.toThrow("review triage");
				expect(await env.triages.keepCheckout("/tmp/app")).toContain("Retaining this checkout until the file is repaired");
				const cleanup: string[] = [];
				await endSession({ sessionId: "s1", workDir: "/tmp/app", end: async () => void cleanup.push("ended") }, async cwd => {
					const why = await env.triages.keepCheckout(cwd);
					if (why) throw new Error(why);
					cleanup.push("removed");
					return null;
				});
				expect(cleanup).toEqual(["ended"]);
				expect(readFileSync(env.path, "utf8")).toBe(invalid);
				const restarted = env.restart();
				expect(restarted.answer).toEqual({ list: [], owner: null });
				expect(restarted.join({ kind: "resume", sessionId: "s1" }, plainJoin)).toBe(plainJoin);
				writeFileSync(env.path, valid);
				expect(env.triages.edit({ id: held.id, revision: held.revision, itemId: "T1", op: "reply", text: "Repaired." })).toBe(true);
				expect(env.latest().items[0]?.reply).toBe("Repaired.");
				const applied = await env.triages.apply({ id: held.id, revision: env.latest().revision });
				expect(applied.batch?.selected.map(item => item.id)).toEqual(["T1", "T2"]);
			}
		} finally { diagnostic.mockRestore(); }
	});

	test("an unreadable store retains the last good list without replacing the unreadable path", async () => {
		const diagnostic = spyOn(console, "error").mockImplementation(() => {});
		try {
			const env = setup();
			const held = await accepted(env);
			const valid = readFileSync(env.path, "utf8");
			const backup = `${env.path}.backup`;
			renameSync(env.path, backup);
			mkdirSync(env.path);
			expect(env.triages.answer).toEqual({ list: [held], owner: null });
			expect(() => env.file.update(() => ({ triages: [], bindings: [] }))).toThrow("Cannot read review triages");
			await expect(env.triages.apply({ id: held.id, revision: held.revision })).rejects.toThrow("Cannot read review triages");
			expect(await env.triages.keepCheckout("/tmp/app")).toContain("Retaining this checkout until the file is repaired");
			expect(readFileSync(backup, "utf8")).toBe(valid);
			rmSync(env.path, { recursive: true });
			renameSync(backup, env.path);
			expect(env.triages.edit({ id: held.id, revision: held.revision, itemId: "T1", op: "reply", text: "Readable again." })).toBe(true);
			expect(env.latest().items[0]?.reply).toBe("Readable again.");
		} finally { diagnostic.mockRestore(); }
	});

	test("an already checked application refuses authorization from stale fallback state", async () => {
		const diagnostic = spyOn(console, "error").mockImplementation(() => {});
		try {
			const env = setup();
			const held = await accepted(env);
			await env.triages.apply({ id: held.id, revision: held.revision });
			await env.call("s2", TRIAGE_TOOLS.application);
			expect(env.latest().batch?.application).toMatchObject({ phase: "running", checked: true });
			const valid = readFileSync(env.path, "utf8");
			writeFileSync(env.path, "{broken");
			expect(env.triages.answer.list[0]?.batch?.application).toMatchObject({ phase: "running", checked: true });
			await expect(env.call("s2", TRIAGE_TOOLS.application)).rejects.toThrow("Cannot parse review triages");
			await expect(env.call("s2", TRIAGE_TOOLS.result, { results: [] })).rejects.toThrow("Cannot parse review triages");
			expect(readFileSync(env.path, "utf8")).toBe("{broken");
			writeFileSync(env.path, valid);
			const read = JSON.parse(await env.call("s2", TRIAGE_TOOLS.application));
			expect(read.codeTasks.map((item: { id: string }) => item.id)).toEqual(["T1"]);
		} finally { diagnostic.mockRestore(); }
	});
});

describe("capture", () => {
	test("each bound mode exposes and accepts only its own report fields", async () => {
		const comments = setup();
		comments.bind(commentsCapture);
		await comments.call("s1", TRIAGE_TOOLS.capture);
		expect(comments.tools.get("s1")?.find(tool => tool.name === TRIAGE_TOOLS.report)?.parameters).toMatchObject({
			properties: { items: { items: { required: ["sourceId", "assessment"], properties: { sourceId: { type: "string" } }, additionalProperties: false } } },
		});
		await expect(comments.call("s1", TRIAGE_TOOLS.report, { ...commentsReport, items: commentsReport.items.map(item => ({ ...item, number: null })) })).rejects.toThrow("only sourceId and assessment");
		await comments.call("s1", TRIAGE_TOOLS.report, commentsReport);
		expect(comments.latest().items.map(item => item.source)).toEqual([thread("T1"), thread("T2")]);
		const thermo = setup();
		await thermo.triages.startFromSession("s0", true);
		await thermo.call("s1", TRIAGE_TOOLS.capture);
		expect(thermo.tools.get("s1")?.find(tool => tool.name === TRIAGE_TOOLS.report)?.parameters).toMatchObject({
			properties: { items: { items: { required: ["number", "path", "line", "feedback", "assessment"], additionalProperties: false } } },
		});
		const finding = { number: 5, path: "src/a.ts", line: 2, feedback: "Original.", assessment: assessment("fix") };
		await expect(thermo.call("s1", TRIAGE_TOOLS.report, { summary: "One.", items: [{ ...finding, sourceId: null }] })).rejects.toThrow("no comment sourceId");
		await thermo.call("s1", TRIAGE_TOOLS.report, { summary: "One.", items: [finding] });
		expect(thermo.latest().items[0]?.source).toEqual({ kind: "thermo", id: "f5", number: 5, reportId: "s0", path: "src/a.ts", line: 2, body: "Original." });
	});

	test("a session's existing report keeps its original session and numbered findings", async () => {
		const env = setup();
		await env.triages.startFromSession("s0", true);
		const read = JSON.parse(await env.call("s1", TRIAGE_TOOLS.capture));
		expect(read.originalReport).toMatchObject({ sessionId: "s0", file: env.report });
		await env.call("s1", TRIAGE_TOOLS.report, { summary: "One.", items: [{ number: 1, path: "src/a.ts", line: 2, feedback: "1. Off by one.", assessment: assessment("fix") }] });
		expect(env.latest().target).toEqual({ kind: "local-session", sessionId: "s0" });
		expect(env.latest().items.map(item => item.source)).toEqual([{ kind: "thermo", id: "f1", number: 1, reportId: "s0", path: "src/a.ts", line: 2, body: "1. Off by one." }]);
	});

	test("an identical retry keeps the user's decisions, and a different report is refused", async () => {
		const env = setup();
		const triage = await accepted(env);
		expect(await env.call("s1", TRIAGE_TOOLS.report, commentsReport)).toBe("This report is already saved. User decisions and reply edits are unchanged.");
		expect(env.latest().items.map(item => item.decision)).toEqual(["accepted", "accepted"]);
		expect(env.latest().revision).toBe(triage.revision);
		await expect(env.call("s1", TRIAGE_TOOLS.report, { ...commentsReport, summary: "Other." })).rejects.toThrow("immutable");
	});

	test("a comments report must assess every captured thread", async () => {
		const env = setup();
		env.bind(commentsCapture);
		await env.call("s1", TRIAGE_TOOLS.capture);
		await expect(env.call("s1", TRIAGE_TOOLS.report, { ...commentsReport, items: commentsReport.items.slice(0, 1) })).rejects.toThrow("Assess every captured thread");
	});

	test("a report saved after a new comment arrived is refused", async () => {
		const env = setup();
		env.bind(commentsCapture);
		await env.call("s1", TRIAGE_TOOLS.capture);
		env.world.github = { ...env.world.github, sources: [thread("T1", "Edited."), thread("T2")] };
		await expect(env.call("s1", TRIAGE_TOOLS.report, commentsReport)).rejects.toThrow("changed during review");
	});

	test("another session running in the checkout does not block capture", async () => {
		const env = setup();
		env.world.conflict = "Session x may still edit this checkout.";
		await accepted(env);
		expect(env.latest().capture).not.toBeNull();
	});

	test("a nonempty review body with zero threads becomes an actionable card and a review note", async () => {
		const env = setup();
		env.world.github.sources = [review()];
		env.bind(commentsCapture);
		const read = JSON.parse(await env.call("s1", TRIAGE_TOOLS.capture));
		expect(read.triage.sources).toEqual([review()]);
		const payload = { summary: "One review.", items: [{ sourceId: "R1", assessment: assessment("push-back") }] };
		await expect(env.call("s1", TRIAGE_TOOLS.report, { ...payload, items: [] })).rejects.toThrow("Assess every captured thread and nonempty review body");
		await expect(env.call("s1", TRIAGE_TOOLS.report, { ...payload, items: [{ ...payload.items[0], sourceId: "forged" }] })).rejects.toThrow("captured thread or review id");
		await env.call("s1", TRIAGE_TOOLS.report, payload);
		const held = env.latest();
		env.triages.edit({ id: held.id, revision: held.revision, itemId: "R1", op: "decision", decision: "accepted" });
		const applied = await env.triages.apply({ id: held.id, revision: env.latest().revision });
		expect(applied.batch?.selected.map(item => [item.id, item.source, item.destination])).toEqual([["R1", review(), { kind: "review-note", reviewId: "R1" }]]);
	});

	test("review body edits and edit timestamps invalidate captured feedback", async () => {
		for (const changed of [{ ...review(), body: "Edited feedback." }, { ...review(), updatedAt: "2026-10-22T13:00:00Z" }]) {
			const env = setup();
			env.world.github.sources = [review()];
			env.bind(commentsCapture);
			await env.call("s1", TRIAGE_TOOLS.capture);
			env.world.github.sources = [changed];
			await expect(env.call("s1", TRIAGE_TOOLS.report, { summary: "One.", items: [{ sourceId: "R1", assessment: assessment("fix") }] })).rejects.toThrow("changed during review");
		}
	});

	test("thermo finding order preserves original numbers and identities without rewriting feedback", async () => {
		const env = setup();
		await env.triages.startFromSession("s0", true);
		await env.call("s1", TRIAGE_TOOLS.capture);
		await env.call("s1", TRIAGE_TOOLS.report, { summary: "Two.", items: [
			{ number: 5, path: "src/a.ts", line: 2, feedback: "Off by one.", assessment: assessment("fix") },
			{ number: 2, path: "src/b.ts", line: null, feedback: "Keep this wording.", assessment: assessment("push-back") },
		] });
		expect(env.latest().items.map(item => [item.id, item.source.kind === "thermo" && item.source.number, item.source.kind === "thermo" && item.source.body])).toEqual([["f5", 5, "Off by one."], ["f2", 2, "Keep this wording."]]);
	});

	test("thermo rejects missing, nonpositive, fractional, and duplicate original numbers", async () => {
		const env = setup();
		await env.triages.startFromSession("s0", true);
		await env.call("s1", TRIAGE_TOOLS.capture);
		const finding = { path: "", line: null, feedback: "Original.", assessment: assessment("fix") };
		for (const number of [undefined, null, 0, -1, 2.5]) await expect(env.call("s1", TRIAGE_TOOLS.report, { summary: "", items: [{ ...finding, number }] })).rejects.toThrow("positive original number");
		await expect(env.call("s1", TRIAGE_TOOLS.report, { summary: "", items: [{ ...finding, number: 5 }, { ...finding, number: 5 }] })).rejects.toThrow("only once");
	});
});

describe("checkout retention on End session", () => {
	test("retains the current complete report's checkout across a pending capture, then releases superseded and completed reports", async () => {
		const env = setup();
		const main = join(dirs.at(-1)!, "repo");
		mkdirSync(main);
		const first = `${main}-first`;
		const second = `${main}-second`;
		dirs.push(first, second);
		await runChecked(["git", "init", "-q", "-b", "main", main]);
		await runChecked(["git", "-C", main, "-c", "user.name=test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-qm", "Initial"]);
		await runChecked(["git", "-C", main, "worktree", "add", "--detach", first]);
		await runChecked(["git", "-C", main, "worktree", "add", "--detach", second]);
		mkdirSync(join(first, "subdir"));
		const alias = join(main, "first-link");
		symlinkSync(first, alias);
		env.bind({ ...commentsCapture, cwd: join(alias, "subdir") });
		await env.call("s1", TRIAGE_TOOLS.capture);
		await env.call("s1", TRIAGE_TOOLS.report, commentsReport);
		const firstId = env.latest().id;
		env.bind({ ...commentsCapture, cwd: second });
		await env.call("s2", TRIAGE_TOOLS.capture);
		expect(await env.triages.keepCheckout(first)).toBe(`Review triage ${firstId} still needs this checkout for its accepted application.`);
		const cleanup: string[] = [];
		await endSession({ sessionId: "s1", workDir: first, end: async () => void cleanup.push("ended") }, async dir => {
			const why = await env.triages.keepCheckout(dir);
			if (why) throw new Error(why);
			cleanup.push("removed");
			return null;
		});
		expect(cleanup).toEqual(["ended"]);
		await env.call("s2", TRIAGE_TOOLS.report, commentsReport);
		expect(await env.triages.keepCheckout(first)).toBeNull();
		const secondId = env.latest().id;
		expect(await env.triages.keepCheckout(second)).toBe(`Review triage ${secondId} still needs this checkout for its accepted application.`);
		for (const itemId of ["T1", "T2"]) env.triages.edit({ id: secondId, revision: env.latest().revision, itemId, op: "decision", decision: "accepted" });
		await env.triages.apply({ id: secondId, revision: env.latest().revision });
		await env.call("s3", TRIAGE_TOOLS.application);
		await env.call("s3", TRIAGE_TOOLS.result, { results: [
			{ id: "T1", outcome: "blocked", reply: "Blocked.", reason: "Needs a product decision.", evidence: null, changedFiles: null },
			{ id: "T2", outcome: "reply-only", reply: "Keeping this.", evidence: "Existing guard.", reason: null, changedFiles: null },
		] });
		await endSession({ sessionId: "s3", workDir: second, end: async () => void cleanup.push("ended") }, async dir => {
			const why = await env.triages.keepCheckout(dir);
			if (why) throw new Error(why);
			cleanup.push("removed");
			return null;
		});
		expect(cleanup).toEqual(["ended", "ended", "removed"]);
	});
});

describe("Apply accepted", () => {
	test("two clicks start one session for one batch of the accepted items", async () => {
		const env = setup();
		const triage = await accepted(env);
		const before = env.world.starts.length;
		const [first, second] = await Promise.all([env.triages.apply({ id: triage.id, revision: triage.revision }), env.triages.apply({ id: triage.id, revision: triage.revision })]);
		expect(env.world.starts.length - before).toBe(1);
		expect(second).toEqual(first);
		expect(first.batch?.selected.map(item => item.id)).toEqual(["T1", "T2"]);
		expect(first.batch?.application).toMatchObject({ phase: "running", checked: false });
	});

	test("a later click on a running batch resumes its session instead of starting another", async () => {
		const env = setup();
		const triage = await accepted(env);
		const applied = await env.triages.apply({ id: triage.id, revision: triage.revision });
		const before = env.world.starts.length;
		await env.triages.apply({ id: triage.id, revision: applied.revision });
		expect([env.world.starts.length - before, env.world.resumes]).toEqual([0, [applied.batch?.application.phase === "running" ? applied.batch.application.sessionId : ""]]);
	});

	test("after a restart, a batch whose session was bound resumes that session rather than reading as an unknown launch", async () => {
		const env = setup();
		const triage = await accepted(env);
		const applied = await env.triages.apply({ id: triage.id, revision: triage.revision });
		const session = applied.batch?.application.phase === "running" ? applied.batch.application.sessionId : "";
		const before = env.world.starts.length;
		const resumed = await env.restart().apply({ id: triage.id, revision: applied.revision });
		expect([env.world.starts.length - before, env.world.resumes, resumed.batch?.application]).toEqual([0, [session], { phase: "running", sessionId: session, instanceId: "i2", checked: false }]);
		expect(env.restart().join({ kind: "resume", sessionId: session }, plainJoin).rpc.tools.map(tool => tool.name)).toEqual([TRIAGE_TOOLS.application, TRIAGE_TOOLS.result]);
	});

	test("no stored state ever holds an application session's binding while its batch still reads as reserved", async () => {
		const env = setup();
		const triage = await accepted(env);
		await env.triages.apply({ id: triage.id, revision: triage.revision });
		const torn = env.written.filter(state => state.bindings.some(binding => binding.role === "apply" && state.triages.find(held => held.id === binding.id)?.batch?.application.phase === "reserved"));
		expect(torn).toEqual([]);
		expect(env.written.at(-1)?.bindings.filter(binding => binding.role === "apply").length).toBe(1);
	});

	test("a failed launch interrupts the batch, which never starts again", async () => {
		const env = setup();
		const triage = await accepted(env);
		env.world.failStart = "omp is missing";
		await expect(env.triages.apply({ id: triage.id, revision: triage.revision })).rejects.toThrow("omp is missing");
		expect(env.latest().batch?.application).toEqual({ phase: "interrupted", reason: "The launch failed: omp is missing. It does not start again by itself." });
		env.world.failStart = null;
		const before = env.world.starts.length;
		await expect(env.triages.apply({ id: triage.id, revision: env.latest().revision })).rejects.toThrow("does not start again");
		expect(env.world.starts.length).toBe(before);
	});

	test("refuses when the head moved, the feedback changed, the local tree changed, or another session edits the checkout", async () => {
		const cases: [string, (world: ReturnType<typeof setup>["world"]) => void, string][] = [
			["head", world => void (world.github = { ...world.github, head: "b".repeat(40) }), "no longer matches the pull request head"],
			["feedback", world => void (world.github = { ...world.github, sources: [thread("T1", "Edited."), thread("T2")] }), "Code or feedback changed"],
			["tree", world => void (world.code = { ...world.code, worktree: "dirty" }), "Code or feedback changed"],
			["conflict", world => void (world.conflict = "Session x may still edit this checkout."), "Session x may still edit"],
		];
		for (const [, change, error] of cases) {
			const env = setup();
			const triage = await accepted(env);
			change(env.world);
			const before = env.world.starts.length;
			await expect(env.triages.apply({ id: triage.id, revision: triage.revision })).rejects.toThrow(error);
			expect([env.world.starts.length - before, env.latest().batch]).toEqual([0, null]);
		}
	});

	test("an incomplete new capture does not supersede a finished report or block its first application read", async () => {
		const env = setup();
		const held = await accepted(env);
		env.bind(commentsCapture);
		await env.call("s2", TRIAGE_TOOLS.capture);
		const applied = await env.triages.apply({ id: held.id, revision: held.revision });
		expect(applied.batch?.selected.map(item => item.id)).toEqual(["T1", "T2"]);
		const read = JSON.parse(await env.call("s3", TRIAGE_TOOLS.application));
		expect(read.selected.map((item: { id: string }) => item.id)).toEqual(["T1", "T2"]);
	});

	test("a genuinely newer complete report supersedes the old report", async () => {
		const env = setup();
		const held = await accepted(env);
		env.bind(commentsCapture);
		await env.call("s2", TRIAGE_TOOLS.capture);
		await env.call("s2", TRIAGE_TOOLS.report, commentsReport);
		await expect(env.triages.apply({ id: held.id, revision: held.revision })).rejects.toThrow("newer report replaced");
		expect(env.latest().items.map(item => item.id)).toEqual(["T1", "T2"]);
	});

	test("refuses on a dashboard that does not own Review triage", async () => {
		const env = setup();
		const triage = await accepted(env);
		env.world.owner = false;
		await expect(env.triages.apply({ id: triage.id, revision: triage.revision })).rejects.toThrow("http://127.0.0.1:20001");
	});
});

describe("the application session", () => {
	async function applying(env: ReturnType<typeof setup>): Promise<string> {
		const triage = await accepted(env);
		const applied = await env.triages.apply({ id: triage.id, revision: triage.revision });
		return applied.batch?.application.phase === "running" ? applied.batch.application.sessionId : "";
	}
	const results = (files: string[]) => ({
		results: [
			{ id: "T1", outcome: "fixed", reply: "Fixed it.", changedFiles: files, evidence: "bun test passes.", reason: null },
			{ id: "T2", outcome: "reply-only", reply: "Keeping it.", changedFiles: null, evidence: "The guard at src/a.ts:9 covers it.", reason: null },
		],
	});

	test("reads only the accepted selection, split into code tasks and reply-only items", async () => {
		const env = setup();
		const session = await applying(env);
		const read = JSON.parse(await env.call(session, TRIAGE_TOOLS.application));
		expect([read.codeTasks.map((item: { id: string }) => item.id), read.replyOnly.map((item: { id: string }) => item.id)]).toEqual([["T1"], ["T2"]]);
		expect(env.latest().batch?.application).toMatchObject({ phase: "running", checked: true });
	});

	test("saves fixed evidence for files the application changed, with each thread as the reply destination", async () => {
		const env = setup();
		const session = await applying(env);
		await env.call(session, TRIAGE_TOOLS.application);
		env.world.code = { ...env.world.code, worktree: "w2", dirty: [{ path: "src/a.ts", digest: "fixed" }] };
		await env.call(session, TRIAGE_TOOLS.result, results(["./src/a.ts"]));
		const application = env.latest().batch?.application;
		expect(application?.phase === "completed" && application.results).toEqual([
			{ id: "T1", outcome: "fixed", reply: "Fixed it.", changedFiles: ["src/a.ts"], evidence: "bun test passes.", destination: { kind: "thread", threadId: "T1" } },
			{ id: "T2", outcome: "reply-only", reply: "Keeping it.", evidence: "The guard at src/a.ts:9 covers it.", destination: { kind: "thread", threadId: "T2" } },
		]);
	});

	test("refuses a fixed result naming a file the application did not change, even one the user had already changed", async () => {
		const env = setup();
		const session = await applying(env);
		await env.call(session, TRIAGE_TOOLS.application);
		await expect(env.call(session, TRIAGE_TOOLS.result, results(["src/a.ts"]))).rejects.toThrow("src/a.ts has no change since the review");
		env.world.code = { ...env.world.code, untracked: [{ path: "src/new.ts", digest: "n" }] };
		await expect(env.call(session, TRIAGE_TOOLS.result, results(["src/a.ts", "src/new.ts"]))).rejects.toThrow("src/a.ts has no change since the review");
		await expect(env.call(session, TRIAGE_TOOLS.result, results(["src/b.ts"]))).rejects.toThrow("src/b.ts has no change since the review");
		expect(env.latest().batch?.application.phase).toBe("running");
	});

	test("refuses fixed results once the application committed", async () => {
		const env = setup();
		const session = await applying(env);
		await env.call(session, TRIAGE_TOOLS.application);
		env.world.code = { ...env.world.code, head: "c".repeat(40), dirty: [] };
		await expect(env.call(session, TRIAGE_TOOLS.result, results(["src/a.ts"]))).rejects.toThrow("HEAD moved since the review");
	});

	test("refuses its first read when the code moved after launch", async () => {
		const env = setup();
		const session = await applying(env);
		env.world.code = { ...env.world.code, index: "staged" };
		await expect(env.call(session, TRIAGE_TOOLS.application)).rejects.toThrow("changed before the first edit");
	});
});

describe("binding on another dashboard", () => {
	test("a session that starts on a dashboard that does not own triage is not bound there", async () => {
		const env = setup();
		env.world.owner = false;
		const attached: string[] = [];
		const joined = env.triages.join(commentsCapture, { rpc: PLAIN_LAUNCH, attach: session => void attached.push(session.sessionId) });
		expect(() => joined.attach({ instanceId: "i1", sessionId: "s1", cwd: "/tmp/app" })).not.toThrow();
		expect(attached).toEqual(["s1"]);
		env.world.owner = true;
		expect(env.triages.join({ kind: "resume", sessionId: "s1" }, plainJoin)).toBe(plainJoin);
	});
});
