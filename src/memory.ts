/**
 * Settings › omp memory: a workspace's omp memory as a session there would use it, and the edits the section saves.
 * Each edit is checked against what the page showed and answered with the memory as it now loads.
 */
import { isObject } from "./json";
import { agentDir, loadSessionSettings } from "./omp/config";
import {
	editMnemopiEntry,
	forgetMnemopiBanks,
	hindsightBankOf,
	hindsightRows,
	type MemoryFilePath,
	memoryBackendOf,
	memoryFiles,
	mnemopiBanks,
	mnemopiRows,
	sessionPreview,
	sharpshooterQueued,
} from "./omp/memory";
import type { OmpSettingsInstance } from "./omp/module-types/config";
import type { MemoryBackend } from "./omp/module-types/memory";
import { displayPath } from "./paths";
import { parseFileEdit, readFileBody, Rejected, serialized, writeUnchanged } from "./settings";
import { isOmpMemoryClearable, type OmpMemory, type OmpMemoryClear, type OmpMemoryEntryEdit, type OmpMemoryFile, type OmpMemoryStore } from "./shared/omp-memory";

const readFiles = (files: MemoryFilePath[]): Promise<OmpMemoryFile[]> =>
	Promise.all(files.map(async file => ({ ...file, pathDisplay: displayPath(file.path), body: await readFileBody(file.path) })));

async function storeOf(cwd: string, settings: OmpSettingsInstance, backend: MemoryBackend["id"]): Promise<OmpMemoryStore> {
	switch (backend) {
		case "off":
			return { backend };
		case "local":
			return { backend, files: await readFiles(await memoryFiles(cwd, backend)) };
		case "sharpshooter": {
			const [files, queued] = await Promise.all([memoryFiles(cwd, backend).then(readFiles), sharpshooterQueued(cwd)]);
			return { backend, files, queued };
		}
		case "mnemopi": {
			const { config, banks, sharedBank } = await mnemopiBanks(settings);
			return { backend, banks: banks.map(({ bank }) => bank), sharedBank, ...(await mnemopiRows(config, banks)) };
		}
		case "hindsight": {
			const { bank, shared, config } = hindsightBankOf(cwd, settings);
			return { backend, bank, shared, ...(await hindsightRows(config, bank)) };
		}
		default:
			// A backend omp added after this page: its store has no shape here yet.
			throw new Error(`omp's ${String(backend satisfies never)} memory backend is not one this page can show yet`);
	}
}

/** The workspace an edit of the store names; omp keeps memory per workspace. */
function workspaceOf(cwd: string | null): string {
	if (cwd === null) throw new Rejected(400, "Expected ?cwd= naming a workspace: omp keeps memory per workspace");
	return cwd;
}

/** The settings a session in `cwd` loads, and the memory backend it resolves from them. */
async function inEffect(cwd: string): Promise<{ settings: OmpSettingsInstance; backend: MemoryBackend }> {
	const settings = await loadSessionSettings(cwd);
	return { settings, backend: await memoryBackendOf(settings) };
}

/** `GET /api/omp-memory?cwd=`: what a new session in `cwd` gets, and the store of the backend it resolves. */
export async function loadOmpMemory(cwd: string): Promise<OmpMemory> {
	const { settings, backend } = await inEffect(cwd);
	const [preview, store] = await Promise.all([sessionPreview(cwd, settings, backend), storeOf(cwd, settings, backend.id)]);
	return { preview, store };
}

/** The page showed another backend than the one in effect now. */
const backendChanged = (): Rejected => new Rejected(409, "omp's memory backend changed since this page read it", true);

/** `PUT /api/omp-memory/file`: writes a file of the store in effect, when it still holds what the page showed. */
export function saveMemoryFile(cwd: string | null, raw: unknown): Promise<OmpMemory> {
	return serialized(async () => {
		const dir = workspaceOf(cwd);
		const edit = parseFileEdit(raw);
		const { backend } = await inEffect(dir);
		if (backend.id !== "local" && backend.id !== "sharpshooter") throw backendChanged();
		const file = (await memoryFiles(dir, backend.id)).find(found => found.path === edit.path);
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
		const { settings, backend } = await inEffect(dir);
		if (backend.id !== "mnemopi") throw backendChanged();
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

export function parseClear(raw: unknown): OmpMemoryClear {
	if (!isObject(raw) || !isOmpMemoryClearable(raw.backend)) throw new Rejected(400, "Expected { backend } naming local, sharpshooter, or mnemopi");
	return { backend: raw.backend };
}

/**
 * `PUT /api/omp-memory/clear`: forgets the workspace's store of `backend`, which must still be the one in effect: Local
 * and Sharpshooter as omp's `/memory clear` does, Mnemopi only the workspace's own banks, so the shared one stays.
 */
export function clearMemory(cwd: string | null, raw: unknown): Promise<OmpMemory> {
	return serialized(async () => {
		const dir = workspaceOf(cwd);
		const edit = parseClear(raw);
		const { settings, backend } = await inEffect(dir);
		if (backend.id !== edit.backend) throw backendChanged();
		if (backend.id === "mnemopi") {
			const { banks, sharedBank } = await mnemopiBanks(settings);
			const own = banks.filter(({ bank }) => bank !== sharedBank);
			if (own.length === 0) throw new Rejected(400, "Every bank this workspace reads is shared with other workspaces");
			await forgetMnemopiBanks(own);
		} else await backend.clear(agentDir, dir);
		return loadOmpMemory(dir);
	});
}

/** `PUT /api/omp-memory/rebuild`: marks the Local summary for a rebuild, which the next session in the workspace runs. */
export function rebuildMemory(cwd: string | null): Promise<OmpMemory> {
	return serialized(async () => {
		const dir = workspaceOf(cwd);
		const { backend } = await inEffect(dir);
		if (backend.id !== "local") throw backendChanged();
		await backend.enqueue(agentDir, dir);
		return loadOmpMemory(dir);
	});
}
