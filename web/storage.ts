/** The cleanup checklist in native gc order, with only measured sizes. */
import type { AgentSettingRow } from "../src/shared/agent-settings";
import { GC_RULES, type CleanupStep, type GcAnswer, type GcRule, type SandboxPlan } from "../src/shared/storage";
import { formatBytes } from "./labels";

export interface CleanupRow { step: CleanupStep; label: string; count: number; bytes: number | null; size: string; detail: string; errors: string[]; available: boolean }
export function cleanupRows(gc: GcAnswer, sandboxes: SandboxPlan[] | null): CleanupRow[] {
	const { stale, blobs, archive, compress, wal } = gc;
	const removable = sandboxes?.filter(plan => plan.kept === null);
	const sandboxBytes = removable && removable.every(plan => plan.bytes !== null) ? removable.reduce((sum, plan) => sum + (plan.bytes ?? 0), 0) : null;
	return [
		{ step: "stale", label: "Old debug reports and replicas", count: stale?.wouldDelete ?? 0, bytes: stale?.bytes ?? null, size: stale ? formatBytes(stale.bytes) : "", detail: "Also removes dangling session markers and expired breadcrumbs.", errors: stale?.errors ?? [], available: !!stale },
		{ step: "blobs", label: "Unused attachments", count: blobs?.wouldDelete ?? 0, bytes: blobs?.bytes ?? null, size: blobs ? formatBytes(blobs.bytes) : "", detail: "Attachments that no session references, including archived sessions.", errors: blobs?.errors ?? [], available: !!blobs },
		{ step: "archive", label: "Archive cold sessions", count: (archive?.wouldArchive ?? 0) + (archive?.wouldDeleteTemps ?? 0), bytes: archive?.tempBytes ?? null, size: archive ? `${archive.wouldArchive} session${archive.wouldArchive === 1 ? "" : "s"}${archive.wouldDeleteTemps ? ` · ${formatBytes(archive.tempBytes)} of temporary files` : ""}` : "", detail: archive ? `Leaves the roster, History, and Resume. Kept ${archive.keptNewestGlobal} newest overall, ${archive.keptNewestPerCwd} per folder, and ${archive.skippedActive} active session${archive.skippedActive === 1 ? "" : "s"}.` : "", errors: archive?.errors ?? [], available: !!archive },
		{ step: "compress", label: "Compress idle sessions", count: (compress?.wouldCompress ?? 0) + (compress?.leftoverScratchDirs ?? 0), bytes: null, size: compress ? `${formatBytes(compress.allocatedBefore)} on disk` : "", detail: compress?.probeFailure ?? (compress?.supported ? "Files stay readable. Savings are known only after compression." : "Not available on this volume."), errors: compress?.errors ?? [], available: compress?.supported === true && !compress.probeFailure },
		{ step: "wal", label: "Database logs", count: wal?.databases.filter(database => database.walBytes > 0).length ?? 0, bytes: wal?.walBytes ?? null, size: wal ? formatBytes(wal.walBytes) : "", detail: "Checkpoints database logs. A busy database may keep its log.", errors: [], available: !!wal },
		{ step: "sandboxes", label: "Sandboxes of ended tasks", count: removable?.length ?? 0, bytes: sandboxBytes, size: sandboxes === null ? "Checking…" : sandboxBytes === null ? "Size unavailable" : formatBytes(sandboxBytes), detail: "Clean, unused isolation sandboxes whose omp process ended. Rechecked before removal.", errors: [], available: sandboxes !== null },
	];
}

export function cleanupSettingRows(rules: GcRule[]): AgentSettingRow[] {
	return rules.map(rule => {
		const definition = GC_RULES.find(candidate => candidate.id === rule.id)!;
		return {
			id: rule.id, label: definition.label, description: definition.hint, credential: false,
			control: definition.kind === "toggle" ? { kind: "toggle" } : { kind: "number", min: 0 },
			default: rule.default,
			...(rule.user != null ? { user: rule.user } : {}),
		};
	});
}

export function gcResultText(step: Exclude<CleanupStep, "sandboxes">, report: GcAnswer): { text: string; errors: string[] } {
	switch (step) {
		case "stale": case "blobs": {
			const result = report[step]!;
			return { text: `${result.deleted} of ${result.wouldDelete} ${result.wouldDelete === 1 ? "entry" : "entries"} removed · ${formatBytes(result.bytes)} selected`, errors: result.errors };
		}
		case "archive": {
			const result = report.archive!;
			return { text: `${result.archived} session${result.archived === 1 ? "" : "s"} archived · ${result.deletedTemps} temporary file${result.deletedTemps === 1 ? "" : "s"} removed`, errors: result.errors };
		}
		case "compress": {
			const result = report.compress!;
			return { text: result.probeFailure ?? (!result.supported ? "Not available on this volume." : `${result.compressed} file${result.compressed === 1 ? "" : "s"} compressed · ${formatBytes(Math.max(0, result.allocatedBefore - result.allocatedAfter))} less on disk`), errors: [...result.errors, ...(result.probeFailure ? [result.probeFailure] : [])] };
		}
		case "wal": {
			const result = report.wal!;
			const busy = result.databases.filter(database => database.busy > 0 || !database.checkpointed && database.walBytes > 0).length;
			const checkpointed = result.databases.filter(database => database.checkpointed).length;
			return { text: `${checkpointed} database${checkpointed === 1 ? "" : "s"} checkpointed${busy ? ` · ${busy} busy` : ""}`, errors: [] };
		}
	}
}
