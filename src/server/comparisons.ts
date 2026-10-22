import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { newInstanceId } from "../dashboard-session";
import type { atomicWriteText } from "../fs";
import { allocateVariant, canonical, git, worktreeAt, worktreesOf } from "../git";
import { errorText } from "../json";
import type { LiveSession } from "../live-session";
import { keptSessionCwd, keptSessions } from "../omp/rpc";
import { directoryOf } from "../paths";
import { SerialLane } from "../serial-lane";
import { isComparisonId, isVariantStopped, parseComparisonSpec, type CleanupPolicy, type CleanupRead, type CleanupReview, type CleanupRow, type ComparisonSnapshot, type ComparisonSpec } from "../shared/comparisons";
import { worktreeDir } from "../shared/git";
import { modelOfSelector } from "../shared/models";
import { newSessionRequest, type StartRequest } from "../shared/sessions";
import type { OwnedCheckoutReview, Worktrees } from "../worktrees";
import { ComparisonRecords, parseComparisonRecord, type ComparisonEntry, type ComparisonRecord, type VariantRecord } from "./comparison-records";
import type { LiveSessions } from "./live-sessions";
import { OwnerLock } from "./owner-lock";
import type { ProjectJoin } from "./project-runner";
import type { Starter } from "./start";
import { VariantScreenshots } from "./variant-screenshots";

interface ComparisonEnv {
	dir: string;
	port: number;
	sessions: LiveSessions;
	worktrees: Worktrees;
	start: Starter;
	cancelContinue(sessionId: string): void;
	changed(): void;
	write?: typeof atomicWriteText;
}
interface Review {
	read: CleanupReview;
	owned: Map<string, OwnedCheckoutReview>;
}

/** Owns variant commands; records own validation and persistence, screenshots own publication. */
export class Comparisons {
	readonly #records: ComparisonRecords;
	readonly #jobs = new Map<string, Promise<void>>();
	readonly #accepting = new Map<string, Promise<void>>();
	readonly #reviews = new Map<string, Review>();
	readonly screenshots: VariantScreenshots;
	#closed = false;

	constructor(private readonly env: ComparisonEnv) {
		this.#records = new ComparisonRecords(env.dir, env.port, env.changed, env.write);
		this.screenshots = new VariantScreenshots({ dir: env.dir, entry: id => this.#entry(id), change: (entry, change) => this.#change(entry, change), cwd: id => env.sessions.get(id)?.cwd });
	}

	#cleanupRead(entry: ComparisonEntry): CleanupRead {
		const s = entry.value.snapshot;
		if (s.winner === null) return { kind: "not-selected" };
		const stopping = s.variants.filter(v => v.id !== s.winner && !isVariantStopped(v.lifecycle));
		if (stopping.length) return { kind: "stopping", variants: stopping.map(v => v.id) };
		const review = this.#reviews.get(s.id);
		return review ? { kind: "ready", review: review.read } : { kind: "stopping", variants: [] };
	}

	get list(): ComparisonSnapshot[] {
		const { entries, errors } = this.#records;
		const list: ComparisonSnapshot[] = [...entries.values()].map(entry => {
			const holder = entry.lock.holder();
			const problem = errors.get(entry.value.snapshot.id);
			const owner: ComparisonSnapshot["owner"] = problem ? { kind: "unavailable", reason: problem }
				: entry.lock.held && holder?.pid === process.pid && holder.port === this.env.port ? { kind: "local" }
				: holder ? { kind: "other", port: holder.port }
				: { kind: "unavailable", reason: "This comparison has no connected owner. Restart this server to recover it." };
			const { spec } = entry.value;
			const variants = entry.value.snapshot.variants.map((v, index) => {
				const row = spec.variants[index]!;
				return { ...v, selection: { model: row.model ?? spec.model, thinking: row.thinking ?? spec.thinking } };
			});
			return { ...entry.value.snapshot, variants, owner, cleanup: this.#cleanupRead(entry) };
		});
		for (const [id, error] of errors) {
			if (entries.has(id)) continue;
			list.push({ id, createdAt: 0, prompt: "Unreadable comparison", sourceCwd: "", repository: "", base: "", baseSha: "", owner: { kind: "unavailable", reason: error }, variants: [], winner: null, cleanup: { kind: "not-selected" } });
		}
		return list.sort((a, b) => b.createdAt - a.createdAt);
	}

	async refresh(): Promise<void> {
		this.#records.load();
		this.env.changed();
	}
	#entry(id: string): ComparisonEntry {
		const problem = this.#records.errors.get(id);
		if (problem) throw new Error(problem);
		const entry = this.#records.entries.get(id);
		if (!entry) throw new Error("This comparison does not exist.");
		if (this.#closed || !entry.lock.held || !entry.lock.acquire()) throw new Error(`This comparison is owned by the server on port ${entry.lock.holder()?.port ?? "unknown"}.`);
		return entry;
	}
	#change(entry: ComparisonEntry, change: (draft: ComparisonRecord) => void | Promise<void>): Promise<void> {
		if (this.#closed) return Promise.reject(new Error("Comparisons are stopping."));
		return this.#records.change(entry, change);
	}
	async #command(id: string, operation: () => Promise<void>): Promise<void> {
		return this.#entry(id).actions.run(operation);
	}

	async recover(): Promise<void> {
		for (const entry of this.#records.entries.values()) {
			if (!entry.lock.acquire()) continue;
			try {
				const id = entry.value.snapshot.id;
				const loaded = parseComparisonRecord(JSON.parse(readFileSync(this.#records.file(id), "utf8")), id);
				if (!loaded) throw new Error("The comparison changed to an unreadable manifest before ownership was acquired.");
				entry.value = loaded;
				await this.#records.save(loaded);
				await this.#change(entry, draft => {
					for (const v of draft.snapshot.variants) {
						if (v.lifecycle.kind === "prompt-attempted") v.lifecycle = { kind: "uncertain", reason: "The server stopped during first-prompt admission. Inspect the session before sending anything again." };
						else if (v.lifecycle.kind === "queued") v.lifecycle = draft.snapshot.winner ? { kind: "cancelled" } : { kind: "failed", error: "The server stopped before this variant launched. It was not restarted." };
						else if (v.lifecycle.kind === "starting") v.lifecycle = { kind: "failed", error: "The server stopped during launch. A surviving reserved keeper will be reattached, never relaunched." };
					}
				});
			} catch (error) {
				this.#records.errors.set(entry.value.snapshot.id, errorText(error));
				entry.lock.release();
			}
		}
	}

	/** Claims survive a damaged manifest and never prevent an unrelated keeper from attaching. */
	async mayAttach(instanceId: string): Promise<boolean> {
		const claims = this.#records.claims.get(instanceId);
		if (claims) {
			if (claims.size !== 1) return false;
			const id = [...claims][0]!;
			const entry = this.#records.entries.get(id);
			return !!entry && !this.#records.errors.has(id) && entry.lock.held && entry.lock.acquire();
		}
		if (!this.#records.errors.size) return true;
		// Old keepers expose launch metadata in their process arguments, before a connection can take ownership.
		const cwd = await keptSessionCwd(instanceId);
		if (cwd === null) return false;
		return ![...this.#records.errors.keys()].some(id => cwd.split("/").some(part => new RegExp(`-variants-${id}-[1-9][0-9]*-[a-f0-9]{8}$`).test(part)));
	}

	/** Adds the bound tool and durable membership through the same join used by projects and reviews. */
	async join(request: StartRequest, join: ProjectJoin, instanceId: string): Promise<ProjectJoin> {
		for (const entry of this.#records.entries.values()) {
			const member = entry.value.snapshot.variants.find(v => request.kind === "resume"
				? v.sessionIds.includes(request.sessionId) || entry.value.instances[instanceId] === v.id
				: request.kind === "new" && v.instanceId === instanceId && v.cwd === request.cwd);
			if (!member) continue;
			const id = entry.value.snapshot.id;
			this.#entry(id);
			if (entry.value.snapshot.winner !== null && entry.value.snapshot.winner !== member.id && entry.value.instances[instanceId] !== member.id) throw new Error("This losing variant was stopped by Keep. It cannot be continued during cleanup.");
			await this.#records.claim(id, instanceId);
			await this.#change(entry, draft => { draft.instances[instanceId] = member.id; });
			return {
				rpc: { ...join.rpc, tools: [...join.rpc.tools, this.screenshots.tool(id, member.id, instanceId)] },
				attach: async session => {
					await join.attach(session);
					await this.#change(entry, draft => {
						const v = draft.snapshot.variants.find(v => v.id === member.id)!;
						const live = this.env.sessions.get(session.instanceId);
						if (!live) throw new Error("The comparison session is not registered.");
						this.#remember(v, live);
						if (request.kind !== "resume" || v.lifecycle.kind === "failed") v.lifecycle = { kind: "registered" };
						else if (isVariantStopped(v.lifecycle)) v.lifecycle = { kind: "running" };
					});
				},
			};
		}
		return join;
	}

	#remember(v: VariantRecord, session: LiveSession): void {
		v.instanceId = session.instanceId;
		v.sessionId = session.sessionId;
		if (!v.sessionIds.includes(session.sessionId)) v.sessionIds.push(session.sessionId);
		const row = session.row();
		if (row.model !== null) v.model = modelOfSelector(row.model);
		v.thinkingLevel = row.thinkingLevel;
	}
	async switched(instanceId: string): Promise<void> {
		const session = this.env.sessions.get(instanceId);
		if (!session) return;
		for (const entry of this.#records.entries.values()) {
			if (!entry.lock.held || !entry.value.instances[instanceId]) continue;
			await this.#change(entry, draft => { this.#remember(draft.snapshot.variants.find(v => v.id === draft.instances[instanceId])!, session); });
		}
	}
	async exited(session: LiveSession): Promise<void> {
		const row = session.row();
		for (const entry of this.#records.entries.values()) {
			if (!entry.lock.held || !entry.value.instances[session.instanceId]) continue;
			await this.#change(entry, draft => {
				const v = draft.snapshot.variants.find(v => v.id === draft.instances[session.instanceId])!;
				if (!v.sessionIds.includes(session.sessionId)) v.sessionIds.push(session.sessionId);
				if (v.instanceId !== session.instanceId) return;
				v.sessionId = session.sessionId;
				if (row.model !== null) v.model = modelOfSelector(row.model);
				v.thinkingLevel = row.thinkingLevel;
				if (!isVariantStopped(v.lifecycle)) v.lifecycle = { kind: "stopped" };
			});
		}
	}
	async attached(): Promise<void> {
		for (const entry of this.#records.entries.values()) if (entry.lock.held && entry.value.snapshot.winner) await this.#stopLosers(entry);
	}

	async start(id: string, spec: ComparisonSpec): Promise<void> {
		const pending = this.#accepting.get(id);
		if (pending) {
			await pending;
			return this.start(id, spec);
		}
		const accepted = this.#accept(id, spec);
		this.#accepting.set(id, accepted);
		try { await accepted; }
		finally { this.#accepting.delete(id); }
	}
	async #accept(id: string, spec: ComparisonSpec): Promise<void> {
		const parsed = parseComparisonSpec(spec);
		if (this.#closed || !isComparisonId(id) || !parsed) throw new Error("Invalid comparison request or the server is stopping.");
		spec = parsed.ok;
		if (this.#records.entries.has(id)) {
			if (JSON.stringify(this.#entry(id).value.spec) !== JSON.stringify(spec)) throw new Error("This comparison id already belongs to a different prompt or configuration.");
			this.env.changed();
			return;
		}
		if (this.#records.errors.has(id) || existsSync(this.#records.file(id))) throw new Error("This comparison already exists on disk. Reopen it instead of replacing it.");
		await mkdir(join(this.env.dir, id), { recursive: true, mode: 0o700 });
		const lock = new OwnerLock(join(this.env.dir, id, "owner.lock"), this.env.port);
		if (!lock.acquire()) throw new Error(`Another server owns this comparison on port ${lock.holder()?.port ?? "unknown"}.`);
		try {
			const cwd = await directoryOf(spec.cwd);
			if (!cwd) throw new Error("The source workspace does not exist.");
			const at = await worktreeAt(cwd);
			if (!at) throw new Error("Design variants require a Git workspace.");
			const repository = await canonical(at.common);
			const baseSha = (await git(cwd, "rev-parse", "--verify", "--end-of-options", `${spec.base}^{commit}`)).trim();
			if (!/^[a-f0-9]{40,64}$/.test(baseSha)) throw new Error("The base does not name a commit.");
			const main = (await worktreesOf(cwd))[0];
			if (!main) throw new Error("Git lists no source checkout.");
			const suffix = relative(await canonical(at.top), await canonical(cwd));
			const variants: VariantRecord[] = spec.variants.map((_, index) => {
				const branch = `variants/${id}/${index + 1}-${randomUUID().slice(0, 8)}`;
				const checkout = worktreeDir(main.path, branch);
				return {
					id: `v${index + 1}`, instanceId: newInstanceId(), sessionId: null, sessionIds: [],
					cwd: join(checkout, suffix), checkout, branch,
					model: null, thinkingLevel: null, lifecycle: { kind: "queued" },
					screenshot: null, screenshotError: null,
				};
			});
			const value: ComparisonRecord = {
				version: 2, spec, owned: {}, receipts: {},
				instances: Object.fromEntries(variants.map(v => [v.instanceId, v.id])),
				snapshot: { id, createdAt: Date.now(), prompt: spec.prompt, sourceCwd: cwd, repository, base: spec.base, baseSha, variants, winner: null },
			};
			await this.#records.save(value);
			const entry: ComparisonEntry = { value, lock, lane: new SerialLane(), actions: new SerialLane() };
			this.#records.entries.set(id, entry);
			this.env.changed();
			for (const v of variants) {
				const key = `${id}/${v.id}`;
				const job = this.#launch(entry, v.id).catch(error => this.#failure(entry, v.id, error)).catch(error => { console.error(`omp-agents: comparison ${key}: ${errorText(error)}`); }).finally(() => this.#jobs.delete(key));
				this.#jobs.set(key, job);
			}
		} catch (error) {
			lock.release();
			throw error;
		}
	}
	async #failure(entry: ComparisonEntry, id: string, error: unknown): Promise<void> {
		await this.#change(entry, draft => {
			const v = draft.snapshot.variants.find(v => v.id === id)!;
			if (!v.sessionId) v.lifecycle = draft.snapshot.winner !== null ? { kind: "cancelled" } : { kind: "failed", error: errorText(error) };
			else if (v.lifecycle.kind !== "running" && !isVariantStopped(v.lifecycle)) v.lifecycle = { kind: "uncertain", reason: errorText(error) };
		});
	}
	async #launch(entry: ComparisonEntry, id: string): Promise<void> {
		await this.#change(entry, draft => {
			const v = draft.snapshot.variants.find(v => v.id === id)!;
			v.lifecycle = { kind: draft.snapshot.winner !== null ? "cancelled" : "starting" };
		});
		if (entry.value.snapshot.variants.find(v => v.id === id)!.lifecycle.kind === "cancelled") return;
		await this.env.worktrees.start(async () => {
			const v = entry.value.snapshot.variants.find(v => v.id === id)!;
			await this.env.worktrees.checkout(async () => {
				if (entry.value.snapshot.winner !== null) throw new Error("Variant launch cancelled after a winner was selected.");
				await allocateVariant(entry.value.snapshot.sourceCwd, v.branch, entry.value.snapshot.baseSha, v.checkout);
				const stat = await lstat(v.checkout);
				await this.#change(entry, draft => { draft.owned[id] = { repository: draft.snapshot.repository, path: v.checkout, branch: v.branch, identity: `${stat.dev}:${stat.ino}` }; });
			});
			const prompt = `${entry.value.spec.prompt}\n\nWhen your design is ready, capture a real screenshot and call publish_variant_screenshot with the image path and a short caption. This tool publishes your latest screenshot to the design comparison. Do not substitute a placeholder image.`;
			const { spec } = entry.value;
			const selected = spec.variants[entry.value.snapshot.variants.findIndex(member => member.id === id)]!;
			const result = await this.env.start(newSessionRequest(v.cwd, prompt, { images: spec.images, model: selected.model ?? spec.model, thinking: selected.thinking ?? spec.thinking, skill: spec.skill }), null, {
				instanceId: v.instanceId,
				beforePrompt: () => this.#change(entry, draft => {
					if (draft.snapshot.winner !== null) throw new Error("First prompt cancelled after winner selection.");
					const member = draft.snapshot.variants.find(v => v.id === id)!;
					if (member.lifecycle.kind !== "registered") throw new Error("The initial prompt is not eligible for admission.");
					member.lifecycle = { kind: "prompt-attempted" };
				}),
				admitted: () => this.#change(entry, draft => {
					const member = draft.snapshot.variants.find(v => v.id === id)!;
					if (member.lifecycle.kind === "prompt-attempted") member.lifecycle = { kind: "running" };
				}),
			});
			if (!result.ok) throw new Error(result.error);
		}, false);
	}

	select(id: string, winner: string): Promise<void> { return this.#command(id, () => this.#select(id, winner)); }
	async #select(id: string, winner: string): Promise<void> {
		const entry = this.#entry(id);
		await this.#change(entry, draft => {
			const chosen = draft.snapshot.variants.find(v => v.id === winner);
			if (!chosen || chosen.sessionId === null || chosen.lifecycle.kind === "removed") throw new Error("Choose a registered variant.");
			if (draft.snapshot.winner !== null && draft.snapshot.winner !== winner) throw new Error("This comparison already has a different winner.");
			draft.snapshot.winner = winner;
			for (const v of draft.snapshot.variants) if (v.id !== winner && v.lifecycle.kind === "queued") v.lifecycle = { kind: "cancelled" };
		});
		this.#reviews.delete(id);
		await Promise.all([...this.#jobs].filter(([key]) => key.startsWith(`${id}/`)).map(([, job]) => job));
		await this.#stopLosers(entry);
	}
	async #stopLosers(entry: ComparisonEntry): Promise<void> {
		for (const member of entry.value.snapshot.variants) {
			if (member.id === entry.value.snapshot.winner || isVariantStopped(member.lifecycle)) continue;
			await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === member.id)!.lifecycle = { kind: "stopping" }; });
			try {
				const instances = Object.entries(entry.value.instances).filter(([, variant]) => variant === member.id).map(([id]) => id);
				const sessions = new Set([...instances.map(id => this.env.sessions.get(id)), ...member.sessionIds.map(id => this.env.sessions.bySessionId(id))]);
				for (const sessionId of member.sessionIds) this.env.cancelContinue(sessionId);
				for (const session of sessions) if (session) {
					if (entry.value.snapshot.variants.some(v => v.id === entry.value.snapshot.winner && (v.instanceId === session.instanceId || v.sessionIds.includes(session.sessionId)))) throw new Error("A losing continuation shares the winner's session. Stop it manually.");
					await this.#change(entry, draft => { this.#remember(draft.snapshot.variants.find(v => v.id === member.id)!, session); });
					await session.end();
					const until = Date.now() + 5000;
					while (!session.finished(Date.now()) && Date.now() < until) await Bun.sleep(50);
					if (!session.finished(Date.now())) throw new Error("The session did not confirm that it stopped.");
					this.env.sessions.remove(session.instanceId);
				}
				const until = Date.now() + 1000;
				while (instances.some(id => keptSessions().includes(id)) && Date.now() < until) await Bun.sleep(50);
				if (instances.some(id => keptSessions().includes(id))) throw new Error("A comparison keeper may still be running. Its stop could not be verified.");
				await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === member.id)!.lifecycle = { kind: "stopped" }; });
			} catch (error) {
				await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === member.id)!.lifecycle = { kind: "stop-blocked", reason: errorText(error) }; });
			}
		}
	}

	reviewCleanup(id: string): Promise<void> { return this.#command(id, () => this.#reviewCleanup(id)); }
	async #reviewCleanup(id: string): Promise<void> {
		const entry = this.#entry(id);
		const s = entry.value.snapshot;
		if (s.winner === null || s.variants.some(v => v.id !== s.winner && !isVariantStopped(v.lifecycle))) return;
		const reviews = new Map<string, OwnedCheckoutReview>();
		const rows: CleanupRow[] = [];
		for (const v of s.variants.filter(v => v.id !== s.winner)) {
			const owned = entry.value.owned[v.id];
			if (!owned || v.lifecycle.kind === "removed") {
				const present = existsSync(v.checkout);
				rows.push({ variantId: v.id, path: v.checkout, branch: v.branch, tracked: [], untracked: [], ignored: [], blockers: present ? [{ code: "foreign", message: "This path has no recorded comparison ownership. It will not be removed." }] : [], removed: !present });
				continue;
			}
			const registered = (await worktreesOf(owned.repository)).some(row => row.path === owned.path);
			if (!registered && !existsSync(owned.path)) {
				rows.push({ variantId: v.id, path: v.checkout, branch: v.branch, tracked: [], untracked: [], ignored: [], blockers: [], removed: true });
				continue;
			}
			const review = await this.env.worktrees.reviewOwned(owned);
			reviews.set(v.id, review);
			rows.push({ variantId: v.id, path: v.checkout, branch: v.branch, tracked: review.tracked, untracked: review.untracked, ignored: review.ignored, blockers: review.plan.blockers, removed: false });
		}
		await this.#change(entry, draft => {
			for (const row of rows) if (row.removed) draft.snapshot.variants.find(v => v.id === row.variantId)!.lifecycle = { kind: "removed" };
		});
		this.#reviews.set(id, { read: { id: randomUUID(), createdAt: Date.now(), rows }, owned: reviews });
		this.env.changed();
	}
	cleanup(id: string, reviewId: string, policy: CleanupPolicy): Promise<void> { return this.#command(id, () => this.#cleanup(id, reviewId, policy)); }
	async #cleanup(id: string, reviewId: string, policy: CleanupPolicy): Promise<void> {
		const entry = this.#entry(id);
		const review = this.#reviews.get(id);
		if (!review || review.read.id !== reviewId || this.#cleanupRead(entry).kind !== "ready") throw new Error("This cleanup review expired. Review the final checkout loss again.");
		if (policy !== "preserve-changes" && policy !== "discard-owned-changes") throw new Error("Choose whether to preserve or discard owned changes.");
		this.#reviews.delete(id);
		for (const [variantId, loss] of review.owned) {
			const member = entry.value.snapshot.variants.find(v => v.id === variantId)!;
			if (member.id === entry.value.snapshot.winner || !isVariantStopped(member.lifecycle)) throw new Error("Only verified stopped losing variants may be cleaned up.");
			if (policy === "preserve-changes") {
				await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === variantId)!.lifecycle = { kind: "preserved" }; });
				continue;
			}
			this.#entry(id);
			const instances = Object.entries(entry.value.instances).filter(([, variant]) => variant === variantId).map(([instance]) => instance);
			const live = [...instances.map(instance => this.env.sessions.get(instance)), ...member.sessionIds.map(session => this.env.sessions.bySessionId(session))].some(session => session && !session.finished(Date.now()));
			if (live || instances.some(instance => keptSessions().includes(instance))) {
				await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === variantId)!.lifecycle = { kind: "stop-blocked", reason: "A losing session or keeper is running again. Stop verification must be repeated before removal." }; });
				continue;
			}
			const result = await this.env.worktrees.removeOwned(loss, policy);
			await this.#change(entry, draft => {
				draft.snapshot.variants.find(v => v.id === variantId)!.lifecycle = result.removed ? { kind: "removed" } : { kind: "cleanup-blocked", reasons: [...result.blockers.map(b => b.message), ...(result.error ? [result.error] : [])] };
			});
		}
		await this.#reviewCleanup(id);
	}
	async stop(): Promise<void> {
		await Promise.allSettled([...this.#accepting.values()]);
		await Promise.all([...this.#records.entries.values()].map(entry => entry.actions.idle()));
		await Promise.allSettled([...this.#jobs.values()]);
		await Promise.all([...this.#records.entries.values()].map(entry => entry.lane.idle()));
		this.#closed = true;
		this.#reviews.clear();
	}
	release(): void { for (const entry of this.#records.entries.values()) entry.lock.release(); }
}
