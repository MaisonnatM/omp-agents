/**
 * omp memory, read and changed with no session: the backend and Auto-learn as a session in a workspace reads them, what a
 * new session's prompt gets, and each backend's store, through omp's own modules. Validation is `src/memory.ts`'s.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { errorText, isObject } from "../json";
import type {
	OmpMemoryBackendId,
	OmpMemoryBackendOption,
	OmpMemoryEntry,
	OmpMemoryEntryEdit,
	OmpMemoryEntryOp,
	OmpMemoryFileGroup,
	OmpMemoryRows,
	OmpMemorySetting,
	OmpMemorySource,
} from "../shared/omp-memory";
import { OMP_MEMORY_BACKENDS } from "../shared/omp-memory";
import { agentSetting, userValue } from "./agent-settings";
import { agentDir } from "./config";
import { ompVersion } from "./install";
import type { OmpSettingsInstance, SettingHandle, SettingsReader } from "./module-types/config";
import type { HindsightConfig, MnemopiConfig } from "./module-types/memory";
import {
	autolearnSettings,
	hindsightBank,
	hindsightClient,
	hindsightConfig,
	localMemory,
	memoryBackend,
	memoryBackendSettings,
	memoryRedact,
	mnemopiConfig,
	mnemopiState,
	sharpshooterBackend,
	sharpshooterPaths,
	sharpshooterQueue,
	sharpshooterTypes,
} from "./modules";

/** The settings this section edits; Settings › omp settings hands each of them here. */
export const MEMORY_SETTING_IDS = { backend: "memory.backend", autolearn: "autolearn.enabled", autoContinue: "autolearn.autoContinue" } as const;

/** The most rows a row backend lists; the page says when there are more. */
export const ENTRY_LIMIT = 500;

const isBackendId = (value: unknown): value is OmpMemoryBackendId => OMP_MEMORY_BACKENDS.includes(value as OmpMemoryBackendId);

function handleOf(id: string): SettingHandle {
	const handle = agentSetting(id);
	if (!handle) throw new Error(`omp ${ompVersion} has no setting ${id}`);
	return handle;
}

function sourceOf(handle: SettingHandle, settings: OmpSettingsInstance): OmpMemorySource {
	switch (handle.provenance(settings)) {
		case "env":
			return { layer: "env", variable: handle.envName ?? "" };
		case "project":
			return { layer: "workspace" };
		case "global":
			return { layer: "user" };
		default:
			return { layer: "default" };
	}
}

/** A setting as a session reads it; a value this page does not know is refused, since a control could not show it. */
function settingOf<T>(id: string, reader: SettingsReader<unknown>, settings: OmpSettingsInstance, valid: (value: unknown) => value is T): OmpMemorySetting<T> {
	const handle = handleOf(id);
	const value = reader.get(settings);
	if (!valid(value)) throw new Error(`omp ${ompVersion} reads ${id} as ${JSON.stringify(value)}, which this page does not know`);
	const user = userValue(handle, settings);
	return { value, source: sourceOf(handle, settings), user: valid(user) ? user : null };
}

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** The backend in effect and the picker's choices, labeled and described as omp's settings panel does. */
export function backendSetting(settings: OmpSettingsInstance): OmpMemorySetting<OmpMemoryBackendId> & { options: OmpMemoryBackendOption[] } {
	const options = handleOf(MEMORY_SETTING_IDS.backend).ui?.options;
	return {
		...settingOf(MEMORY_SETTING_IDS.backend, memoryBackendSettings.cfgMemoryBackend, settings, isBackendId),
		options: Array.isArray(options)
			? options.flatMap(({ value, label, description }) => (isBackendId(value) ? [{ value, label, description: description ?? "" }] : []))
			: OMP_MEMORY_BACKENDS.map(value => ({ value, label: value, description: "" })),
	};
}

export function autolearnSetting(settings: OmpSettingsInstance): { enabled: OmpMemorySetting<boolean>; autoContinue: OmpMemorySetting<boolean> } {
	return {
		enabled: settingOf(MEMORY_SETTING_IDS.autolearn, autolearnSettings.cfgAutolearnEnabled, settings, isBoolean),
		autoContinue: settingOf(MEMORY_SETTING_IDS.autoContinue, autolearnSettings.cfgAutolearnAutoContinue, settings, isBoolean),
	};
}

/**
 * The memory block a new session in `cwd` gets in its system prompt, `null` for none. `partial` for the backends that add
 * recalled memories as the session runs, which a sessionless read cannot show.
 */
export async function sessionPreview(cwd: string, settings: OmpSettingsInstance): Promise<{ text: string; partial: boolean } | null> {
	const backend = await memoryBackend.resolveMemoryBackend(settings);
	const text = (await backend.buildDeveloperInstructions(agentDir, cwd, settings))?.trim();
	return text ? { text, partial: backend.id === "mnemopi" || backend.id === "hindsight" } : null;
}

/** Every file below `dir`, by its path within it, sorted; none when `dir` is not there. */
async function filesBelow(dir: string): Promise<string[]> {
	if (!existsSync(dir)) return [];
	return (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dir, onlyFiles: true }))).sort();
}

/** A file of a file backend's store; `name` is its path within the store. */
export interface MemoryFilePath {
	group: OmpMemoryFileGroup;
	name: string;
	path: string;
}

/**
 * The files of `backend`'s store for `cwd`, those that exist. Local keeps lessons, the summary omp injects and the
 * longer one beside it, consolidated skills, and one summary per summarized session; Sharpshooter its decision files.
 */
export async function memoryFiles(cwd: string, backend: "local" | "sharpshooter"): Promise<MemoryFilePath[]> {
	if (backend === "sharpshooter") {
		const dir = sharpshooterPaths.sharpshooterBankDir(agentDir, cwd);
		return sharpshooterTypes.SHARPSHOOTER_MEMORY_FILES.map(name => ({ group: "decisions" as const, name, path: join(dir, name) })).filter(file => existsSync(file.path));
	}
	const root = localMemory.getMemoryRoot(agentDir, cwd);
	const fixed: MemoryFilePath[] = [
		{ group: "lessons", name: "learned.md", path: join(root, "learned.md") },
		{ group: "summary", name: "memory_summary.md", path: join(root, "memory_summary.md") },
		{ group: "summary", name: "MEMORY.md", path: join(root, "MEMORY.md") },
	];
	const below = async (group: OmpMemoryFileGroup, dir: string): Promise<MemoryFilePath[]> =>
		(await filesBelow(join(root, dir))).map(name => ({ group, name, path: join(root, dir, name) }));
	return [...fixed.filter(file => existsSync(file.path)), ...(await below("skills", "skills")), ...(await below("rollouts", "rollout_summaries"))];
}

export const sharpshooterQueued = (cwd: string): Promise<number> => sharpshooterQueue.sharpshooterQueueDepth(agentDir, cwd);

/** One Mnemopi bank a session in the workspace reads, and its database. */
export interface MnemopiBank {
	bank: string;
	dbPath: string;
}

/**
 * The Mnemopi banks a session in `settings`' workspace recalls from and edits: its retain bank, its recall banks, and
 * the shared bank under `per-project-tagged` (`MnemopiSessionState.editScopedMemory`, omp mnemopi/state.ts).
 * `sharedBank`: the one of them every workspace reads, `null` for none.
 */
export async function mnemopiBanks(settings: OmpSettingsInstance): Promise<{ config: MnemopiConfig; banks: MnemopiBank[]; sharedBank: string | null }> {
	const config = mnemopiConfig.loadMnemopiConfig(settings, agentDir);
	await mnemopiState.loadMnemopiCore();
	const paths = mnemopiState.getMnemopiScopedDbPaths(config);
	const read = new Set([config.retainBank, ...config.recallBanks, ...(config.scoping === "per-project-tagged" ? [config.globalBank] : [])]);
	const banks = mnemopiState.getMnemopiScopedBanks(config).flatMap((bank, index) => (read.has(bank) && paths[index] ? [{ bank, dbPath: paths[index] }] : []));
	return { config, banks, sharedBank: read.has(config.globalBank) ? config.globalBank : null };
}

/** The edits omp allows on a row of each Mnemopi table: facts are read-only, episodic rows can only be retired. */
export function mnemopiOps(kind: OmpMemoryEntry["kind"]): OmpMemoryEntryOp[] {
	return kind === "working" ? ["update", "forget"] : kind === "episodic" ? ["retire"] : [];
}

/** Whether a row recall still uses: not superseded and not past its `valid_until`. */
const live = (row: { valid_until: string | null; superseded_by: string | null }, now: number): boolean =>
	!row.superseded_by && (row.valid_until === null || !(Date.parse(row.valid_until) <= now));

/**
 * The live rows of one bank's database, newest first, at most `limit` of each table, read-only. The visibility rules
 * are the ones omp's `getContext` and `get` apply for a bank's own session (pi-mnemopi src/core/beam/store.ts).
 */
function bankRows({ bank, dbPath }: MnemopiBank, limit: number): OmpMemoryEntry[] {
	if (!existsSync(dbPath)) return [];
	const db = new Database(dbPath, { readonly: true });
	try {
		const now = Date.now();
		type Row = { id: string; content: string; timestamp: string | null; valid_until: string | null; superseded_by: string | null };
		const rows = (kind: "working" | "episodic", sql: string): OmpMemoryEntry[] =>
			db
				.query<Row, [string, number]>(sql)
				.all(bank, limit)
				.filter(row => live(row, now))
				.map(row => ({ id: row.id, bank, content: row.content, at: row.timestamp, kind, ops: mnemopiOps(kind) }));
		const facts = db
			.query<{ id: string; subject: string; predicate: string; object: string; timestamp: string | null }, [string, number]>(
				"SELECT fact_id AS id, subject, predicate, object, timestamp FROM facts WHERE session_id = ?1 ORDER BY timestamp DESC LIMIT ?2",
			)
			.all(bank, limit)
			.map(fact => ({
				id: fact.id,
				bank,
				content: [fact.subject, fact.predicate, fact.object].filter(part => part).join(" "),
				at: fact.timestamp,
				kind: "fact" as const,
				ops: [],
			}));
		const columns = "id, content, timestamp, valid_until, superseded_by";
		return [
			...rows("working", `SELECT ${columns} FROM working_memory WHERE session_id = ?1 OR scope = 'global' ORDER BY timestamp DESC LIMIT ?2`),
			...rows("episodic", `SELECT ${columns} FROM episodic_memory WHERE session_id = ?1 OR scope = 'global' ORDER BY timestamp DESC LIMIT ?2`),
			...facts,
		];
	} finally {
		db.close();
	}
}

/** At most {@link ENTRY_LIMIT} entries, newest first, and whether there were more. */
export function limitEntries(entries: OmpMemoryEntry[]): { entries: OmpMemoryEntry[]; truncated: boolean } {
	const sorted = entries.toSorted((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
	return { entries: sorted.slice(0, ENTRY_LIMIT), truncated: sorted.length > ENTRY_LIMIT };
}

export function mnemopiRows(banks: readonly MnemopiBank[]): OmpMemoryRows {
	try {
		return limitEntries(banks.flatMap(bank => bankRows(bank, ENTRY_LIMIT + 1)));
	} catch (err) {
		return { error: errorText(err) };
	}
}

/** What an entry edit did: done, the row is gone, it no longer holds what the page showed, or omp refuses the edit on it. */
export type EntryEditResult = "done" | "missing" | "changed" | "refused";

/**
 * Applies `edit` to its row through omp's Mnemopi, opened on the bank as omp's session opens it (`createMemory`, omp
 * mnemopi/state.ts), and with the rules `MnemopiSessionState.editScopedMemory` applies: new content redacted, facts
 * read-only, working rows updated or forgotten, episodic rows only retired. An update re-embeds the row as omp's does.
 */
export async function editMnemopiEntry(config: MnemopiConfig, { dbPath, bank }: MnemopiBank, edit: OmpMemoryEntryEdit): Promise<EntryEditResult> {
	const { Mnemopi } = await mnemopiState.loadMnemopi();
	const memory = new Mnemopi({
		dbPath,
		bank,
		sessionId: bank,
		authorId: "coding-agent",
		authorType: "agent",
		channelId: bank,
		...config.providerOptions,
		proactiveLinking: config.proactiveLinking,
		polyphonicRecall: config.polyphonicRecall,
		enhancedRecall: config.enhancedRecall,
		// An edit never migrates the bank's embeddings; a session does that when it opens the bank.
		reconcile: false,
	});
	try {
		const row = memory.get(edit.id);
		if (!row) return "missing";
		if (row.content !== edit.expected) return "changed";
		const kind = row.memory_store === "episodic" || row.memory_store === "fact" ? row.memory_store : "working";
		if (!mnemopiOps(kind).includes(edit.op)) return "refused";
		const applied =
			edit.op === "update"
				? memory.update(edit.id, memoryRedact.redactMemorySecrets(edit.content))
				: edit.op === "forget"
					? memory.forget(edit.id)
					: memory.beam.invalidate(edit.id, null);
		if (!applied) return "changed";
		await memory.flushExtractions();
		return "done";
	} finally {
		memory.close();
	}
}

/** The Hindsight bank a session in `cwd` uses, and whether other workspaces' sessions use it too. */
export function hindsightBankOf(cwd: string, settings: OmpSettingsInstance): { bank: string; shared: boolean; config: HindsightConfig } {
	const config = hindsightConfig.loadHindsightConfig(settings);
	return { bank: hindsightBank.computeBankScope(config, cwd).bankId, shared: config.scoping !== "per-project", config };
}

/**
 * The memories a Hindsight server answers for `bank`. omp types the answer as an open record, so its shape is the
 * server's: `items`, each with a string `id` and `text`. An answer without them is refused, not shown as empty.
 */
export function hindsightEntries(answer: unknown, bank: string): OmpMemoryEntry[] {
	if (!isObject(answer) || !Array.isArray(answer.items)) throw new Error("The Hindsight server answered without a list of memories");
	return answer.items.flatMap(item => {
		if (!isObject(item) || typeof item.id !== "string" || typeof item.text !== "string") return [];
		const at = [item.mentioned_at, item.occurred_start, item.date].find(value => typeof value === "string");
		return [{ id: item.id, bank, content: item.text, at: typeof at === "string" ? at : null, kind: "remote" as const, ops: [] }];
	});
}

export async function hindsightRows(cwd: string, settings: OmpSettingsInstance): Promise<OmpMemoryRows> {
	const { bank, config } = hindsightBankOf(cwd, settings);
	if (!hindsightConfig.isHindsightConfigured(config)) return { error: "omp has no Hindsight server address" };
	try {
		return limitEntries(hindsightEntries(await hindsightClient.createHindsightClient(config).listMemories(bank, { limit: ENTRY_LIMIT + 1 }), bank));
	} catch (err) {
		return { error: errorText(err) };
	}
}

/** Forgets the workspace's Local or Sharpshooter store as omp's `/memory clear` does. */
export function clearStore(cwd: string, backend: "local" | "sharpshooter"): Promise<void> {
	return backend === "local" ? localMemory.clearMemoryData(agentDir, cwd) : sharpshooterBackend.sharpshooterBackend.clear(agentDir, cwd);
}

/** Removes the databases of `banks`, as `mnemopiBackend.clear` removes its banks' (omp mnemopi/backend.ts), which needs a session to find them. */
export async function forgetMnemopiBanks(banks: readonly MnemopiBank[]): Promise<void> {
	for (const { dbPath } of banks) {
		for (const suffix of ["", "-wal", "-shm"]) await rm(`${dbPath}${suffix}`, { force: true });
	}
}

/** Marks the Local summary for a rebuild, which the next session in `cwd` runs as it starts. */
export const rebuildSummary = (cwd: string): void => localMemory.enqueueMemoryConsolidation(agentDir, cwd);
