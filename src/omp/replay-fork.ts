import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, rebuildRequests, sha256, type RebuiltRequest } from "../../templates/omp/agent/extensions/replay/request-log-reader";
import { containsPrompt } from "../../templates/omp/agent/extensions/replay/replay-check";
import type { PromptImage } from "../shared/sessions";
import { isObject } from "../json";
import { exitDiagnostics, loader, sessionManager, transcriptEntry } from "./modules";
import type { OmpSessionManager } from "./modules";
import { blobsDir } from "./config";
import { type ModelOption, modelOfSelector } from "../shared/models";
import type { ReplayMarker } from "../shared/replay";
import { Trajectory } from "../trajectory";

interface NativeCut {
	manager: OmpSessionManager;
	prompt: { type: string; id: string; parentId?: string | null } & Record<string, unknown>;
	before: ({ type: string; id: string; parentId?: string | null } & Record<string, unknown>)[];
	text: string;
	images: PromptImage[];
	cwd: string;
	sessionId: string;
	at: number;
}

export interface PromptCut {
	text: string;
	images: PromptImage[];
	cwd: string;
	sessionId: string;
	at: number;
	ancestry: string;
	model: ModelOption | null;
	thinking: string | null;
	repaired: boolean;
	freezeOriginal(): Pick<ReplayMarker, "originalTurnRef" | "original">;
	fork(cwd: string, marker: unknown): Promise<{ file: string; repaired: boolean }>;
	close(): Promise<void>;
}

export async function openPromptCut(file: string, entryId: string): Promise<PromptCut> {
	const manager = await sessionManager.SessionManager.open(file, undefined, undefined, { suppressBreadcrumb: true, throwIfMissing: true });
	try {
		const prompt = manager.getEntry(entryId);
		if (!prompt || prompt.type !== "message" && prompt.type !== "custom_message") throw new Error("This turn has no prompt to replay.");
		const text = transcriptEntry.userTurnDraft(prompt);
		if (text === undefined || text.startsWith("!")) throw new Error("This turn has no prompt to replay.");
		const content = isObject(prompt.message) ? prompt.message.content : prompt.content;
		const images: PromptImage[] = transcriptEntry.imageContent(content).map(image => ({ mimeType: image.mimeType, data: image.data }));
		const imageCount = Array.isArray(content) ? content.filter(block => isObject(block) && block.type === "image").length : 0;
		if (images.length !== imageCount || images.some(image => !image.data || image.data.startsWith("blob:"))) throw new Error("A prompt image is missing from omp's blob store.");
		const before = prompt.parentId ? manager.getBranch(prompt.parentId) : [];
		const cut: NativeCut = { manager, prompt, before, text, images, cwd: String(manager.getHeader()?.cwd ?? manager.getCwd()), sessionId: manager.getSessionId(), at: Date.parse(String(prompt.timestamp)) };
		const request = originalRequest(cut);
		const repairs = exitDiagnostics.createInterruptedToolResults(before, "fork");
		return {
			text, images, cwd: cut.cwd, sessionId: cut.sessionId, at: cut.at,
			ancestry: sha256(canonicalJson([manager.getHeader(), ...before, prompt])),
			...originalSettings(cut, request),
			repaired: repairs.length !== 0,
			freezeOriginal() {
				const trajectory = new Trajectory(true);
				for (const entry of manager.getEntries()) trajectory.applyEntry(entry);
				const originalTurn = trajectory.turns().find(turn => turn.id === entryId);
				if (!originalTurn) throw new Error("The original turn is not a replayable trajectory prompt.");
				const originalTurnRef = manager.putBlobSync(Buffer.from(JSON.stringify(originalTurn))).ref;
				const bodyRef = request?.body && request.hash === request.record.requestHash ? manager.putBlobSync(Buffer.from(canonicalJson(request.body))).ref : null;
				return { originalTurnRef, original: request && bodyRef ? { api: request.record.api, model: request.record.model, hash: request.record.requestHash, bodyRef } : null };
			},
			fork: (cwd, marker) => writePromptFork(manager, prompt.parentId ?? null, cwd, marker, repairs),
			close: () => manager.close(),
		};
	} catch (error) {
		await manager.close();
		throw error;
	}
}

async function writePromptFork(manager: OmpSessionManager, parentId: string | null, cwd: string, marker: unknown, repairs: object[]): Promise<{ file: string; repaired: boolean }> {
	if (parentId) manager.createBranchedSession(parentId, { copyArtifacts: true });
	else await manager.newSession();
	const created = manager.getSessionFile();
	try {
		for (const result of repairs) manager.appendMessage(result);
		await manager.moveTo(cwd);
		await manager.setAdditionalDirectories([]);
		manager.appendCustomEntry("omp-agents-replay", marker);
		await manager.flush();
		const file = manager.getSessionFile();
		if (!file) throw new Error("omp did not create a replay session file.");
		await manager.close();
		return { file, repaired: repairs.length !== 0 };
	} catch (error) {
		// A half-written fork would otherwise appear among past sessions.
		for (const file of new Set([created, manager.getSessionFile()])) if (file) await rm(file, { force: true });
		throw error;
	}
}
function originalRequest(cut: NativeCut): RebuiltRequest | null {
	const entries = cut.manager.getEntries();
	const start = entries.findIndex(entry => entry.id === cut.prompt.id);
	const boundary = entries.slice(start + 1).findIndex(entry => transcriptEntry.userTurnDraft(entry) !== undefined);
	const after = entries.slice(start + 1, boundary < 0 ? undefined : start + 1 + boundary);
	const assistant = after.find(entry => entry.type === "message" && isObject(entry.message) && entry.message.role === "assistant");
	if (!assistant || !isObject(assistant.message)) return null;
	const assistantMessage = assistant.message;
	const content = isObject(cut.prompt.message) ? cut.prompt.message.content : cut.prompt.content;
	const candidates = after.slice(0, after.indexOf(assistant)).filter(entry => entry.type === "custom" && entry.customType === "omp-request-log.record" && isObject(entry.data) && entry.data.model === assistantMessage.model && typeof entry.data.leafId === "string" && cut.manager.getBranch(entry.data.leafId).some(parent => parent.id === cut.prompt.id));
	const rebuilt = rebuildRequests(entries.map(entry => JSON.stringify(entry)).join("\n"), hash => readFileSync(join(blobsDir, hash), "utf8"));
	const main = candidates.flatMap(entry => {
		const data = entry.data;
		if (!isObject(data)) return [];
		const request = rebuilt.find(request => request.record.requestHash === data.requestHash && request.record.leafId === data.leafId);
		return request?.body && containsPrompt(request.body, content) ? [request] : [];
	});
	return main.length === 1 ? main[0]! : null;
}
function originalSettings(cut: NativeCut, request: RebuiltRequest | null): { model: ModelOption | null; thinking: string | null } {
	let selector: string | null = null;
	let thinking: string | null = null;
	for (const entry of cut.before) {
		if (entry.type === "model_change" && (!entry.role || entry.role === "default") && typeof entry.model === "string") selector = entry.model;
		if (entry.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") thinking = entry.thinkingLevel;
	}
	return { model: request?.record.provider && request.record.model ? { provider: request.record.provider, id: request.record.model } : selector ? modelOfSelector(selector) : null, thinking: request?.record.thinkingLevel ?? thinking };
}
export function readReplayBlob(ref: string): unknown {
	if (!/^blob:sha256:[a-f0-9]{64}$/.test(ref)) throw new Error("Replay data has an invalid blob reference.");
	return JSON.parse(readFileSync(join(blobsDir, ref.slice("blob:sha256:".length)), "utf8"));
}

export async function readReplaySession(file: string): Promise<{
	entries: Record<string, unknown>[];
	requestFor(turnId: string | null, hash: string): RebuiltRequest | null;
}> {
	const entries = await loader.loadEntriesFromFile(file);
	const requests = rebuildRequests(entries.map(entry => JSON.stringify(entry)).join("\n"), hash => readFileSync(join(blobsDir, hash), "utf8"));
	return {
		entries,
		requestFor(turnId, hash) {
			const targetAt = entries.findIndex(entry => entry.id === turnId);
			const logged = targetAt >= 0 && entries.slice(targetAt + 1).some(entry => entry.type === "custom" && entry.customType === "omp-request-log.record" && isObject(entry.data) && entry.data.requestHash === hash);
			return logged ? requests.find(request => request.record.requestHash === hash && request.hash === hash) ?? null : null;
		},
	};
}
