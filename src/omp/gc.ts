/** Native gc runs and storage reads. Cleanup policy and locking stay in omp. */
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsedAnswer } from "../../templates/omp/agent/extensions/github/command";
import { arrayOf, fields, isBoolean, isNumber, isString, isTexts, optional, errorText } from "../json";
import { run } from "../proc";
import { GC_PHASES, GC_RULES, type GcAnswer, type GcPhase, type GcRule, type StorageUsage } from "../shared/storage";
import { allocatedUsage } from "../worktrees";
import { loadSessionSettings } from "./config";
import { userValue } from "./agent-settings";
import { ompCommand } from "./install";
import { dirs, gcAutoCompress, settingsRegistry } from "./modules";

const deletion = fields<NonNullable<GcAnswer["blobs"]>>({ wouldDelete: isNumber, deleted: isNumber, bytes: isNumber, errors: isTexts });
const archive = fields<NonNullable<GcAnswer["archive"]>>({ wouldArchive: isNumber, archived: isNumber, wouldDeleteTemps: isNumber, deletedTemps: isNumber, skippedActive: isNumber, keptNewestGlobal: isNumber, keptNewestPerCwd: isNumber, tempBytes: isNumber, errors: isTexts });
const compress = fields<NonNullable<GcAnswer["compress"]>>({ supported: isBoolean, probeFailure: optional(isString), wouldCompress: isNumber, compressed: isNumber, leftoverScratchDirs: isNumber, allocatedBefore: isNumber, allocatedAfter: isNumber, errors: isTexts });
const wal = fields<NonNullable<GcAnswer["wal"]>>({ databases: arrayOf(fields({ dbPath: isString, walBytes: isNumber, checkpointed: isBoolean, busy: isNumber })), walBytes: isNumber, checkpointed: isBoolean });
const isAnswer = fields<GcAnswer>({ apply: isBoolean, stale: optional(deletion), blobs: optional(deletion), archive: optional(archive), compress: optional(compress), wal: optional(wal) });

export class CleanupBusy extends Error {
	constructor() { super("Another cleanup is running. Try again when it ends."); }
}

export function parseGcAnswer(raw: unknown, phases: readonly GcPhase[], apply: boolean): GcAnswer {
	if (!isAnswer(raw) || raw.apply !== apply || phases.some(phase => raw[phase] === undefined)) throw new Error("omp returned an incomplete cleanup report.");
	return raw;
}

async function gc(phases: readonly GcPhase[], apply: boolean): Promise<GcAnswer> {
	const { code, stdout, stderr } = await run([...ompCommand, "gc", "--json", ...phases.map(phase => `--${phase}`), ...(apply ? ["--apply"] : [])], { cwd: homedir(), child: true });
	const raw = parsedAnswer(stdout);
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
	let rules: GcRule[] = [];
	let settingsError: string | null = null;
	try {
		const settings = await loadSessionSettings(homedir());
		const project = cwd === null ? null : (await loadSessionSettings(cwd)).getProjectSettings();
		const projectGc = project && typeof project.gc === "object" && project.gc !== null ? project.gc : {};
		rules = GC_RULES.map(({ id, kind }) => {
			const handle = settingsRegistry.lookup(id);
			if (!handle) throw new Error(`omp has no storage rule ${id}.`);
			const user = userValue(handle, settings);
			const value = user ?? handle.default;
			if (kind === "toggle" ? typeof value !== "boolean" : typeof value !== "number" || !Number.isFinite(value)) throw new Error(`The saved value for ${id} is invalid.`);
			const workspace = Reflect.get(projectGc, id.slice(3));
			return { id, user, value: value as boolean | number, ...(workspace != null ? { workspace } : {}) };
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
	return { folders: await folders, rules, settingsError, autoCompress };
}
