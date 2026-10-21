import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteText } from "../fs";
import { canonical, git, worktreesOf } from "../git";
import type { LiveRow, LiveSession } from "../live-session";
import type { RpcHostTool } from "../omp/modules";
import { parseComparisonSpec, type ComparisonSpec } from "../shared/comparisons";
import type { StartRequest } from "../shared/sessions";
import { Worktrees } from "../worktrees";
import { Comparisons } from "./comparisons";
import { LiveSessions } from "./live-sessions";
import type { Starter } from "./start";
import { parseClientMsg } from "./wire";

const roots: string[] = [];
const aggregates: Comparisons[] = [];
const changes = new WeakMap<Comparisons, () => Promise<void>>();
afterEach(async () => {
	for (const aggregate of aggregates.splice(0)) { await aggregate.stop(); aggregate.release(); }
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const PNG = Buffer.from(await new Bun.Image(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")).png().bytes());

class Session implements LiveSession {
	stopped = false;
	prompts: string[] = [];
	constructor(readonly instanceId: string, readonly cwd: string, public sessionId: string) {}
	row(): LiveRow { throw new Error("This fixture reads the registry through its consumer-facing identities."); }
	transcriptPath(): null { return null; }
	async prompt(_agent: string | null, text: string): Promise<void> { this.prompts.push(text); }
	async dequeue(): Promise<null> { return null; }
	async promote(): Promise<boolean> { return false; }
	async interrupt(): Promise<[]> { return []; }
	flush(): void {}
	async cancelAgent(): Promise<void> {}
	async end(): Promise<void> { this.stopped = true; }
	answer(): void {}
	follow(): void {}
	finished(): boolean { return this.stopped; }
	async dispose(): Promise<void> {}
}

async function fixture(count = 5, options: { fail?: number; uncertain?: number; advanceBase?: boolean; write?: typeof atomicWriteText; holdSecondAllocation?: { entered(): void; resume: Promise<void> } } = {}) {
	const root = mkdtempSync(join(tmpdir(), "omp-comparison-"));
	roots.push(root);
	const main = join(root, "repo");
	await mkdir(join(main, "app"), { recursive: true });
	await git(main, "init", "-q");
	await git(main, "config", "user.email", "test@example.com");
	await git(main, "config", "user.name", "Comparison test");
	writeFileSync(join(main, "app", "index.html"), "base");
	writeFileSync(join(main, ".gitignore"), "cache/\n");
	await git(main, "add", ".");
	await git(main, "commit", "-qm", "base");
	const base = (await git(main, "rev-parse", "HEAD")).trim();
	const sessions = new LiveSessions(() => {});
	const launched: { request: StartRequest; session: Session; tools: RpcHostTool[] }[] = [];
	const cancelled: string[] = [];
	let calls = 0;
	const start: Starter = async (request, _project, reserved) => {
		if (request.kind !== "new" || !reserved) throw new Error("A variant must use the reserved ordinary starter seam.");
		const ordinal = ++calls;
		if (ordinal === 1 && options.advanceBase) {
			writeFileSync(join(main, "app", "index.html"), "source advanced during allocation");
			await git(main, "commit", "-qam", "advance while variants start");
		}
		if (ordinal === options.fail) return { ok: false, error: "Provider refused this variant." };
		const session = new Session(reserved.instanceId, request.cwd, `s${ordinal}`);
		sessions.add(session, null);
		launched.push({ request, session, tools: reserved.rpc.tools });
		await reserved.registered(session);
		await reserved.beforePrompt();
		if (ordinal === options.uncertain) throw new Error("Admission connection ended without an answer.");
		await session.prompt(null, request.prompt);
		await reserved.admitted();
		return { ok: true, instanceId: session.instanceId, cwd: session.cwd, prompt: null };
	};
	const worktrees = new class extends Worktrees {
		allocations = 0;
		override checkout<T>(task: () => Promise<T>): Promise<T> {
			return super.checkout(async () => {
				if (++this.allocations === 2 && options.holdSecondAllocation) { options.holdSecondAllocation.entered(); await options.holdSecondAllocation.resume; }
				return task();
			});
		}
	}({ knownCwds: () => [main], activity: () => [], live: () => sessions.cwds().map(cwd => ({ cwd, unknownAgents: false })), serverCwd: join(root, "dashboard"), mergedPullRequests: async () => new Map() });
	const dir = join(root, "data", "comparisons");
	let change = Promise.withResolvers<void>();
	const env = { dir, port: 49371, sessions, worktrees, start, cancelContinue: (id: string) => { cancelled.push(id); }, changed: () => { const prior = change; change = Promise.withResolvers<void>(); prior.resolve(); }, write: options.write };
	const comparisons = new Comparisons(env);
	changes.set(comparisons, () => change.promise);
	aggregates.push(comparisons);
	const spec: ComparisonSpec = { cwd: join(main, "app"), prompt: "Build independent layouts.", images: [], base: "HEAD", model: { provider: "common", id: "model" }, thinking: "high", skill: null, variants: Array.from({ length: count }, (_, index) => ({ model: index === 2 ? { provider: "override", id: "different" } : null, thinking: index === 2 ? "low" : null })) };
	return { root, main, base, dir, env, comparisons, sessions, worktrees, launched, cancelled, spec, calls: () => calls };
}

async function settled(comparisons: Comparisons): Promise<void> {
	for (;;) {
		const members = comparisons.list[0]?.variants;
		if (members?.every(v => v.start.kind === "failed" || v.start.kind === "cancelled" || v.firstPrompt.kind === "admitted" || v.firstPrompt.kind === "uncertain")) return;
		const next = changes.get(comparisons);
		if (!next) throw new Error("This fixture has no durable-change subscription.");
		await next();
	}
}

function reviewId(comparisons: Comparisons): string {
	const cleanup = comparisons.list[0]!.cleanup;
	if (cleanup.kind !== "ready") throw new Error("Expected a final read-only loss review.");
	return cleanup.review.id;
}

describe("Design comparisons", () => {
	test("five fresh branches share one captured commit, preserve the source subdirectory, and resolve per-row models", async () => {
		const f = await fixture(5, { advanceBase: true });
		await Promise.all([f.comparisons.start("five", f.spec), f.comparisons.start("five", f.spec)]);
		await settled(f.comparisons);
		const snapshot = f.comparisons.list[0]!;
		expect(snapshot.variants.map(v => [v.ordinal, v.start.kind, v.firstPrompt.kind])).toEqual([[1, "registered", "admitted"], [2, "registered", "admitted"], [3, "registered", "admitted"], [4, "registered", "admitted"], [5, "registered", "admitted"]]);
		expect(new Set(snapshot.variants.map(v => v.instanceId)).size).toBe(5);
		expect(new Set(snapshot.variants.map(v => v.checkout)).size).toBe(5);
		expect(new Set(snapshot.variants.map(v => v.branch)).size).toBe(5);
		expect(f.calls()).toBe(5);
		expect(snapshot.variants.map(v => v.cwd.slice(v.checkout.length))).toEqual(["/app", "/app", "/app", "/app", "/app"]);
		expect(snapshot.variants.map(v => [v.model, v.thinking])).toEqual([[{ provider: "common", id: "model" }, "high"], [{ provider: "common", id: "model" }, "high"], [{ provider: "override", id: "different" }, "low"], [{ provider: "common", id: "model" }, "high"], [{ provider: "common", id: "model" }, "high"]]);
		expect((await git(f.main, "rev-parse", "HEAD")).trim()).not.toBe(f.base);
		expect(await Promise.all(snapshot.variants.map(async v => (await git(v.checkout, "rev-parse", "HEAD")).trim()))).toEqual([f.base, f.base, f.base, f.base, f.base]);
		expect(f.launched.map(row => row.tools.map(tool => [tool.name, tool.loadMode]))).toEqual(Array.from({ length: 5 }, () => [["publish_variant_screenshot", "essential"]]));
		await expect(f.comparisons.start("five", { ...f.spec, prompt: "Different prompt" })).rejects.toThrow("different prompt");
	});

	test("selection cancels queued allocations before any sibling prompt is attempted", async () => {
		const held = Promise.withResolvers<void>();
		const resume = Promise.withResolvers<void>();
		const f = await fixture(5, { holdSecondAllocation: { entered: held.resolve, resume: resume.promise } });
		await f.comparisons.start("cancel", f.spec);
		await held.promise;
		for (;;) {
			if (f.comparisons.list[0]!.variants[0]!.firstPrompt.kind === "admitted") break;
			await changes.get(f.comparisons)!();
		}
		const selection = f.comparisons.select("cancel", "v1");
		for (;;) {
			if (f.comparisons.list[0]!.winner === "v1") break;
			await changes.get(f.comparisons)!();
		}
		resume.resolve();
		await selection;
		expect(f.calls()).toBe(1);
		expect(f.comparisons.list[0]!.variants.map(v => [v.start.kind, v.firstPrompt.kind])).toEqual([["registered", "admitted"], ["cancelled", "not-attempted"], ["cancelled", "not-attempted"], ["cancelled", "not-attempted"], ["cancelled", "not-attempted"]]);
	});

	test("publication waits for throwing durable persistence and a failed tool call remains retryable", async () => {
		let fail = false;
		const f = await fixture(2, { write: async (path, text, mode) => {
			if (fail) { fail = false; throw new Error("Screenshot record is not writable"); }
			await atomicWriteText(path, text, mode);
		} });
		await f.comparisons.start("persist", f.spec); await settled(f.comparisons);
		const member = f.comparisons.list[0]!.variants[0]!;
		const path = join(member.cwd, "raster.png"); writeFileSync(path, PNG);
		const first = await f.comparisons.publish("persist", "v1", "first", path, "Persisted");
		fail = true;
		await expect(f.comparisons.publish("persist", "v1", "retryable", path, "Not committed")).rejects.toThrow("not writable");
		expect(f.comparisons.list[0]!.variants[0]!.screenshot).toEqual(first);
		const retried = await f.comparisons.publish("persist", "v1", "retryable", path, "Committed retry");
		expect([retried.sequence, retried.caption]).toEqual([2, "Committed retry"]);
	});

	test("one failed start and uncertain admission do not erase registered siblings or resend a prompt after restart", async () => {
		const f = await fixture(5, { fail: 2, uncertain: 4 });
		await f.comparisons.start("partial", f.spec);
		await settled(f.comparisons);
		expect(f.comparisons.list[0]!.variants.map(v => [v.start.kind, v.firstPrompt.kind])).toEqual([["registered", "admitted"], ["failed", "not-attempted"], ["registered", "admitted"], ["registered", "uncertain"], ["registered", "admitted"]]);
		await f.comparisons.stop();
		f.comparisons.release();
		const path = join(f.dir, "partial", "comparison.json");
		const disk = JSON.parse(readFileSync(path, "utf8"));
		disk.snapshot.variants[0].firstPrompt = { kind: "attempted" };
		writeFileSync(path, JSON.stringify(disk));
		const reopened = new Comparisons({ ...f.env, sessions: new LiveSessions(() => {}) });
		aggregates.push(reopened);
		await reopened.recover();
		expect(reopened.list[0]!.variants.map(v => v.firstPrompt.kind)).toEqual(["uncertain", "not-attempted", "admitted", "uncertain", "admitted"]);
		expect(f.calls()).toBe(5);
		await reopened.start("partial", f.spec);
		expect(f.calls()).toBe(5);
	});

	test("the bound tool publishes copied raster bytes, replaces a reused path, and deduplicates old tool calls without reordering latest", async () => {
		const f = await fixture(2);
		await f.comparisons.start("screens", f.spec);
		await settled(f.comparisons);
		const member = f.comparisons.list[0]!.variants[1]!;
		const source = join(member.cwd, "screen.png");
		writeFileSync(source, PNG);
		const tool = f.launched.find(row => row.session.instanceId === member.instanceId)!.tools[0]!;
		const invoke = (toolCallId: string, caption: string) => tool.execute({ path: source, caption }, { toolCallId, signal: new AbortController().signal });
		const first = JSON.parse(await invoke("call-a", "First screenshot"));
		const replacement = Buffer.from(await new Bun.Image(PNG).resize(2, 1).png().bytes());
		writeFileSync(source, replacement);
		const second = JSON.parse(await invoke("call-b", "Replacement screenshot"));
		expect([first.sequence, second.sequence, first.caption, second.caption]).toEqual([1, 2, "First screenshot", "Replacement screenshot"]);
		expect(JSON.parse(await invoke("call-a", "A retried old call"))).toEqual(first);
		expect(f.comparisons.list[0]!.variants[1]!.screenshot).toEqual(second);
		writeFileSync(source, "not a raster image");
		await expect(invoke("invalid", "Not an image")).rejects.toThrow();
		expect(f.comparisons.list[0]!.variants[1]!.screenshot).toEqual(second);
		await f.comparisons.select("screens", "v1");
		await f.comparisons.reviewCleanup("screens");
		await f.comparisons.cleanup("screens", reviewId(f.comparisons), "discard-owned-changes");
		expect(f.comparisons.list[0]!.variants.map(v => v.cleanup.kind)).toEqual(["pending", "removed"]);
		expect(existsSync(member.checkout)).toBe(false);
		const saved = new URL(second.src, "http://localhost").searchParams.get("path")!;
		expect(readFileSync(saved).equals(replacement)).toBe(true);
		expect(readFileSync(new URL(first.src, "http://localhost").searchParams.get("path")!).equals(PNG)).toBe(true);
		await f.comparisons.stop(); f.comparisons.release();
		const reopened = new Comparisons(f.env); aggregates.push(reopened);
		await reopened.recover();
		expect(reopened.list[0]!.variants[1]!.screenshot).toEqual(second);
		expect(await reopened.publish("screens", "v2", "call-a", source, "Retry after restart")).toEqual(first);
		expect(reopened.list[0]!.variants[1]!.screenshot).toEqual(second);
	});

	test("Keep has one immutable winner and review never stops or deletes anything", async () => {
		const f = await fixture();
		await f.comparisons.start("keep", f.spec); await settled(f.comparisons);
		await f.comparisons.reviewCleanup("keep");
		expect(f.comparisons.list[0]!.cleanup).toEqual({ kind: "not-selected" });
		expect(f.launched.map(row => row.session.stopped)).toEqual([false, false, false, false, false]);
		const selections = await Promise.allSettled([f.comparisons.select("keep", "v1"), f.comparisons.select("keep", "v2")]);
		expect(selections.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
		expect(f.comparisons.list[0]!.winner).toBe("v1");
		expect(f.comparisons.list[0]!.variants.map(v => v.stop.kind)).toEqual(["not-requested", "stopped", "stopped", "stopped", "stopped"]);
		await f.comparisons.reviewCleanup("keep");
		expect(f.comparisons.list[0]!.variants.map(v => existsSync(v.checkout))).toEqual([true, true, true, true, true]);
		await f.comparisons.cleanup("keep", reviewId(f.comparisons), "preserve-changes");
		expect(f.comparisons.list[0]!.variants.map(v => v.cleanup.kind)).toEqual(["pending", "preserved", "preserved", "preserved", "preserved"]);
		expect(f.cancelled.sort()).toEqual(["s2", "s3", "s4", "s5"]);
	});

	test("confirmed dirty owned cleanup preserves the winner, every branch, locked and nested repositories, and files changed after review", async () => {
		const f = await fixture(); await f.comparisons.start("safe", f.spec); await settled(f.comparisons);
		const [winner, dirty, locked, nested, drift] = f.comparisons.list[0]!.variants;
		writeFileSync(join(dirty!.cwd, "index.html"), "changed prototype");
		writeFileSync(join(dirty!.cwd, "new.txt"), "untracked prototype");
		await mkdir(join(dirty!.checkout, "cache")); writeFileSync(join(dirty!.checkout, "cache", "ignored.txt"), "ignored prototype");
		await git(f.main, "worktree", "lock", locked!.checkout);
		await mkdir(join(nested!.checkout, "nested")); await git(join(nested!.checkout, "nested"), "init", "-q");
		writeFileSync(join(drift!.cwd, "index.html"), "before");
		await f.comparisons.select("safe", "v1"); await f.comparisons.reviewCleanup("safe");
		const read = f.comparisons.list[0]!.cleanup;
		if (read.kind !== "ready") throw new Error("Expected loss review");
		expect(read.review.rows[0]).toMatchObject({ variantId: "v2", tracked: ["app/index.html"], untracked: ["app/new.txt"], ignored: ["cache/ignored.txt"], removed: false });
		writeFileSync(join(drift!.cwd, "index.html"), "after!");
		await f.comparisons.cleanup("safe", read.review.id, "discard-owned-changes");
		expect(f.comparisons.list[0]!.variants.map(v => v.cleanup.kind)).toEqual(["pending", "removed", "blocked", "blocked", "blocked"]);
		expect([winner, dirty, locked, nested, drift].map(v => existsSync(v!.checkout))).toEqual([true, false, true, true, true]);
		expect(readFileSync(join(drift!.cwd, "index.html"), "utf8")).toBe("after!");
		const branches = (await git(f.main, "for-each-ref", "--format=%(refname:short)", "refs/heads/variants/")).trim().split("\n");
		expect(branches.sort()).toEqual(f.comparisons.list[0]!.variants.map(v => v.branch).sort());
		await expect(f.comparisons.cleanup("safe", read.review.id, "discard-owned-changes")).rejects.toThrow("expired");
	});

	test("the review includes staged-only loss and index drift invalidates discard consent even when worktree bytes stay unchanged", async () => {
		const f = await fixture(2); await f.comparisons.start("index", f.spec); await settled(f.comparisons);
		const member = f.comparisons.list[0]!.variants[1]!;
		writeFileSync(join(member.cwd, "index.html"), "staged prototype");
		await git(member.checkout, "add", "app/index.html");
		writeFileSync(join(member.cwd, "index.html"), "base");
		await f.comparisons.select("index", "v1"); await f.comparisons.reviewCleanup("index");
		const loss = f.comparisons.list[0]!.cleanup;
		if (loss.kind !== "ready") throw new Error("Expected the exact final index loss");
		expect(loss.review.rows[0]!.tracked).toEqual(["app/index.html"]);
		await git(member.checkout, "reset", "-q", "HEAD", "--", "app/index.html");
		await f.comparisons.cleanup("index", loss.review.id, "discard-owned-changes");
		expect(f.comparisons.list[0]!.variants[1]!.cleanup.kind).toBe("blocked");
		expect(existsSync(member.checkout)).toBe(true);
	});

	test("a session switch and continuation retain membership, restore its bound tool, and are stopped with the losing variant", async () => {
		const f = await fixture(2); await f.comparisons.start("continue", f.spec); await settled(f.comparisons);
		const member = f.comparisons.list[0]!.variants[1]!;
		const old = f.launched.find(row => row.session.instanceId === member.instanceId)!.session;
		old.sessionId = "s2-switched";
		f.sessions.allocate(old.instanceId).emit({ kind: "switched" });
		f.comparisons.observe(old.instanceId);
		while (!f.comparisons.list[0]!.variants[1]!.sessionIds.includes(old.sessionId)) await changes.get(f.comparisons)!();
		await old.end(); f.sessions.remove(old.instanceId);
		const tools = f.comparisons.prepare({ kind: "resume", sessionId: old.sessionId }, "continued-instance");
		const continued = new Session("continued-instance", member.cwd, old.sessionId);
		f.sessions.add(continued, null); await f.comparisons.registered(continued);
		const path = join(member.cwd, "continued.png"); writeFileSync(path, PNG);
		await tools[0]!.execute({ path, caption: "Published by the continuation" }, { toolCallId: "continued-publication", signal: new AbortController().signal });
		expect(f.comparisons.list[0]!.variants[1]).toMatchObject({ instanceId: continued.instanceId, sessionIds: ["s2", "s2-switched"], screenshot: { caption: "Published by the continuation" } });
		await f.comparisons.select("continue", "v1");
		expect(continued.stopped).toBe(true);
		expect(f.cancelled.sort()).toEqual(["s2", "s2-switched"]);
		expect(() => f.comparisons.prepare({ kind: "resume", sessionId: old.sessionId }, "forbidden")).toThrow();
	});

	test("discard re-verifies that a stopped loser has not resumed since its loss review", async () => {
		const f = await fixture(2); await f.comparisons.start("resumed", f.spec); await settled(f.comparisons);
		await f.comparisons.select("resumed", "v1"); await f.comparisons.reviewCleanup("resumed");
		const review = reviewId(f.comparisons);
		const member = f.comparisons.list[0]!.variants[1]!;
		const resumed = new Session(member.instanceId, member.cwd, member.sessionId!);
		f.sessions.add(resumed, null);
		await f.comparisons.cleanup("resumed", review, "discard-owned-changes");
		expect(f.comparisons.list[0]!.variants[1]).toMatchObject({ stop: { kind: "blocked" }, cleanup: { kind: "blocked" } });
		expect(existsSync(member.checkout)).toBe(true);
		expect(resumed.stopped).toBe(false);
	});

	test("ownership belongs to one server and restart invalidates destructive consent", async () => {
		const f = await fixture(2); await f.comparisons.start("owner", f.spec); await settled(f.comparisons);
		const other = new Comparisons({ ...f.env, port: 49372, sessions: new LiveSessions(() => {}) }); aggregates.push(other);
		await other.recover();
		expect(other.list[0]!.owner).toEqual({ kind: "other", port: 49371 });
		expect(other.mayAttach(f.comparisons.list[0]!.variants[0]!.instanceId)).toBe(false);
		await expect(other.select("owner", "v1")).rejects.toThrow("49371");
		await f.comparisons.select("owner", "v1"); await f.comparisons.reviewCleanup("owner");
		const oldReview = reviewId(f.comparisons);
		await f.comparisons.stop(); f.comparisons.release();
		const recovered = new Comparisons({ ...f.env, port: 49373, sessions: new LiveSessions(() => {}) }); aggregates.push(recovered);
		await recovered.recover();
		expect(recovered.list[0]!.owner).toEqual({ kind: "local" });
		await expect(recovered.cleanup("owner", oldReview, "discard-owned-changes")).rejects.toThrow("expired");
		expect(f.comparisons.list[0]!.variants.map(v => existsSync(v.checkout))).toEqual([true, true]);
	});

	test("a failed initial durable acceptance launches nothing", async () => {
		const f = await fixture(2, { write: async () => { throw new Error("Disk is read-only"); } });
		await expect(f.comparisons.start("disk", f.spec)).rejects.toThrow("read-only");
		expect(f.calls()).toBe(0);
		expect((await worktreesOf(f.main)).map(row => row.path)).toEqual([await canonical(f.main)]);
	});

	test("a replacement directory cannot inherit permission to discard owned changes", async () => {
		const f = await fixture(2); await f.comparisons.start("identity", f.spec); await settled(f.comparisons);
		await f.comparisons.select("identity", "v1"); await f.comparisons.reviewCleanup("identity");
		const review = reviewId(f.comparisons);
		const loser = f.comparisons.list[0]!.variants[1]!;
		await rename(loser.checkout, `${loser.checkout}-original`);
		await mkdir(loser.checkout); writeFileSync(join(loser.checkout, "unrelated.txt"), "must survive");
		await f.comparisons.cleanup("identity", review, "discard-owned-changes");
		expect(readFileSync(join(loser.checkout, "unrelated.txt"), "utf8")).toBe("must survive");
		expect(f.comparisons.list[0]!.variants[1]!.cleanup.kind).toBe("blocked");
	});
});

test("comparison wire parsing accepts all five variants and explicit cleanup consent, but refuses bad identities and too few variants", () => {
	const spec = { cwd: "/repo", prompt: "Build a design", base: "HEAD", images: [], model: null, thinking: null, skill: null, variants: Array.from({ length: 5 }, () => ({ model: null, thinking: null })) };
	expect(parseClientMsg(JSON.stringify({ t: "comparison-start", id: "held-before-send", spec }))).toEqual({ ok: { t: "comparison-start", id: "held-before-send", spec } });
	expect(parseComparisonSpec({ ...spec, variants: [{ model: null, thinking: null }] })).toBeNull();
	expect(parseClientMsg(JSON.stringify({ t: "comparison-start", id: "../outside", spec }))).toBeNull();
	expect(parseClientMsg(JSON.stringify({ t: "comparison-cleanup", id: "held-before-send", reviewId: "fresh-review", policy: "discard-owned-changes" }))).toEqual({ ok: { t: "comparison-cleanup", id: "held-before-send", reviewId: "fresh-review", policy: "discard-owned-changes" } });
});
