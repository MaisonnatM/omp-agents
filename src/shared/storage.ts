/** Settings › Storage's measured usage, native cleanup reports, and editable rules. */
import { isObject, isTexts, oneOf, type Parsed } from "../json";
import type { AgentSettingRow } from "./agent-settings";

export const GC_PHASES = ["stale", "blobs", "archive", "compress", "wal"] as const;
export type GcPhase = (typeof GC_PHASES)[number];
/** Sandboxes of ended tasks: clean ones, then ones whose checkout still holds changes, which only an explicit choice removes. */
export const SANDBOX_STEPS = ["sandboxes", "changedSandboxes"] as const;
export type SandboxStep = (typeof SANDBOX_STEPS)[number];
export const isSandboxStep = oneOf(SANDBOX_STEPS);
/** Package managers' download caches, which each tool's own prune command trims. */
export const CACHE_STEP = "packageCaches" as const;
export const CLEANUP_STEPS = [...GC_PHASES, ...SANDBOX_STEPS, CACHE_STEP] as const;
export type CleanupStep = (typeof CLEANUP_STEPS)[number];
export type SandboxKeepReason = "owner-live" | "occupied" | "changed" | "locked" | "unreadable" | "failed";
export interface SandboxResult { path: string; kept: SandboxKeepReason | null; detail: string | null }
export interface SandboxPlan extends SandboxResult { bytes: number | null }
export const PACKAGE_TOOLS = ["uv", "pnpm", "bun"] as const;
export type PackageTool = (typeof PACKAGE_TOOLS)[number];
/** One installed tool's cache; `bytes` counts files a project's environment may share through clones or hard links. */
export interface CachePlan { tool: PackageTool; path: string; bytes: number | null }
/** `after` is null when the prune failed or the cache could not be measured. */
export interface CacheResult extends CachePlan { after: number | null; error: string | null }

export class CleanupBusy extends Error {
	constructor() { super("Another cleanup is running. Try again when it ends."); }
}

export interface GcAnswer {
	apply: boolean;
	stale?: { wouldDelete: number; deleted: number; bytes: number; errors: string[] };
	blobs?: { wouldDelete: number; deleted: number; bytes: number; errors: string[] };
	archive?: { wouldArchive: number; archived: number; wouldDeleteTemps: number; deletedTemps: number; skippedActive: number; keptNewestGlobal: number; keptNewestPerCwd: number; tempBytes: number; errors: string[] };
	compress?: { supported: boolean; probeFailure?: string; wouldCompress: number; compressed: number; leftoverScratchDirs: number; allocatedBefore: number; allocatedAfter: number; errors: string[] };
	wal?: { databases: { dbPath: string; walBytes: number; checkpointed: boolean; busy: number }[]; walBytes: number; checkpointed: boolean };
}

export const GC_RULES = [
	{ id: "gc.blobs", label: "Unused attachments", hint: "Include unreferenced attachments in the default cleanup.", kind: "toggle" },
	{ id: "gc.archive", label: "Cold sessions", hint: "Include archiving in the default cleanup. Archived sessions leave the roster and Resume.", kind: "toggle" },
	{ id: "gc.wal", label: "Database logs", hint: "Include database log checkpoints in the default cleanup.", kind: "toggle" },
	{ id: "gc.stale", label: "Old debug reports and replicas", hint: "Include expired reports, replicas, and dangling markers in the default cleanup.", kind: "toggle" },
	{ id: "gc.compress", label: "Compress idle sessions", hint: "Include transparent compression in the default cleanup.", kind: "toggle" },
	{ id: "gc.coldArchiveAfterDays", label: "Archive after", hint: "Days since a past session was last active.", kind: "number" },
	{ id: "gc.retainNewestGlobal", label: "Keep newest sessions", hint: "Never archive this many newest sessions across all folders.", kind: "number" },
	{ id: "gc.retainNewestPerCwd", label: "Keep newest per folder", hint: "Never archive this many newest sessions in each folder.", kind: "number" },
	{ id: "gc.staleRetainNewest", label: "Keep newest reports and replicas", hint: "Retain this many newest entries of each kind.", kind: "number" },
	{ id: "gc.staleRetainDays", label: "Keep reports and replicas for", hint: "Days before old entries qualify for removal.", kind: "number" },
	{ id: "gc.compressAfterDays", label: "Compress after", hint: "Days a session must be idle before compression.", kind: "number" },
	{ id: "gc.autoCompress", label: "Compress daily", hint: "Runs at most once a day when you start omp in a terminal, not when you start a dashboard session.", kind: "toggle" },
] as const;
export interface StorageUsage {
	folders: { label: string; path: string; bytes: number | null; error: string | null }[];
	rules: AgentSettingRow[];
	/** Workspace ids omitted from the rows so Storage can edit global values instead of locking them. */
	overrides: string[];
	settingsError: string | null;
	autoCompress: { at: number; text: string } | null;
}
export type CleanupRequest =
	| { action: "preview"; step?: "sandboxes" | typeof CACHE_STEP }
	| { action: "apply"; step: GcPhase | typeof CACHE_STEP }
	| { action: "apply"; step: SandboxStep; sandboxes: string[] };
export type CleanupStepResult =
	| { step: GcPhase; gc: GcAnswer }
	| { step: SandboxStep; sandboxes: SandboxResult[] }
	| { step: typeof CACHE_STEP; caches: CacheResult[] };

export function parseCleanupRequest(raw: unknown): Parsed<CleanupRequest> {
	if (!isObject(raw) || Array.isArray(raw)) return null;
	if (raw.action === "preview" && (raw.step === undefined || raw.step === "sandboxes" || raw.step === CACHE_STEP)) return { ok: { action: "preview", ...(raw.step === undefined ? {} : { step: raw.step }) } };
	if (raw.action !== "apply") return null;
	if (oneOf(GC_PHASES)(raw.step) || raw.step === CACHE_STEP) return { ok: { action: "apply", step: raw.step } };
	if (oneOf(SANDBOX_STEPS)(raw.step) && isTexts(raw.sandboxes) && raw.sandboxes.length <= 200 && raw.sandboxes.every(path => path.length > 0 && path.length < 4096)) return { ok: { action: "apply", step: raw.step, sandboxes: [...new Set(raw.sandboxes)] } };
	return null;
}
