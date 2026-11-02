/**
 * Settings › omp memory: a workspace's omp memory as a session there would use it, and the edits the section saves.
 * Each edit is checked against what the page showed and answered with the memory as it now loads.
 */
import { isObject } from "./json";
import { loadSessionSettings } from "./omp/config";
import {
	autolearnSetting,
	backendSetting,
	clearStore,
	editMnemopiEntry,
	forgetMnemopiBanks,
	hindsightBankOf,
	hindsightRows,
	type MemoryFilePath,
	memoryFiles,
	mnemopiBanks,
	mnemopiRows,
	rebuildSummary,
	sessionPreview,
	sharpshooterQueued,
} from "./omp/memory";
import type { OmpSettingsInstance } from "./omp/module-types/config";
import { displayPath, HOME } from "./paths";
import { parseFileEdit, readFileBody, Rejected, serialized, writeUnchanged } from "./settings";
import type { OmpMemory, OmpMemoryBackendId, OmpMemoryEntryEdit, OmpMemoryFile, OmpMemoryStore } from "./shared/omp-memory";

const readFiles = (files: MemoryFilePath[]): Promise<OmpMemoryFile[]> =>
	Promise.all(files.map(async file => ({ ...file, pathDisplay: displayPath(file.path), body: await readFileBody(file.path) })));

async function storeOf(cwd: string, settings: OmpSettingsInstance, backend: OmpMemoryBackendId): Promise<OmpMemoryStore> {
	switch (backend) {
		case "off":
			return { backend };
		case "local":
			return { backend, files: await readFiles(await memoryFiles(cwd, backend)) };
		case "sharpshooter":
			return { backend, files: await readFiles(await memoryFiles(cwd, backend)), queued: await sharpshooterQueued(cwd) };
		case "mnemopi": {
			const { banks, sharedBank } = await mnemopiBanks(settings);
			return { backend, banks: banks.map(({ bank }) => bank), sharedBank, ...mnemopiRows(banks) };
		}
		case "hindsight": {
			const { bank, shared } = hindsightBankOf(cwd, settings);
			return { backend, bank, shared, ...(await hindsightRows(cwd, settings)) };
		}
	}
}

/** omp memory as a session in `cwd` uses it; without `cwd`, only the settings, since omp keeps memory per workspace. */
export async function loadOmpMemory(cwd: string | null): Promise<OmpMemory> {
	const settings = await loadSessionSettings(cwd ?? HOME);
	const backend = backendSetting(settings);
	return {
		backend,
		autolearn: autolearnSetting(settings),
		workspace: cwd === null ? null : { preview: await sessionPreview(cwd, settings), store: await storeOf(cwd, settings, backend.value) },
	};
}

/** The workspace an edit of the store names; omp has no store without one. */
function workspaceOf(cwd: string | null): string {
	if (cwd === null) throw new Rejected(400, "Expected ?cwd= naming a workspace: omp keeps memory per workspace");
	return cwd;
}

/** The backend in effect for `cwd`, refused unless it is one of `allowed`: the page showed another. */
async function backendIn<T extends OmpMemoryBackendId>(cwd: string, allowed: readonly T[]): Promise<{ settings: OmpSettingsInstance; backend: T }> {
	const settings = await loadSessionSettings(cwd);
	const backend = backendSetting(settings).value;
	if (!(allowed as readonly OmpMemoryBackendId[]).includes(backend)) throw new Rejected(409, "omp's memory backend changed since this page read it", true);
	return { settings, backend: backend as T };
}

/** `PUT /api/omp-memory/file`: writes a file of the store in effect, when it still holds what the page showed. */
export function saveMemoryFile(cwd: string | null, raw: unknown): Promise<OmpMemory> {
	return serialized(async () => {
		const dir = workspaceOf(cwd);
		const edit = parseFileEdit(raw);
		const { backend } = await backendIn(dir, ["local", "sharpshooter"] as const);
		const file = (await memoryFiles(dir, backend)).find(found => found.path === edit.path);
		if (!file) throw new Rejected(404, `omp memory has no ${displayPath(edit.path)} here`);
		await writeUnchanged(file.path, edit);
		return loadOmpMemory(dir);
	});
}

export function parseEntryEdit(raw: unknown): OmpMemoryEntryEdit {
	if (!isObject(raw) || typeof raw.bank !== "string" || typeof raw.id !== "string" || typeof raw.expected !== "string") {
		throw new Rejected(400, "Expected { op, bank, id, expected }");
	}
	const { bank, id, expected } = raw;
	if (raw.op === "update") {
		if (typeof raw.content !== "string" || raw.content.trim() === "") throw new Rejected(400, "Expected the memory's new text");
		return { op: "update", bank, id, expected, content: raw.content };
	}
	if (raw.op === "forget" || raw.op === "retire") return { op: raw.op, bank, id, expected };
	throw new Rejected(400, "Expected op to be update, forget, or retire");
}

/** `PUT /api/omp-memory/entry`: edits one Mnemopi row of a bank the workspace reads, when it still holds what the page showed. */
export function editMemoryEntry(cwd: string | null, raw: unknown): Promise<OmpMemory> {
	return serialized(async () => {
		const dir = workspaceOf(cwd);
		const edit = parseEntryEdit(raw);
		const { settings } = await backendIn(dir, ["mnemopi"] as const);
		const { config, banks } = await mnemopiBanks(settings);
		const bank = banks.find(({ bank }) => bank === edit.bank);
		if (!bank) throw new Rejected(404, `This workspace does not read the bank ${edit.bank}`);
		switch (await editMnemopiEntry(config, bank, edit)) {
			case "missing":
				throw new Rejected(409, "This memory is gone", true);
			case "changed":
				throw new Rejected(409, "This memory changed since this page read it", true);
			case "refused":
				throw new Rejected(400, `omp cannot ${edit.op} this memory`);
			case "done":
				return loadOmpMemory(dir);
		}
	});
}

/** The stores the page can forget; Hindsight's lives on its server. */
const CLEARABLE = ["local", "sharpshooter", "mnemopi"] as const;

/**
 * `PUT /api/omp-memory/clear`: forgets the workspace's store of `backend`, which must still be the one in effect. For
 * Mnemopi, only the workspace's own banks: the shared one stays, unlike omp's `/memory clear`.
 */
export function clearMemory(cwd: string | null, raw: unknown): Promise<OmpMemory> {
	return serialized(async () => {
		const dir = workspaceOf(cwd);
		if (!isObject(raw) || !CLEARABLE.includes(raw.backend as (typeof CLEARABLE)[number])) throw new Rejected(400, "Expected { backend } naming local, sharpshooter, or mnemopi");
		const { settings, backend } = await backendIn(dir, CLEARABLE);
		if (backend !== raw.backend) throw new Rejected(409, "omp's memory backend changed since this page read it", true);
		if (backend === "mnemopi") {
			const { banks, sharedBank } = await mnemopiBanks(settings);
			const own = banks.filter(({ bank }) => bank !== sharedBank);
			if (own.length === 0) throw new Rejected(400, "Every bank this workspace reads is shared with other workspaces");
			await forgetMnemopiBanks(own);
		} else await clearStore(dir, backend);
		return loadOmpMemory(dir);
	});
}

/** `PUT /api/omp-memory/rebuild`: marks the Local summary for a rebuild, which the next session in the workspace runs. */
export function rebuildMemory(cwd: string | null): Promise<OmpMemory> {
	return serialized(async () => {
		const dir = workspaceOf(cwd);
		await backendIn(dir, ["local"] as const);
		rebuildSummary(dir);
		return loadOmpMemory(dir);
	});
}
