/**
 * Design comparisons: one prompt started as an ordinary dashboard session per variant, each on a fresh branch and worktree
 * from one commit, with the screenshot each publishes, the winner **Keep this one** chose, and the cleanup of the others.
 * This class is the only writer of a comparison's record, and each comparison has its own owner lock.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { newInstanceId, type DashboardSession } from "../dashboard-session";
import { atomicWriteText } from "../fs";
import { allocateVariant, canonical, git, worktreeAt, worktreesOf } from "../git";
import { errorText, isObject } from "../json";
import type { RpcHostTool } from "../omp/modules";
import { keptSessions } from "../omp/rpc";
import { directoryOf, keepersDir } from "../paths";
import { type CleanupPolicy, type CleanupRow, type ComparisonSnapshot, type ComparisonSpec, type ComparisonVariant, isComparisonId, parseComparisonSpec } from "../shared/comparisons";
import { worktreeDir } from "../shared/git";
import { newSessionRequest, type StartRequest } from "../shared/sessions";
import { mediaUrl } from "../shared/transcript";
import { rasterExtension } from "../variant-image";
import type { OwnedCheckout, OwnedCheckoutReview, Worktrees } from "../worktrees";
import type { LiveSessions } from "./live-sessions";
import { OwnerLock } from "./owner-lock";
import type { Starter } from "./start";

interface Manifest {
	version: 1;
	spec: ComparisonSpec;
	snapshot: ComparisonSnapshot;
	keeperDirectory: string;
	owned: Record<string, OwnedCheckout>;
	instances: Record<string, { variant: string; directory: string }>;
	receipts: Record<string, NonNullable<ComparisonVariant["screenshot"]>>;
	cleanupIntent: { reviewId: string; policy: CleanupPolicy; variants: string[] } | null;
}
interface Entry { value: Manifest; lock: OwnerLock; lane: Promise<unknown> }
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

const states = (value: unknown, kinds: string[]): boolean => isObject(value) && typeof value.kind === "string" && kinds.includes(value.kind);
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const screenshot = (value: unknown): boolean => isObject(value) && typeof value.src === "string" && typeof value.caption === "string" && typeof value.sequence === "number" && Number.isSafeInteger(value.sequence) && value.sequence > 0 && typeof value.publishedAt === "number" && Number.isFinite(value.publishedAt);
function parseManifest(value: unknown, id: string): Manifest | null {
	if (!isObject(value) || value.version !== 1 || typeof value.keeperDirectory !== "string" || !isObject(value.snapshot) || !isObject(value.owned) || !isObject(value.receipts) || !isObject(value.instances)) return null;
	const spec = parseComparisonSpec(value.spec);
	const s = value.snapshot;
	if (!spec || s.id !== id || typeof s.createdAt !== "number" || typeof s.prompt !== "string" || typeof s.sourceCwd !== "string" || typeof s.repository !== "string" || typeof s.base !== "string" || typeof s.baseSha !== "string" || !/^[a-f0-9]{40,64}$/.test(s.baseSha) || !Array.isArray(s.variants) || s.variants.length !== spec.ok.variants.length || !states(s.cleanup, ["not-selected", "stopping", "ready"]) || (s.winner !== null && typeof s.winner !== "string")) return null;
	if (s.error !== null && typeof s.error !== "string") return null;
	if (!isObject(s.cleanup)) return null;
	if (s.cleanup.kind === "stopping" && !texts(s.cleanup.variants)) return null;
	if (s.cleanup.kind === "ready") {
		const review = s.cleanup.review;
		if (!isObject(review) || typeof review.id !== "string" || typeof review.createdAt !== "number" || !Array.isArray(review.rows)) return null;
		for (const row of review.rows) if (!isObject(row) || typeof row.variantId !== "string" || typeof row.path !== "string" || typeof row.branch !== "string" || !texts(row.tracked) || !texts(row.untracked) || !texts(row.ignored) || typeof row.removed !== "boolean" || !Array.isArray(row.blockers) || !row.blockers.every(blocker => isObject(blocker) && typeof blocker.code === "string" && typeof blocker.message === "string")) return null;
	}
	const ids = new Set<string>();
	for (const v of s.variants) {
		if (!isObject(v) || typeof v.id !== "string" || ids.has(v.id) || !Number.isSafeInteger(v.ordinal) || typeof v.instanceId !== "string" || (v.sessionId !== null && typeof v.sessionId !== "string") || !Array.isArray(v.sessionIds) || !v.sessionIds.every(id => typeof id === "string") || typeof v.cwd !== "string" || typeof v.checkout !== "string" || typeof v.branch !== "string" || !states(v.start, ["queued", "starting", "registered", "failed", "cancelled"]) || !states(v.firstPrompt, ["not-attempted", "attempted", "admitted", "uncertain"]) || !states(v.stop, ["not-requested", "stopping", "stopped", "blocked"]) || !states(v.cleanup, ["pending", "preserved", "removed", "blocked"])) return null;
		if (v.ordinal !== ids.size + 1 || (v.model !== null && (!isObject(v.model) || typeof v.model.provider !== "string" || typeof v.model.id !== "string")) || (v.thinking !== null && typeof v.thinking !== "string") || (v.screenshotError !== null && typeof v.screenshotError !== "string")) return null;
		if (isObject(v.start) && v.start.kind === "failed" && typeof v.start.error !== "string") return null;
		if (isObject(v.firstPrompt) && v.firstPrompt.kind === "uncertain" && typeof v.firstPrompt.reason !== "string") return null;
		if (isObject(v.stop) && v.stop.kind === "blocked" && typeof v.stop.reason !== "string") return null;
		if (isObject(v.cleanup) && v.cleanup.kind === "blocked" && !texts(v.cleanup.reasons)) return null;
		if (v.screenshot !== null && !screenshot(v.screenshot)) return null;
		const instance = value.instances[v.instanceId];
		if (!isObject(instance) || instance.variant !== v.id) return null;
		const owned = value.owned[v.id];
		if (owned !== undefined && (!isObject(owned) || owned.path !== v.checkout || owned.repository !== s.repository || owned.branch !== v.branch || typeof owned.identity !== "string")) return null;
		ids.add(v.id);
	}
	if (s.winner !== null && !ids.has(s.winner)) return null;
	for (const instance of Object.values(value.instances)) if (!isObject(instance) || typeof instance.variant !== "string" || !ids.has(instance.variant) || typeof instance.directory !== "string") return null;
	for (const receipt of Object.values(value.receipts)) if (!screenshot(receipt)) return null;
	return { version: 1, spec: spec.ok, snapshot: s as unknown as ComparisonSnapshot, keeperDirectory: value.keeperDirectory, owned: value.owned as Record<string, OwnedCheckout>, instances: value.instances as Manifest["instances"], receipts: value.receipts as Manifest["receipts"], cleanupIntent: null };
}

export class Comparisons {
	readonly #entries = new Map<string, Entry>();
	readonly #errors = new Map<string, string>();
	readonly #jobs = new Map<string, Promise<void>>();
	readonly #accepting = new Map<string, Promise<void>>();
	readonly #actions = new Map<string, Promise<unknown>>();
	readonly #reviews = new Map<string, Map<string, OwnedCheckoutReview>>();
	#closed = false;
	constructor(private readonly env: ComparisonEnv) { this.#load(); }

	#file(id: string): string { return join(this.env.dir, id, "comparison.json"); }
	#load(): void {
		if (!existsSync(this.env.dir)) return;
		for (const id of readdirSync(this.env.dir)) {
			if (!isComparisonId(id)) continue;
			try {
				const parsed = parseManifest(JSON.parse(readFileSync(this.#file(id), "utf8")), id);
				if (!parsed) throw new Error("The comparison manifest is invalid. It will not be replaced or restarted.");
				const prior = this.#entries.get(id);
				if (!prior || !prior.lock.held) this.#entries.set(id, { value: parsed, lock: prior?.lock ?? new OwnerLock(join(this.env.dir, id, "owner.lock"), this.env.port), lane: Promise.resolve() });
				this.#errors.delete(id);
			} catch (error) { this.#errors.set(id, errorText(error)); }
		}
	}

	get list(): ComparisonSnapshot[] {
		const list = [...this.#entries.values()].map(entry => {
			const holder = entry.lock.holder();
			const problem = this.#errors.get(entry.value.snapshot.id);
			const owner: ComparisonSnapshot["owner"] = problem ? { kind: "unavailable", reason: problem } : entry.lock.held && holder?.pid === process.pid && holder.port === this.env.port ? { kind: "local" } : holder ? { kind: "other", port: holder.port } : { kind: "unavailable", reason: "This comparison has no connected owner. Restart this server to recover it." };
			return { ...entry.value.snapshot, owner };
		});
		for (const [id, error] of this.#errors) if (!this.#entries.has(id)) list.push({ id, createdAt: 0, prompt: "Unreadable comparison", sourceCwd: "", repository: "", base: "", baseSha: "", owner: { kind: "unavailable", reason: error }, variants: [], winner: null, cleanup: { kind: "not-selected" }, error });
		return list.sort((a, b) => b.createdAt - a.createdAt);
	}

	async refresh(): Promise<void> { this.#load(); this.env.changed(); }
	#entry(id: string): Entry {
		const entry = this.#entries.get(id);
		const problem = this.#errors.get(id);
		if (problem) throw new Error(problem);
		if (!entry) throw new Error(this.#errors.get(id) ?? "This comparison does not exist.");
		if (this.#closed || !entry.lock.held || !entry.lock.acquire()) throw new Error(`This comparison is owned by the server on port ${entry.lock.holder()?.port ?? "unknown"}.`);
		return entry;
	}
	async #change(entry: Entry, change: (draft: Manifest) => void | Promise<void>): Promise<void> {
		const next = entry.lane.then(async () => {
			if (this.#closed || !entry.lock.acquire()) throw new Error("Comparison ownership was lost.");
			const draft = structuredClone(entry.value);
			await change(draft);
			await (this.env.write ?? atomicWriteText)(this.#file(draft.snapshot.id), JSON.stringify(draft), 0o600);
			entry.value = draft;
			this.env.changed();
		});
		entry.lane = next.catch(() => {});
		return next;
	}

	#command(id: string, operation: () => Promise<void>): Promise<void> {
		const next = (this.#actions.get(id) ?? Promise.resolve()).then(operation);
		this.#actions.set(id, next.catch(() => {}));
		return next;
	}

	/** Takes the comparisons no live server owns, and marks what the last server left halfway: an uncertain first prompt, a start that will not run again, a review to read again. */
	async recover(): Promise<void> {
		for (const entry of this.#entries.values()) {
			if (!entry.lock.acquire()) continue;
			try {
				const loaded = parseManifest(JSON.parse(readFileSync(this.#file(entry.value.snapshot.id), "utf8")), entry.value.snapshot.id);
				if (!loaded) throw new Error("The comparison changed to an unreadable manifest before ownership was acquired.");
				entry.value = loaded;
				await this.#change(entry, draft => {
					draft.cleanupIntent = null;
					draft.snapshot.cleanup = draft.snapshot.winner === null ? { kind: "not-selected" } : { kind: "stopping", variants: draft.snapshot.variants.filter(v => v.id !== draft.snapshot.winner && v.stop.kind !== "stopped").map(v => v.id) };
					for (const v of draft.snapshot.variants) {
						if (v.firstPrompt.kind === "attempted") v.firstPrompt = { kind: "uncertain", reason: "The server stopped during first-prompt admission. Inspect the session before sending anything again." };
						if (v.start.kind === "queued") v.start = draft.snapshot.winner ? { kind: "cancelled" } : { kind: "failed", error: "The server stopped before this variant launched. It was not restarted." };
						if (v.start.kind === "starting") v.start = { kind: "failed", error: "The server stopped during launch. A surviving reserved keeper will be reattached, never relaunched." };
					}
				});
			} catch (error) {
				this.#errors.set(entry.value.snapshot.id, errorText(error));
				entry.lock.release();
			}
		}
	}
	/** Whether this server may attach to kept session `instanceId` at startup: a variant only while this server owns its comparison. */
	mayAttach(instanceId: string): boolean {
		for (const entry of this.#entries.values()) if (entry.value.instances[instanceId]) return entry.lock.held;
		return this.#errors.size === 0;
	}
	keeperDirectory(instanceId: string): string | undefined {
		for (const entry of this.#entries.values()) if (entry.value.instances[instanceId]) return entry.value.instances[instanceId]!.directory;
		return undefined;
	}
	instances(): string[] { return [...this.#entries.values()].filter(entry => entry.lock.held).flatMap(entry => Object.entries(entry.value.instances).filter(([id, instance]) => keptSessions(instance.directory).includes(id)).map(([id]) => id)); }
	tools(instanceId: string): RpcHostTool[] {
		for (const entry of this.#entries.values()) {
			const member = entry.value.instances[instanceId];
			if (member && entry.lock.held) return [this.#tool(entry.value.snapshot.id, member.variant, instanceId)];
		}
		return [];
	}
	/** After the keepers are reattached: notes which variants came back live, and finishes stopping the losers of a winner already chosen. */
	async attached(): Promise<void> {
		for (const entry of this.#entries.values()) if (entry.lock.held) {
			await this.#change(entry, draft => {
				for (const v of draft.snapshot.variants) {
					const session = this.env.sessions.get(v.instanceId);
					if (session) { v.start = { kind: "registered" }; v.sessionId = session.sessionId; if (!v.sessionIds.includes(session.sessionId)) v.sessionIds.push(session.sessionId); }
				}
			});
			if (entry.value.snapshot.winner) await this.#stopLosers(entry);
		}
	}

	/** The screenshot tool a resumed variant gets again; refuses to resume a loser once a winner is chosen. */
	prepare(request: StartRequest, instanceId: string): RpcHostTool[] {
		if (request.kind !== "resume") return [];
		for (const entry of this.#entries.values()) {
			const v = entry.value.snapshot.variants.find(v => v.sessionIds.includes(request.sessionId));
			if (!v) continue;
			this.#entry(entry.value.snapshot.id);
			if (entry.value.snapshot.winner !== null && entry.value.snapshot.winner !== v.id) throw new Error("This losing variant was stopped by Keep. It cannot be continued during cleanup.");
			return [this.#tool(entry.value.snapshot.id, v.id, instanceId)];
		}
		return [];
	}

	async registered(session: Pick<DashboardSession, "instanceId" | "sessionId">): Promise<void> {
		for (const entry of this.#entries.values()) {
			const v = entry.value.snapshot.variants.find(v => v.sessionIds.includes(session.sessionId));
			if (!v || entry.value.instances[session.instanceId]) continue;
			this.#entry(entry.value.snapshot.id);
			await this.#change(entry, draft => {
				draft.instances[session.instanceId] = { variant: v.id, directory: keepersDir };
				const member = draft.snapshot.variants.find(member => member.id === v.id)!;
				member.instanceId = session.instanceId;
				member.sessionId = session.sessionId;
			});
		}
	}

	/** Accepts comparison `id` once, writing its whole plan before any variant starts; resolves on acceptance, not when the variants run. The same `id` again finds it. */
	async start(id: string, spec: ComparisonSpec): Promise<void> {
		const pending = this.#accepting.get(id);
		if (pending) { await pending; return this.start(id, spec); }
		const accepted = this.#accept(id, spec);
		this.#accepting.set(id, accepted);
		try { await accepted; }
		finally { this.#accepting.delete(id); }
	}

	async #accept(id: string, spec: ComparisonSpec): Promise<void> {
		const parsed = parseComparisonSpec(spec);
		if (this.#closed || !isComparisonId(id) || !parsed) throw new Error("Invalid comparison request or the server is stopping.");
		spec = parsed.ok;
		if (this.#entries.has(id)) {
			const entry = this.#entry(id);
			if (JSON.stringify(entry.value.spec) !== JSON.stringify(spec)) throw new Error("This comparison id already belongs to a different prompt or configuration.");
			this.env.changed();
			return;
		}
		if (this.#errors.has(id) || existsSync(this.#file(id))) throw new Error("This comparison already exists on disk. Reopen it instead of replacing it.");
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
			const variants: ComparisonVariant[] = spec.variants.map((row, index) => {
				const branch = `variants/${id}/${index + 1}-${randomUUID().slice(0, 8)}`;
				const checkout = worktreeDir(main.path, branch);
				return { id: `v${index + 1}`, ordinal: index + 1, instanceId: newInstanceId(), sessionId: null, sessionIds: [], cwd: join(checkout, suffix), checkout, branch, model: row.model ?? spec.model, thinking: row.thinking ?? spec.thinking, start: { kind: "queued" }, firstPrompt: { kind: "not-attempted" }, stop: { kind: "not-requested" }, cleanup: { kind: "pending" }, screenshot: null, screenshotError: null };
			});
			const value: Manifest = { version: 1, spec, keeperDirectory: keepersDir, owned: {}, instances: Object.fromEntries(variants.map(v => [v.instanceId, { variant: v.id, directory: keepersDir }])), receipts: {}, cleanupIntent: null, snapshot: { id, createdAt: Date.now(), prompt: spec.prompt, sourceCwd: cwd, repository, base: spec.base, baseSha, owner: { kind: "local" }, variants, winner: null, cleanup: { kind: "not-selected" }, error: null } };
			await (this.env.write ?? atomicWriteText)(this.#file(id), JSON.stringify(value), 0o600);
			const entry: Entry = { value, lock, lane: Promise.resolve() };
			this.#entries.set(id, entry);
			this.env.changed();
			for (const v of variants) {
				const key = `${id}/${v.id}`;
				const job = this.#launch(entry, v.id).catch(error => this.#failure(entry, v.id, error)).catch(error => { console.error(`omp-agents: comparison ${id}/${v.id}: ${errorText(error)}`); }).finally(() => this.#jobs.delete(key));
				this.#jobs.set(key, job);
			}
		} catch (error) { lock.release(); throw error; }
	}

	async #failure(entry: Entry, id: string, error: unknown): Promise<void> {
		await this.#change(entry, draft => {
			const v = draft.snapshot.variants.find(v => v.id === id)!;
			if (!v.sessionId) v.start = draft.snapshot.winner !== null ? { kind: "cancelled" } : { kind: "failed", error: errorText(error) };
			else if (v.firstPrompt.kind !== "admitted") v.firstPrompt = { kind: "uncertain", reason: errorText(error) };
		});
	}
	async #launch(entry: Entry, id: string): Promise<void> {
		await this.#change(entry, draft => {
			const v = draft.snapshot.variants.find(v => v.id === id)!;
			v.start = draft.snapshot.winner !== null ? { kind: "cancelled" } : { kind: "starting" };
		});
		if (entry.value.snapshot.variants.find(v => v.id === id)!.start.kind === "cancelled") return;
		await this.env.worktrees.start(async () => {
			const v = entry.value.snapshot.variants.find(v => v.id === id)!;
			await this.env.worktrees.checkout(async () => {
				if (entry.value.snapshot.winner !== null) throw new Error("Variant launch cancelled after a winner was selected.");
				await allocateVariant(entry.value.snapshot.sourceCwd, v.branch, entry.value.snapshot.baseSha, v.checkout);
				const stat = await lstat(v.checkout);
				await this.#change(entry, draft => { draft.owned[id] = { repository: draft.snapshot.repository, path: v.checkout, branch: v.branch, identity: `${stat.dev}:${stat.ino}` }; });
			});
			const prompt = `${entry.value.spec.prompt}\n\nWhen your design is ready, capture a real screenshot and call publish_variant_screenshot with the image path and a short caption. This tool publishes your latest screenshot to the design comparison. Do not substitute a placeholder image.`;
			const result = await this.env.start(newSessionRequest(v.cwd, prompt, { images: entry.value.spec.images, model: v.model, thinking: v.thinking, skill: entry.value.spec.skill }), null, {
				instanceId: v.instanceId,
				rpc: { args: [], tools: [this.#tool(entry.value.snapshot.id, id, v.instanceId)] },
				registered: session => this.#change(entry, draft => { const member = draft.snapshot.variants.find(v => v.id === id)!; member.start = { kind: "registered" }; member.sessionId = session.sessionId; member.sessionIds.push(session.sessionId); }),
				beforePrompt: () => this.#change(entry, draft => { if (draft.snapshot.winner !== null) throw new Error("First prompt cancelled after winner selection."); draft.snapshot.variants.find(v => v.id === id)!.firstPrompt = { kind: "attempted" }; }),
				admitted: () => this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === id)!.firstPrompt = { kind: "admitted" }; }),
			});
			if (!result.ok) throw new Error(result.error);
		}, false);
	}

	#tool(comparison: string, variant: string, instanceId?: string): RpcHostTool {
		return { name: "publish_variant_screenshot", label: "Publish variant screenshot", description: "Publish a real screenshot for this design variant. Capture the UI first, then pass the local PNG, JPEG, GIF, or WebP file path. A new publication replaces your previous screenshot in the comparison.", loadMode: "essential", parameters: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, caption: { type: "string" } }, required: ["path", "caption"] }, execute: async (params, context) => {
			if (typeof params.path !== "string" || typeof params.caption !== "string" || params.caption.length > 2000) throw new Error("A screenshot path and caption are required.");
			return JSON.stringify(await this.publish(comparison, variant, context.toolCallId, params.path, params.caption, instanceId));
		} };
	}
	async publish(id: string, variant: string, toolCallId: string, path: string, caption: string, instanceId?: string): Promise<NonNullable<ComparisonVariant["screenshot"]>> {
		const entry = this.#entry(id);
		let published: NonNullable<ComparisonVariant["screenshot"]> | undefined;
		try {
			await this.#change(entry, async draft => {
				const v = draft.snapshot.variants.find(v => v.id === variant);
				if (!v) throw new Error("This tool does not belong to a comparison variant.");
				const publishingInstance = instanceId ?? v.instanceId;
				if (draft.instances[publishingInstance]?.variant !== variant) throw new Error("This screenshot publisher belongs to a different session.");
				const key = JSON.stringify([publishingInstance, toolCallId]);
				if (draft.receipts[key]) { published = draft.receipts[key]; return; }
				if (v.stop.kind === "stopped" || v.cleanup.kind === "removed") throw new Error("This variant has stopped.");
				const source = resolve(this.env.sessions.get(publishingInstance)?.cwd ?? v.cwd, path);
				const stat = await lstat(source);
				if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) throw new Error("Publish a regular raster image file of at most 20 MB.");
				const bytes = await readFile(source);
				const ext = await rasterExtension(bytes);
				const media = join(this.env.dir, id, "media");
				await mkdir(media, { recursive: true, mode: 0o700 });
				const destination = join(media, `${variant}-${randomUUID()}.${ext}`);
				await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
				published = { sequence: (v.screenshot?.sequence ?? 0) + 1, src: mediaUrl(destination), caption, publishedAt: Date.now() };
				draft.receipts[key] = published;
				v.screenshot = published;
				v.screenshotError = null;
			});
		} catch (error) {
			await this.#change(entry, draft => { const v = draft.snapshot.variants.find(v => v.id === variant); if (v) v.screenshotError = errorText(error); });
			throw error;
		}
		if (!published) throw new Error("Screenshot publication did not commit.");
		return published;
	}

	observe(instanceId: string): void {
		for (const entry of this.#entries.values()) {
			if (!entry.lock.held) continue;
			const member = entry.value.snapshot.variants.find(v => v.instanceId === instanceId);
			const session = this.env.sessions.get(instanceId);
			if (!member || !session || member.sessionId === session.sessionId) continue;
			void this.#change(entry, draft => { const v = draft.snapshot.variants.find(v => v.id === member.id)!; v.sessionId = session.sessionId; if (!v.sessionIds.includes(session.sessionId)) v.sessionIds.push(session.sessionId); }).catch(error => console.error(`omp-agents: comparison membership: ${errorText(error)}`));
		}
	}
	/** **Keep this one**: fixes the winner, cancels variants not started, and stops the others without removing anything. */
	select(id: string, winner: string): Promise<void> { return this.#command(id, () => this.#select(id, winner)); }
	async #select(id: string, winner: string): Promise<void> {
		const entry = this.#entry(id);
		await this.#change(entry, draft => {
			const chosen = draft.snapshot.variants.find(v => v.id === winner);
			if (!chosen || chosen.start.kind !== "registered") throw new Error("Choose a registered variant.");
			if (draft.snapshot.winner !== null && draft.snapshot.winner !== winner) throw new Error("This comparison already has a different winner.");
			draft.snapshot.winner = winner;
			draft.snapshot.cleanup = { kind: "stopping", variants: draft.snapshot.variants.filter(v => v.id !== winner).map(v => v.id) };
			for (const v of draft.snapshot.variants) if (v.id !== winner && v.start.kind === "queued") v.start = { kind: "cancelled" };
		});
		await Promise.all([...this.#jobs].filter(([key]) => key.startsWith(`${id}/`)).map(([, job]) => job));
		await this.#stopLosers(entry);
	}
	async #stopLosers(entry: Entry): Promise<void> {
		for (const member of entry.value.snapshot.variants) {
			if (member.id === entry.value.snapshot.winner) continue;
			await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === member.id)!.stop = { kind: "stopping" }; });
			try {
				const ownedInstances = Object.entries(entry.value.instances).filter(([, instance]) => instance.variant === member.id);
				const sessions = new Set([...ownedInstances.map(([id]) => this.env.sessions.get(id)), ...member.sessionIds.map(id => this.env.sessions.bySessionId(id))]);
				for (const sessionId of member.sessionIds) this.env.cancelContinue(sessionId);
				for (const session of sessions) if (session) {
					if (entry.value.snapshot.variants.some(v => v.id === entry.value.snapshot.winner && (v.instanceId === session.instanceId || v.sessionIds.includes(session.sessionId)))) throw new Error("A losing continuation shares the winner's session. Stop it manually.");
					await session.end();
					const until = Date.now() + 5000;
					while (!session.finished(Date.now()) && Date.now() < until) await Bun.sleep(50);
					if (!session.finished(Date.now())) throw new Error("The session did not confirm that it stopped.");
					this.env.sessions.remove(session.instanceId);
				}
				const until = Date.now() + 1000;
				while (ownedInstances.some(([id, instance]) => keptSessions(instance.directory).includes(id)) && Date.now() < until) await Bun.sleep(50);
				if (ownedInstances.some(([id, instance]) => keptSessions(instance.directory).includes(id))) throw new Error("A comparison keeper may still be running. Its stop could not be verified.");
				await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === member.id)!.stop = { kind: "stopped" }; });
			} catch (error) {
				await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === member.id)!.stop = { kind: "blocked", reason: errorText(error) }; });
			}
		}
	}

	/** Lists what removing each stopped loser's worktree would lose; it reads only. */
	reviewCleanup(id: string): Promise<void> { return this.#command(id, () => this.#reviewCleanup(id)); }
	async #reviewCleanup(id: string): Promise<void> {
		const entry = this.#entry(id);
		const snapshot = entry.value.snapshot;
		if (!snapshot.winner) return;
		const losers = snapshot.variants.filter(v => v.id !== snapshot.winner);
		const stopping = losers.filter(v => v.stop.kind !== "stopped");
		if (stopping.length) { await this.#change(entry, draft => { draft.snapshot.cleanup = { kind: "stopping", variants: stopping.map(v => v.id) }; }); return; }
		const reviews = new Map<string, OwnedCheckoutReview>();
		const rows: CleanupRow[] = [];
		for (const v of losers) {
			const owned = entry.value.owned[v.id];
			if (!owned || v.cleanup.kind === "removed") {
				const present = existsSync(v.checkout);
				rows.push({ variantId: v.id, path: v.checkout, branch: v.branch, tracked: [], untracked: [], ignored: [], blockers: present ? [{ code: "foreign", message: "This path has no recorded comparison ownership. It will not be removed." }] : [], removed: !present });
				continue;
			}
			const registered = (await worktreesOf(owned.repository)).some(row => row.path === owned.path);
			if (!registered && !existsSync(owned.path)) { rows.push({ variantId: v.id, path: v.checkout, branch: v.branch, tracked: [], untracked: [], ignored: [], blockers: [], removed: true }); continue; }
			const review = await this.env.worktrees.reviewOwned(owned);
			reviews.set(v.id, review);
			rows.push({ variantId: v.id, path: v.checkout, branch: v.branch, tracked: review.tracked, untracked: review.untracked, ignored: review.ignored, blockers: review.plan.blockers, removed: false });
		}
		const reviewId = randomUUID();
		await this.#change(entry, draft => { draft.snapshot.cleanup = { kind: "ready", review: { id: reviewId, createdAt: Date.now(), rows } }; for (const row of rows) if (row.removed) draft.snapshot.variants.find(v => v.id === row.variantId)!.cleanup = { kind: "removed" }; });
		this.#reviews.set(reviewId, reviews);
	}
	/** Applies `policy` to the worktrees review `reviewId` listed, refusing a review a restart or a newer review replaced. */
	cleanup(id: string, reviewId: string, policy: CleanupPolicy): Promise<void> { return this.#command(id, () => this.#cleanup(id, reviewId, policy)); }
	async #cleanup(id: string, reviewId: string, policy: CleanupPolicy): Promise<void> {
		const entry = this.#entry(id);
		const cleanup = entry.value.snapshot.cleanup;
		const reviews = this.#reviews.get(reviewId);
		if (cleanup.kind !== "ready" || cleanup.review.id !== reviewId || !reviews) throw new Error("This cleanup review expired. Review the final checkout loss again.");
		if (policy !== "preserve-changes" && policy !== "discard-owned-changes") throw new Error("Choose whether to preserve or discard owned changes.");
		this.#reviews.delete(reviewId);
		await this.#change(entry, draft => { draft.cleanupIntent = { reviewId, policy, variants: [...reviews.keys()] }; draft.snapshot.cleanup = { kind: "stopping", variants: [] }; });
		for (const [variantId, review] of reviews) {
			const member = entry.value.snapshot.variants.find(v => v.id === variantId)!;
			if (member.id === entry.value.snapshot.winner || member.stop.kind !== "stopped") throw new Error("Only verified stopped losing variants may be cleaned up.");
			if (policy === "preserve-changes") { await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === variantId)!.cleanup = { kind: "preserved" }; }); continue; }
			this.#entry(id);
			const ownedInstances = Object.entries(entry.value.instances).filter(([, instance]) => instance.variant === variantId);
			const live = [...ownedInstances.map(([instanceId]) => this.env.sessions.get(instanceId)), ...member.sessionIds.map(sessionId => this.env.sessions.bySessionId(sessionId))].some(session => session && !session.finished(Date.now()));
			if (live || ownedInstances.some(([instanceId, instance]) => keptSessions(instance.directory).includes(instanceId))) {
				const reason = "A losing session or keeper is running again. Stop verification must be repeated before removal.";
				await this.#change(entry, draft => {
					const variant = draft.snapshot.variants.find(v => v.id === variantId)!;
					variant.stop = { kind: "blocked", reason };
					variant.cleanup = { kind: "blocked", reasons: [reason] };
				});
				continue;
			}
			const result = await this.env.worktrees.removeOwned(review, policy);
			await this.#change(entry, draft => { draft.snapshot.variants.find(v => v.id === variantId)!.cleanup = result.removed ? { kind: "removed" } : { kind: "blocked", reasons: [...result.blockers.map(b => b.message), ...(result.error ? [result.error] : [])] }; });
		}
		await this.#change(entry, draft => { draft.cleanupIntent = null; });
		await this.#reviewCleanup(id);
	}
	async stop(): Promise<void> {
		await Promise.allSettled([...this.#accepting.values()]);
		await Promise.allSettled([...this.#actions.values()]);
		await Promise.allSettled([...this.#jobs.values()]);
		await Promise.all([...this.#entries.values()].map(entry => entry.lane));
		this.#closed = true;
		this.#reviews.clear();
	}
	release(): void { for (const entry of this.#entries.values()) entry.lock.release(); }
}
