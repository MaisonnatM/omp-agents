import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteText } from "../fs";
import { arrayOf, errorText, fields, isNonEmpty, isNumber, isObject, isSafeInteger, isString, nullable, oneOf, recordOf, tagged, type Guard } from "../json";
import { SerialLane } from "../serial-lane";
import { isComparisonId, parseComparisonSpec, type CleanupRead, type CleanupReview, type CleanupRow, type ComparisonOwner, type ComparisonSnapshot, type ComparisonSpec, type ComparisonVariant, type VariantLifecycle, type VariantScreenshot } from "../shared/comparisons";
import type { ModelOption } from "../shared/models";
import type { OwnedCheckout } from "../worktrees";
import type { WorktreeBlocker } from "../worktrees-shared";
import { OwnerLock } from "./owner-lock";

export type VariantRecord = Omit<ComparisonVariant, "selection">;
export type ComparisonState = Omit<ComparisonSnapshot, "owner" | "cleanup" | "variants"> & { variants: VariantRecord[] };
export interface ComparisonRecord {
	version: 2;
	spec: ComparisonSpec;
	snapshot: ComparisonState;
	owned: Record<string, OwnedCheckout>;
	instances: Record<string, string>;
	receipts: Record<string, VariantScreenshot>;
}
export interface ComparisonEntry {
	value: ComparisonRecord;
	lock: OwnerLock;
	lane: SerialLane;
	actions: SerialLane;
}

const model = fields<ModelOption>({ provider: isNonEmpty, id: isNonEmpty });
const texts = arrayOf(isString);
const screenshot = fields<VariantScreenshot>({
	sequence: (v): v is number => isSafeInteger(v) && v > 0,
	src: isString,
	caption: isString,
	publishedAt: isNumber,
});
const lifecycle = tagged<VariantLifecycle, "kind">("kind", {
	queued: {}, starting: {}, registered: {}, "prompt-attempted": {}, running: {}, cancelled: {},
	failed: { error: isString }, uncertain: { reason: isString }, stopping: {},
	"stop-blocked": { reason: isString }, stopped: {}, preserved: {}, removed: {},
	"cleanup-blocked": { reasons: texts },
});
const variantFields = {
	id: isComparisonId, instanceId: isComparisonId, sessionId: nullable(isNonEmpty), sessionIds: arrayOf(isNonEmpty),
	cwd: isString, checkout: isString, branch: isNonEmpty, model: nullable(model),
	screenshot: nullable(screenshot), screenshotError: nullable(isString),
};
const variant = fields<VariantRecord>({ ...variantFields, thinkingLevel: nullable(isString), lifecycle });
const stateFields = {
	id: isComparisonId, createdAt: isNumber, prompt: isString, sourceCwd: isString,
	repository: isString, base: isString,
	baseSha: (v: unknown): v is string => isString(v) && /^[a-f0-9]{40,64}$/.test(v),
	winner: nullable(isComparisonId),
};
const state = fields<ComparisonState>({ ...stateFields, variants: arrayOf(variant) });
const owned = fields<OwnedCheckout>({
	repository: isString,
	path: isString,
	branch: isString,
	identity: (v): v is string => isString(v) && /^[0-9]+:[0-9]+$/.test(v),
});
const spec: Guard<ComparisonSpec> = (value): value is ComparisonSpec => parseComparisonSpec(value) !== null;
const record = fields<ComparisonRecord>({
	version: oneOf([2]),
	spec,
	snapshot: state,
	owned: recordOf(owned),
	instances: recordOf(isComparisonId),
	receipts: recordOf(screenshot),
});

type LegacyVariant = Omit<VariantRecord, "lifecycle" | "thinkingLevel"> & {
	ordinal: number;
	thinking: string | null;
	start: { kind: "queued" } | { kind: "starting" } | { kind: "registered" } | { kind: "failed"; error: string } | { kind: "cancelled" };
	firstPrompt: { kind: "not-attempted" } | { kind: "attempted" } | { kind: "admitted" } | { kind: "uncertain"; reason: string };
	stop: { kind: "not-requested" } | { kind: "stopping" } | { kind: "stopped" } | { kind: "blocked"; reason: string };
	cleanup: { kind: "pending" } | { kind: "preserved" } | { kind: "removed" } | { kind: "blocked"; reasons: string[] };
};
const legacyVariant = fields<LegacyVariant>({
	...variantFields, ordinal: isSafeInteger, thinking: nullable(isString),
	start: tagged<LegacyVariant["start"], "kind">("kind", { queued: {}, starting: {}, registered: {}, failed: { error: isString }, cancelled: {} }),
	firstPrompt: tagged<LegacyVariant["firstPrompt"], "kind">("kind", { "not-attempted": {}, attempted: {}, admitted: {}, uncertain: { reason: isString } }),
	stop: tagged<LegacyVariant["stop"], "kind">("kind", { "not-requested": {}, stopping: {}, stopped: {}, blocked: { reason: isString } }),
	cleanup: tagged<LegacyVariant["cleanup"], "kind">("kind", { pending: {}, preserved: {}, removed: {}, blocked: { reasons: texts } }),
});
interface LegacyRecord {
	version: 1;
	spec: ComparisonSpec;
	snapshot: Omit<ComparisonSnapshot, "variants"> & { variants: LegacyVariant[]; error: string | null };
	keeperDirectory: string;
	owned: Record<string, OwnedCheckout>;
	instances: Record<string, { variant: string; directory: string }>;
	receipts: Record<string, VariantScreenshot>;
}
const blocker = fields<WorktreeBlocker>({
	code: oneOf(["main", "locked", "server", "occupied", "unknown-agent-location", "unreadable", "foreign", "changed", "nested-repository", "drift", "unregistered", "unmerged"]),
	message: isString,
});
const cleanupRow = fields<CleanupRow>({
	variantId: isComparisonId, path: isString, branch: isString,
	tracked: texts, untracked: texts, ignored: texts, blockers: arrayOf(blocker),
	removed: (v): v is boolean => typeof v === "boolean",
});
const cleanupReview = fields<CleanupReview>({ id: isNonEmpty, createdAt: isNumber, rows: arrayOf(cleanupRow) });
const cleanupRead = tagged<CleanupRead, "kind">("kind", {
	"not-selected": {},
	stopping: { variants: arrayOf(isComparisonId) },
	ready: { review: cleanupReview },
});
const owner = tagged<ComparisonOwner, "kind">("kind", {
	local: {},
	other: { port: isSafeInteger },
	unavailable: { reason: isString },
});
const legacy = fields<LegacyRecord>({
	version: oneOf([1]), spec,
	snapshot: fields({ ...stateFields, variants: arrayOf(legacyVariant), owner, cleanup: cleanupRead, error: nullable(isString) }),
	keeperDirectory: isString, owned: recordOf(owned),
	instances: recordOf(fields({ variant: isComparisonId, directory: isString })),
	receipts: recordOf(screenshot),
});

function convertLifecycle(v: LegacyVariant): VariantLifecycle | null {
	if (v.start.kind !== "registered") {
		if (v.sessionId !== null || v.firstPrompt.kind !== "not-attempted") return null;
	} else if (v.sessionId === null) return null;
	if (v.cleanup.kind === "blocked" && v.stop.kind === "blocked") return { kind: "stop-blocked", reason: v.stop.reason };
	if (v.cleanup.kind !== "pending" && v.stop.kind !== "stopped") return null;
	if (v.cleanup.kind === "removed" || v.cleanup.kind === "preserved") return { kind: v.cleanup.kind };
	if (v.cleanup.kind === "blocked") return { kind: "cleanup-blocked", reasons: v.cleanup.reasons };
	if (v.stop.kind === "stopped" || v.stop.kind === "stopping") return { kind: v.stop.kind };
	if (v.stop.kind === "blocked") return { kind: "stop-blocked", reason: v.stop.reason };
	if (v.start.kind !== "registered") return v.start;
	if (v.firstPrompt.kind === "uncertain") return v.firstPrompt;
	return { kind: v.firstPrompt.kind === "admitted" ? "running" : v.firstPrompt.kind === "attempted" ? "prompt-attempted" : "registered" };
}

export function parseComparisonRecord(value: unknown, id: string): ComparisonRecord | null {
	let parsed: ComparisonRecord;
	if (record(value)) parsed = value;
	else if (legacy(value)) {
		const variants: VariantRecord[] = [];
		for (const [index, v] of value.snapshot.variants.entries()) {
			const phase = convertLifecycle(v);
			if (!phase || v.ordinal !== index + 1) return null;
			variants.push({
				id: v.id, instanceId: v.instanceId, sessionId: v.sessionId, sessionIds: v.sessionIds,
				cwd: v.cwd, checkout: v.checkout, branch: v.branch,
				model: null, thinkingLevel: null, lifecycle: phase,
				screenshot: v.screenshot, screenshotError: v.screenshotError,
			});
		}
		const { snapshot: s } = value;
		parsed = {
			version: 2,
			spec: value.spec,
			snapshot: {
				id: s.id, createdAt: s.createdAt, prompt: s.prompt,
				sourceCwd: s.sourceCwd, repository: s.repository,
				base: s.base, baseSha: s.baseSha, variants, winner: s.winner,
			},
			owned: value.owned,
			instances: Object.fromEntries(Object.entries(value.instances).map(([instance, member]) => [instance, member.variant])),
			receipts: value.receipts,
		};
	} else return null;
	const s = parsed.snapshot;
	if (s.id !== id || s.variants.length !== parsed.spec.variants.length) return null;
	const ids = new Set<string>();
	const sessions = new Set<string>();
	const instances = new Set<string>();
	const checkouts = new Set<string>();
	const branches = new Set<string>();
	for (const v of s.variants) {
		if (ids.has(v.id) || instances.has(v.instanceId) || checkouts.has(v.checkout) || branches.has(v.branch)) return null;
		if (parsed.instances[v.instanceId] !== v.id || (v.sessionId !== null && !v.sessionIds.includes(v.sessionId))) return null;
		if (new Set(v.sessionIds).size !== v.sessionIds.length || v.sessionIds.some(session => sessions.has(session))) return null;
		if (["queued", "starting", "failed", "cancelled"].includes(v.lifecycle.kind) && v.sessionId !== null) return null;
		if (["registered", "prompt-attempted", "running", "uncertain"].includes(v.lifecycle.kind) && v.sessionId === null) return null;
		const checkout = parsed.owned[v.id];
		if (checkout && (checkout.path !== v.checkout || checkout.branch !== v.branch || checkout.repository !== s.repository)) return null;
		ids.add(v.id);
		instances.add(v.instanceId);
		checkouts.add(v.checkout);
		branches.add(v.branch);
		for (const session of v.sessionIds) sessions.add(session);
	}
	if (s.winner !== null && !s.variants.some(v => v.id === s.winner && v.sessionId !== null && v.lifecycle.kind !== "removed")) return null;
	if (Object.values(parsed.instances).some(member => !ids.has(member)) || Object.keys(parsed.owned).some(member => !ids.has(member))) return null;
	if (Object.keys(parsed.instances).some(instance => !isComparisonId(instance))) return null;
	for (const key of Object.keys(parsed.receipts)) {
		let receipt: unknown;
		try { receipt = JSON.parse(key); }
		catch { return null; }
		if (!Array.isArray(receipt) || receipt.length !== 2 || !isString(receipt[0]) || !isString(receipt[1]) || !parsed.instances[receipt[0]]) return null;
	}
	return parsed;
}

export class ComparisonRecords {
	readonly entries = new Map<string, ComparisonEntry>();
	readonly errors = new Map<string, string>();
	readonly claims = new Map<string, Set<string>>();
	constructor(readonly dir: string, private readonly port: number, private readonly changed: () => void, private readonly write = atomicWriteText) { this.load(); }
	file(id: string): string { return join(this.dir, id, "comparison.json"); }

	#claim(instance: string, id: string): void {
		const owners = this.claims.get(instance) ?? new Set<string>();
		owners.add(id);
		this.claims.set(instance, owners);
	}
	load(): void {
		if (!existsSync(this.dir)) return;
		for (const id of readdirSync(this.dir)) {
			if (!isComparisonId(id)) continue;
			try {
				const members = join(this.dir, id, "members");
				if (existsSync(members)) {
					for (const instance of readdirSync(members)) if (isComparisonId(instance)) this.#claim(instance, id);
				}
				const raw: unknown = JSON.parse(readFileSync(this.file(id), "utf8"));
				// Legacy records predate separate claims. Even an invalid body cannot release the instances it names.
				if (isObject(raw) && isObject(raw.instances)) for (const instance of Object.keys(raw.instances)) if (isComparisonId(instance)) this.#claim(instance, id);
				const value = parseComparisonRecord(raw, id);
				if (!value) throw new Error("The comparison manifest is invalid. It will not be replaced or restarted.");
				for (const instance of Object.keys(value.instances)) this.#claim(instance, id);
				const prior = this.entries.get(id);
				if (!prior?.lock.held) {
					this.entries.set(id, {
						value,
						lock: prior?.lock ?? new OwnerLock(join(this.dir, id, "owner.lock"), this.port),
						lane: new SerialLane(),
						actions: new SerialLane(),
					});
				}
				this.errors.delete(id);
			} catch (error) { this.errors.set(id, errorText(error)); }
		}
	}

	async claim(id: string, instance: string): Promise<void> {
		const directory = join(this.dir, id, "members");
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await writeFile(join(directory, instance), "", { mode: 0o600 });
		this.#claim(instance, id);
	}
	async save(value: ComparisonRecord): Promise<void> {
		for (const instance of Object.keys(value.instances)) await this.claim(value.snapshot.id, instance);
		await this.write(this.file(value.snapshot.id), JSON.stringify(value), 0o600);
	}
	change(entry: ComparisonEntry, change: (draft: ComparisonRecord) => void | Promise<void>): Promise<void> {
		return entry.lane.run(async () => {
			if (!entry.lock.acquire()) throw new Error("Comparison ownership was lost.");
			if (this.errors.has(entry.value.snapshot.id)) throw new Error(this.errors.get(entry.value.snapshot.id));
			const draft = structuredClone(entry.value);
			await change(draft);
			await this.write(this.file(draft.snapshot.id), JSON.stringify(draft), 0o600);
			entry.value = draft;
			this.changed();
		});
	}
}
