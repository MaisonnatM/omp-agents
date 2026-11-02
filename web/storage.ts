/** Native-order cleanup presentation and the sequential run that can stop only between operations. */
import { errorText } from "../src/json";
import { CLEANUP_STEPS, type CleanupRequest, type CleanupStep, type CleanupStepResult, type GcAnswer, type GcPhase, type SandboxPlan, type SandboxResult } from "../src/shared/storage";
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
export interface CleanupRun {
	phase: "running" | "done";
	progress: Partial<Record<CleanupStep, StepProgress>>;
	stopping: boolean;
	before: number | null;
	after: number | null;
}

type GcReports = { [P in GcPhase]: NonNullable<GcAnswer[P]> };
type PreviewReports = GcReports & { sandboxes: SandboxPlan[] };
type ResultReports = GcReports & { sandboxes: { results: SandboxResult[]; total: number } };
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
	sandboxes: {
		label: "Sandboxes of ended tasks", unit: ["sandbox", "sandboxes"],
		preview: plans => {
			const removable = plans?.filter(plan => plan.kept === null);
			const bytes = removable && removable.every(plan => plan.bytes !== null)
				? removable.reduce((sum, plan) => sum + (plan.bytes ?? 0), 0) : null;
			return {
				count: removable?.length ?? 0, bytes,
				size: plans === undefined ? "Checking…" : bytes === null ? "Size unavailable" : formatBytes(bytes),
				detail: "Clean, unused isolation sandboxes whose omp process ended. Rechecked before removal.",
				errors: [], available: plans !== undefined,
			};
		},
		result: ({ results, total }) => ({
			text: `${results.filter(result => result.kept === null).length} of ${total} ${total === 1 ? "sandbox" : "sandboxes"} removed`,
			errors: results.filter(result => result.kept !== null).map(result => `${result.path}: ${result.detail ?? "Kept after rechecking."}`),
		}),
	},
};

function previewRow<P extends CleanupStep>(step: P, report: PreviewReports[P] | undefined): CleanupRow {
	const phase = PHASES[step];
	return { step, label: phase.label, unit: phase.unit, ...phase.preview(report) };
}
export function cleanupRows(gc: GcAnswer, sandboxes: SandboxPlan[] | null): CleanupRow[] {
	return CLEANUP_STEPS.map(step => step === "sandboxes" ? previewRow(step, sandboxes ?? undefined) : previewRow(step, gc[step]));
}
export function gcResultText<P extends GcPhase>(step: P, report: ResultReports[P]): CleanupResult {
	return PHASES[step].result(report);
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

async function runSandboxes(plans: readonly SandboxPlan[], io: CleanupIo, stopped: () => boolean, onProgress: (result: CleanupResult) => void): Promise<CleanupResult> {
	const targets = plans.filter(plan => plan.kept === null);
	const results: SandboxResult[] = [];
	for (const [index, target] of targets.entries()) {
		if (stopped()) break;
		onProgress({ ...PHASES.sandboxes.result({ results, total: targets.length }), text: `Checking and removing ${index + 1} of ${targets.length}…` });
		const answer = await io.apply({ action: "apply", step: "sandboxes", sandboxes: [target.path] });
		if (answer.step !== "sandboxes") throw new Error("Unexpected cleanup response.");
		results.push(...answer.sandboxes);
	}
	return PHASES.sandboxes.result({ results, total: targets.length });
}

export async function runCleanup(chosen: readonly CleanupRow[], sandboxes: readonly SandboxPlan[], { stopped, onProgress }: RunHooks, io: CleanupIo = cleanupIo): Promise<CleanupRun> {
	const progress: CleanupRun["progress"] = Object.fromEntries(chosen.map(row => [row.step, { state: "waiting", text: "Waiting", errors: [] }]));
	let before: number | null = null;
	let failed = false;
	const publish = (): void => onProgress({ phase: "running", progress: { ...progress }, stopping: stopped() || failed, before, after: null });
	publish();
	before = await io.availableBytes().catch(() => null);
	publish();
	for (const row of chosen) {
		if (stopped() || failed) break;
		progress[row.step] = { state: "running", text: "Running…", errors: [] };
		publish();
		try {
			let result: CleanupResult;
			if (row.step === "sandboxes") {
				result = await runSandboxes(sandboxes, io, stopped, result => {
					progress.sandboxes = { state: "running", ...result };
					publish();
				});
			} else {
				const answer = await io.apply({ action: "apply", step: row.step });
				if (answer.step === "sandboxes" || answer.step !== row.step) throw new Error("Unexpected cleanup response.");
				const report = answer.gc[row.step];
				if (report === undefined) throw new Error("Unexpected cleanup response.");
				result = gcResultText(row.step, report);
			}
			failed = result.errors.length > 0;
			progress[row.step] = { state: failed ? "failed" : "done", ...result };
		} catch (error) {
			failed = true;
			progress[row.step] = { state: "failed", text: "Cleanup stopped", errors: [errorText(error)] };
		}
		publish();
	}
	const after = await io.availableBytes().catch(() => null);
	return { phase: "done", progress: { ...progress }, stopping: stopped() || failed, before, after };
}
