/**
 * omp memory, read and changed with no session: the backend a session in a workspace resolves, what a new session's
 * prompt gets, and each backend's store, through omp's own modules. Validation is `src/memory.ts`'s.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { errorText, isObject } from "../json";
import type { OmpMemoryEntry, OmpMemoryEntryEdit, OmpMemoryEntryOp, OmpMemoryFileGroup, OmpMemoryRows } from "../shared/omp-memory";
import { agentDir } from "./config";
import type { OmpSettingsInstance } from "./module-types/config";
import type { HindsightConfig, MemoryBackend, MnemopiConfig, MnemopiExportRow, MnemopiMemory } from "./module-types/memory";
import {
	hindsightBank,
	hindsightClient,
	hindsightConfig,
	localMemory,
	memoryBackend,
	memoryRedact,
	mnemopiConfig,
	mnemopiState,
	sharpshooterPaths,
	sharpshooterQueue,
	sharpshooterTypes,
} from "./modules";

/** The most rows a row backend lists; the page says when there are more. */
export const ENTRY_LIMIT = 500;

/** The backend a session reading `settings` uses, as omp resolves it: Off for a value omp does not know. */
export const memoryBackendOf = (settings: OmpSettingsInstance): Promise<MemoryBackend> => memoryBackend.resolveMemoryBackend(settings);

/**
 * The memory block a new session in `cwd` gets in its system prompt, `null` for none. `partial` for the backends that add
 * recalled memories as the session runs, which a sessionless read cannot show.
 */
export async function sessionPreview(cwd: string, settings: OmpSettingsInstance, backend: MemoryBackend): Promise<{ text: string; partial: boolean } | null> {
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
	const [skills, rollouts] = await Promise.all([below("skills", "skills"), below("rollouts", "rollout_summaries")]);
	return [...fixed.filter(file => existsSync(file.path)), ...skills, ...rollouts];
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

/** Opens `bank` through omp's Mnemopi as omp's session does (`createMemory`, omp mnemopi/state.ts). */
async function openBank(config: MnemopiConfig, { dbPath, bank }: MnemopiBank): Promise<MnemopiMemory> {
	const { Mnemopi } = await mnemopiState.loadMnemopi();
	return new Mnemopi({
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
		// The page never migrates the bank's embeddings; a session does that when it opens the bank.
		reconcile: false,
	});
}

/**
 * The rows of one bank a session recalls, as omp's `get` sees them for the bank's own session: its working and episodic
 * rows and the global ones, from omp's `beam.exportToDict`, less those superseded or past their `valid_until`; and its
 * facts. omp lists no facts, so they are the one query of Mnemopi's tables here.
 */
async function bankRows(config: MnemopiConfig, bank: MnemopiBank): Promise<OmpMemoryEntry[]> {
	if (!existsSync(bank.dbPath)) return [];
	const memory = await openBank(config, bank);
	try {
		const now = Date.now();
		const { working_memory, episodic_memory } = memory.beam.exportToDict();
		const recalled = (kind: "working" | "episodic", rows: MnemopiExportRow[]): OmpMemoryEntry[] =>
			rows
				.filter(row => (row.session_id === bank.bank || row.scope === "global") && !row.superseded_by && !(row.valid_until !== null && Date.parse(row.valid_until) <= now))
				.map(row => ({ id: row.id, bank: bank.bank, content: row.content, at: row.timestamp, kind, ops: mnemopiOps(kind) }));
		const facts = memory.beam.db
			.query<{ id: string; subject: string; predicate: string; object: string; timestamp: string | null }, [string]>(
				"SELECT fact_id AS id, subject, predicate, object, timestamp FROM facts WHERE session_id = ?1",
			)
			.all(bank.bank)
			.map(fact => ({
				id: fact.id,
				bank: bank.bank,
				content: [fact.subject, fact.predicate, fact.object].filter(part => part).join(" "),
				at: fact.timestamp,
				kind: "fact" as const,
				ops: [],
			}));
		return [...recalled("working", working_memory), ...recalled("episodic", episodic_memory), ...facts];
	} finally {
		memory.close();
	}
}

/** At most {@link ENTRY_LIMIT} entries, newest first, and whether there were more. */
export function limitEntries(entries: OmpMemoryEntry[]): { entries: OmpMemoryEntry[]; truncated: boolean } {
	const sorted = entries.toSorted((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
	return { entries: sorted.slice(0, ENTRY_LIMIT), truncated: sorted.length > ENTRY_LIMIT };
}

export async function mnemopiRows(config: MnemopiConfig, banks: readonly MnemopiBank[]): Promise<OmpMemoryRows> {
	try {
		return limitEntries((await Promise.all(banks.map(bank => bankRows(config, bank)))).flat());
	} catch (err) {
		return { error: errorText(err) };
	}
}

/** What an entry edit did: done, the row is gone, it no longer holds what the page showed, or omp refuses the edit on it. */
export type EntryEditResult = "done" | "missing" | "changed" | "refused";

/**
 * Applies `edit` to its row through omp's Mnemopi, with the rules `MnemopiSessionState.editScopedMemory` applies: new
 * content redacted, facts read-only, working rows updated or forgotten, episodic rows only retired. An update re-embeds
 * the row as omp's does.
 */
export async function editMnemopiEntry(config: MnemopiConfig, bank: MnemopiBank, edit: OmpMemoryEntryEdit): Promise<EntryEditResult> {
	const memory = await openBank(config, bank);
	try {
		const row = memory.get(edit.id);
		if (!row) return "missing";
		if (row.content !== edit.expected) return "changed";
		if (!mnemopiOps(row.memory_store).includes(edit.op)) return "refused";
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

export async function hindsightRows(config: HindsightConfig, bank: string): Promise<OmpMemoryRows> {
	if (!hindsightConfig.isHindsightConfigured(config)) return { error: "omp has no Hindsight server address" };
	try {
		return limitEntries(hindsightEntries(await hindsightClient.createHindsightClient(config).listMemories(bank, { limit: ENTRY_LIMIT + 1 }), bank));
	} catch (err) {
		return { error: errorText(err) };
	}
}

/** Removes the databases of `banks`, as `mnemopiBackend.clear` removes its banks' (omp mnemopi/backend.ts), which needs a session to find them. */
export async function forgetMnemopiBanks(banks: readonly MnemopiBank[]): Promise<void> {
	for (const { dbPath } of banks) {
		for (const suffix of ["", "-wal", "-shm"]) await rm(`${dbPath}${suffix}`, { force: true });
	}
}
