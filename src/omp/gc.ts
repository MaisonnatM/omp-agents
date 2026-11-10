/** Native gc runs and storage reads. Cleanup policy and locking stay in omp. */
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { arrayOf, fields, isBoolean, isNumber, isString, isTexts, optional, errorText, parseJson } from "../json";
import { run } from "../proc";
import { CleanupBusy, GC_PHASES, GC_RULES, type GcAnswer, type GcPhase, type StorageUsage } from "../shared/storage";
import { allocatedUsage } from "../worktrees";
import { loadSessionSettings } from "./config";
import { rowOf } from "./agent-settings";
import { ompCommand } from "./install";
import { dirs, gcAutoCompress, settingsRegistry } from "./modules";

const deletion = fields<NonNullable<GcAnswer["blobs"]>>({ wouldDelete: isNumber, deleted: isNumber, bytes: isNumber, errors: isTexts });
const archive = fields<NonNullable<GcAnswer["archive"]>>({ wouldArchive: isNumber, archived: isNumber, wouldDeleteTemps: isNumber, deletedTemps: isNumber, skippedActive: isNumber, keptNewestGlobal: isNumber, keptNewestPerCwd: isNumber, tempBytes: isNumber, errors: isTexts });
const compress = fields<NonNullable<GcAnswer["compress"]>>({ supported: isBoolean, probeFailure: optional(isString), wouldCompress: isNumber, compressed: isNumber, leftoverScratchDirs: isNumber, allocatedBefore: isNumber, allocatedAfter: isNumber, errors: isTexts });
const wal = fields<NonNullable<GcAnswer["wal"]>>({ databases: arrayOf(fields({ dbPath: isString, walBytes: isNumber, checkpointed: isBoolean, busy: isNumber })), walBytes: isNumber, checkpointed: isBoolean });
const isAnswer = fields<GcAnswer>({ apply: isBoolean, stale: optional(deletion), blobs: optional(deletion), archive: optional(archive), compress: optional(compress), wal: optional(wal) });

export function parseGcAnswer(raw: unknown, phases: readonly GcPhase[], apply: boolean): GcAnswer {
	if (!isAnswer(raw) || raw.apply !== apply || phases.some(phase => raw[phase] === undefined)) throw new Error("omp returned an incomplete cleanup report.");
	return raw;
}

async function gc(phases: readonly GcPhase[], apply: boolean): Promise<GcAnswer> {
	const { code, stdout, stderr } = await run([...ompCommand, "gc", "--json", ...phases.map(phase => `--${phase}`), ...(apply ? ["--apply"] : [])], { cwd: homedir(), child: true });
	const raw = parseJson(stdout);
	if (code !== 0 && raw === undefined) {
		if (stderr.includes("GC already running:")) throw new CleanupBusy();
		throw new Error(stderr.trim() || `omp cleanup exited ${code}`);
	}
	return parseGcAnswer(raw, phases, apply);
}
export const gcPreview = (): Promise<GcAnswer> => gc(GC_PHASES, false);
export const gcApply = (phase: GcPhase): Promise<GcAnswer> => gc([phase], true);

async function measure(label: string, path: string): Promise<StorageUsage["folders"][number]> {
	try {
		await stat(path);
		return { label, path, bytes: await allocatedUsage(path), error: null };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { label, path, bytes: 0, error: null };
		return { label, path, bytes: null, error: errorText(error) };
	}
}

export async function storageUsage(cwd: string | null): Promise<StorageUsage> {
	const folders = Promise.all([
		measure("Session files", dirs.getSessionsDir()),
		measure("Attachments", dirs.getBlobsDir()),
		measure("Isolation sandboxes", dirs.getWorktreesDir()),
	]);
	let rules: StorageUsage["rules"] = [];
	const overrides: string[] = [];
	let settingsError: string | null = null;
	try {
		const settings = await loadSessionSettings(cwd ?? homedir());
		const global = settings.getGlobalSettings();
		const project = cwd === null ? null : settings.getProjectSettings();
		rules = GC_RULES.map(({ id, label, hint, kind }) => {
			const handle = settingsRegistry.lookup(id);
			if (!handle) throw new Error(`omp has no storage rule ${id}.`);
			const { workspace, ...row } = rowOf({
				handle,
				fixed: {
					id, label, description: hint, default: handle.default, credential: false,
					control: kind === "toggle" ? { kind: "toggle" } : { kind: "number", min: 0 },
				},
			}, settings, global, project);
			if (workspace !== undefined) overrides.push(id);
			return row;
		});
	} catch (error) { settingsError = errorText(error); }
	let autoCompress: StorageUsage["autoCompress"] = null;
	const log = join(dirs.getAgentDir(), gcAutoCompress.GC_AUTO_COMPRESS_LOG);
	try {
		const [info, text] = await Promise.all([stat(log), Bun.file(log).text()]);
		autoCompress = { at: info.mtimeMs, text: text.slice(-4000) };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") autoCompress = { at: 0, text: errorText(error) };
	}
	return { folders: await folders, rules, overrides, settingsError, autoCompress };
}
