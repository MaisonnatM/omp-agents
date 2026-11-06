/** Native-order cleanup presentation and the sequential run that can stop only between operations. */
import { errorText } from "../src/json";
import { CACHE_STEP, CLEANUP_STEPS, isSandboxStep, PACKAGE_TOOLS, type CachePlan, type CacheResult, type CleanupRequest, type CleanupStep, type CleanupStepResult, type GcAnswer, type GcPhase, type PreviewSource, type Previews, type SandboxKeepReason, type SandboxPlan, type SandboxResult, type SandboxStep } from "../src/shared/storage";
import type { SystemLoad } from "../src/shared/system";
import { getJson, putJson } from "./api";
import { formatBytes } from "./labels";

export interface CleanupRow {
	step: CleanupStep;
	label: string;
	unit: readonly [string, string];
	count: number;
	bytes: number | null;
	size: string;
	detail: string;
	errors: string[];
	available: boolean;
}
export interface CleanupResult { text: string; errors: string[] }
export interface StepProgress extends CleanupResult { state: "waiting" | "running" | "done" | "failed" }
type Progress = Partial<Record<CleanupStep, StepProgress>>;
/** How a run ended: every chosen step ran, you stopped it, or a step failed and the rest did not start. */
export type CleanupEnd = "finished" | "stopped" | "failed";
export type CleanupRun =
	| { phase: "running"; progress: Progress; stopRequested: boolean; before: number | null }
	| { phase: "done"; progress: Progress; ended: CleanupEnd; before: number | null; after: number | null };

type GcReports = { [P in GcPhase]: NonNullable<GcAnswer[P]> };
type SandboxResults = { results: SandboxResult[]; total: number };
type PreviewReports = GcReports & Record<SandboxStep, SandboxPlan[]> & Record<typeof CACHE_STEP, CachePlan[]>;
type ResultReports = GcReports & Record<SandboxStep, SandboxResults> & Record<typeof CACHE_STEP, CacheResult[]>;
type Preview = Omit<CleanupRow, "step" | "label" | "unit">;
type Phase<P extends CleanupStep> = {
	label: string;
	unit: readonly [string, string];
	preview(report: PreviewReports[P] | undefined): Preview;
	result(report: ResultReports[P]): CleanupResult;
};

function deletionPreview(report: GcReports["blobs"] | undefined): Omit<Preview, "detail"> {
	return {
		count: report?.wouldDelete ?? 0, bytes: report?.bytes ?? null,
		size: report ? formatBytes(report.bytes) : "", errors: report?.errors ?? [], available: report !== undefined,
	};
}
function deletionResult(report: GcReports["blobs"]): CleanupResult {
	return {
		text: `${report.deleted} of ${report.wouldDelete} ${report.wouldDelete === 1 ? "entry" : "entries"} removed · ${formatBytes(report.bytes)} selected`,
		errors: report.errors,
	};
}
/** The size of plans whose bytes each count files shared elsewhere: the most removing them all can free. */
function upperBound(plans: readonly { bytes: number | null }[] | undefined): Pick<Preview, "bytes" | "size"> {
	if (plans === undefined) return { bytes: null, size: "" };
	if (!plans.every(plan => plan.bytes !== null)) return { bytes: null, size: "Size unavailable" };
	const total = plans.reduce((sum, plan) => sum + (plan.bytes ?? 0), 0);
	return { bytes: null, size: total === 0 ? formatBytes(0) : `Up to ${formatBytes(total)}` };
}

/** The kept reason of the sandboxes each sandbox step removes: none for clean ones, `changed` for ones you choose to discard.
 * Their sizes are upper bounds: `du` counts again the files a sandbox shares with its source checkout or a package cache through APFS clones. */
const SANDBOX_TARGET: Record<SandboxStep, SandboxKeepReason | null> = { sandboxes: null, changedSandboxes: "changed" };
const TARGETED: ReadonlySet<SandboxKeepReason | null> = new Set(Object.values(SANDBOX_TARGET));
export function sandboxTargets(step: SandboxStep, plans: readonly SandboxPlan[]): SandboxPlan[] {
	return plans.filter(plan => plan.kept === SANDBOX_TARGET[step]);
}
/** The sandboxes no cleanup row offers: a live owner, a lock, or something unreadable keeps them. */
export function keptSandboxes(plans: readonly SandboxPlan[]): SandboxPlan[] {
	return plans.filter(plan => !TARGETED.has(plan.kept));
}

function sandboxPhase(step: SandboxStep, label: string, detail: string): Phase<SandboxStep> {
	return {
		label, unit: ["sandbox", "sandboxes"],
		preview: plans => {
			const targets = plans && sandboxTargets(step, plans);
			return { count: targets?.length ?? 0, ...upperBound(targets), detail, errors: [], available: plans !== undefined };
		},
		result: ({ results, total }) => ({
			text: `${results.filter(result => result.kept === null).length} of ${total} ${total === 1 ? "sandbox" : "sandboxes"} removed`,
			errors: results.filter(result => result.kept !== null).map(result => `${result.path}: ${result.detail ?? "Kept after rechecking."}`),
		}),
	};
}

const and = new Intl.ListFormat("en", { type: "conjunction" });
const or = new Intl.ListFormat("en", { type: "disjunction" });
/** A cache's size is the most its prune can free: projects' environments share some of its files through clones or hard links. */
const cachePhase: Phase<typeof CACHE_STEP> = {
	label: "Package caches", unit: ["cache", "caches"],
	preview: plans => ({
		count: plans?.length ?? 0, ...upperBound(plans),
		detail: plans?.length === 0 ? `No ${or.format(PACKAGE_TOOLS)} found.`
			: `${plans ? `Caches of ${and.format(plans.map(plan => plan.tool))}. ` : ""}Removes packages no project needs, and keeps what running tools use.`,
		errors: [], available: plans !== undefined,
	}),
	result: results => {
		const pruned = results.filter(result => result.error === null);
		const freed = pruned.reduce((sum, result) => sum + (result.bytes !== null && result.after !== null ? Math.max(0, result.bytes - result.after) : 0), 0);
		return {
			text: `${pruned.length} of ${results.length} ${results.length === 1 ? "cache" : "caches"} pruned · ${formatBytes(freed)} smaller`,
			errors: results.flatMap(result => result.error === null ? [] : [`${result.tool}: ${result.error}`]),
		};
	},
};

const PHASES: { [P in CleanupStep]: Phase<P> } = {
	stale: {
		label: "Old debug reports and replicas", unit: ["entry", "entries"],
		preview: report => ({ ...deletionPreview(report), detail: "Also removes dangling session markers and expired breadcrumbs." }),
		result: deletionResult,
	},
	blobs: {
		label: "Unused attachments", unit: ["entry", "entries"],
		preview: report => ({ ...deletionPreview(report), detail: "Attachments that no session references, including archived sessions." }),
		result: deletionResult,
	},
	archive: {
		label: "Archive cold sessions", unit: ["session", "sessions"],
		preview: report => ({
			count: (report?.wouldArchive ?? 0) + (report?.wouldDeleteTemps ?? 0), bytes: report?.tempBytes ?? null,
			size: report ? `${report.wouldArchive} session${report.wouldArchive === 1 ? "" : "s"}${report.wouldDeleteTemps ? ` · ${formatBytes(report.tempBytes)} of temporary files` : ""}` : "",
			detail: report ? `Leaves the roster, History, and Resume. Kept ${report.keptNewestGlobal} newest overall, ${report.keptNewestPerCwd} per folder, and ${report.skippedActive} active session${report.skippedActive === 1 ? "" : "s"}.` : "",
			errors: report?.errors ?? [], available: report !== undefined,
		}),
		result: report => ({
			text: `${report.archived} session${report.archived === 1 ? "" : "s"} archived · ${report.deletedTemps} temporary file${report.deletedTemps === 1 ? "" : "s"} removed`,
			errors: report.errors,
		}),
	},
	compress: {
		label: "Compress idle sessions", unit: ["entry", "entries"],
		preview: report => ({
			count: (report?.wouldCompress ?? 0) + (report?.leftoverScratchDirs ?? 0), bytes: null,
			size: report ? `${formatBytes(report.allocatedBefore)} on disk` : "",
			detail: report?.probeFailure ?? (report?.supported ? "Files stay readable. Savings are known only after compression." : "Not available on this volume."),
			errors: report?.errors ?? [], available: report?.supported === true && !report.probeFailure,
		}),
		result: report => ({
			text: report.probeFailure ?? (!report.supported ? "Not available on this volume." : `${report.compressed} file${report.compressed === 1 ? "" : "s"} compressed · ${formatBytes(Math.max(0, report.allocatedBefore - report.allocatedAfter))} less on disk`),
			errors: [...report.errors, ...(report.probeFailure ? [report.probeFailure] : [])],
		}),
	},
	wal: {
		label: "Database logs", unit: ["database", "databases"],
		preview: report => ({
			count: report?.databases.filter(database => database.walBytes > 0).length ?? 0, bytes: report?.walBytes ?? null,
			size: report ? formatBytes(report.walBytes) : "",
			detail: "Checkpoints database logs. A busy database may keep its log.", errors: [], available: report !== undefined,
		}),
		result: report => {
			const busy = report.databases.filter(database => database.busy > 0 || !database.checkpointed && database.walBytes > 0).length;
			const checkpointed = report.databases.filter(database => database.checkpointed).length;
			return { text: `${checkpointed} database${checkpointed === 1 ? "" : "s"} checkpointed${busy ? ` · ${busy} busy` : ""}`, errors: [] };
		},
	},
	sandboxes: sandboxPhase("sandboxes", "Sandboxes of ended tasks", "Clean, unused isolation sandboxes whose omp process ended. Rechecked before removal."),
	changedSandboxes: sandboxPhase(
		"changedSandboxes",
		"Sandboxes of ended tasks with leftover changes",
		"Their omp process ended with edits still inside them. Edits omp did not bring back to your checkout are lost. Rechecked before removal.",
	),
	packageCaches: cachePhase,
};

function previewRow<P extends CleanupStep>(step: P, report: PreviewReports[P] | undefined): CleanupRow {
	const phase = PHASES[step];
	return { step, label: phase.label, unit: phase.unit, ...phase.preview(report) };
}
/** Each preview as it stands: null until it answers, and still null when it failed. */
export type Loaded = { [S in PreviewSource]: Previews[S] | null };
export function cleanupRows(previews: Loaded): CleanupRow[] {
	return CLEANUP_STEPS.map(step => isSandboxStep(step) ? previewRow(step, previews.sandboxes ?? undefined)
		: step === CACHE_STEP ? previewRow(step, previews.caches ?? undefined)
		: previewRow(step, previews.gc?.[step]));
}
export function stepResultText<P extends CleanupStep>(step: P, report: ResultReports[P]): CleanupResult {
	return PHASES[step].result(report);
}
/** The report a single gc phase's or the package caches' apply answered for `step`. */
function reportOf<P extends GcPhase | typeof CACHE_STEP>(step: P, answer: CleanupStepResult): ResultReports[P] {
	if (answer.step === step && "caches" in answer) return answer.caches as ResultReports[P];
	const report = answer.step === step && "gc" in answer ? answer.gc[step as GcPhase] : undefined;
	if (report === undefined) throw new Error("Unexpected cleanup response.");
	return report as ResultReports[P];
}

type Apply = Extract<CleanupRequest, { action: "apply" }>;
export interface CleanupIo {
	apply(request: Apply): Promise<CleanupStepResult>;
	availableBytes(): Promise<number | null>;
}
const cleanupIo: CleanupIo = {
	apply: request => putJson<CleanupStepResult>("/api/storage/cleanup", request),
	availableBytes: () => getJson<SystemLoad>("/api/system").then(load => load.diskAvailable),
};
interface RunHooks {
	stopped(): boolean;
	onProgress(run: CleanupRun): void;
}

async function runSandboxes(step: SandboxStep, plans: readonly SandboxPlan[], io: CleanupIo, stopped: () => boolean, onProgress: (result: CleanupResult) => void): Promise<CleanupResult> {
	const targets = sandboxTargets(step, plans);
	const results: SandboxResult[] = [];
	for (const [index, target] of targets.entries()) {
		if (stopped()) break;
		onProgress({ ...stepResultText(step, { results, total: targets.length }), text: `Checking and removing ${index + 1} of ${targets.length}…` });
		const answer = await io.apply({ action: "apply", step, sandboxes: [target.path] });
		if (answer.step !== step || !("sandboxes" in answer)) throw new Error("Unexpected cleanup response.");
		results.push(...answer.sandboxes);
	}
	return stepResultText(step, { results, total: targets.length });
}

export async function runCleanup(chosen: readonly CleanupRow[], sandboxes: readonly SandboxPlan[], { stopped, onProgress }: RunHooks, io: CleanupIo = cleanupIo): Promise<CleanupRun> {
	const progress: Progress = Object.fromEntries(chosen.map(row => [row.step, { state: "waiting", text: "Waiting", errors: [] }]));
	let before: number | null = null;
	let ended: CleanupEnd = "finished";
	const publish = (): void => onProgress({ phase: "running", progress: { ...progress }, stopRequested: stopped(), before });
	publish();
	before = await io.availableBytes().catch(() => null);
	publish();
	for (const row of chosen) {
		if (stopped()) break;
		progress[row.step] = { state: "running", text: "Running…", errors: [] };
		publish();
		try {
			let result: CleanupResult;
			if (isSandboxStep(row.step)) {
				const step = row.step;
				result = await runSandboxes(step, sandboxes, io, stopped, result => {
					progress[step] = { state: "running", ...result };
					publish();
				});
			} else {
				const step = row.step;
				result = stepResultText(step, reportOf(step, await io.apply({ action: "apply", step })));
			}
			if (result.errors.length > 0) ended = "failed";
			progress[row.step] = { state: ended === "failed" ? "failed" : "done", ...result };
		} catch (error) {
			ended = "failed";
			progress[row.step] = { state: "failed", text: "Failed", errors: [errorText(error)] };
		}
		publish();
		if (ended === "failed") break;
	}
	// A stop asked for during the last step may have cut its sandboxes short, so it counts too.
	if (ended === "finished" && stopped()) ended = "stopped";
	const after = await io.availableBytes().catch(() => null);
	return { phase: "done", progress: { ...progress }, ended, before, after };
}
