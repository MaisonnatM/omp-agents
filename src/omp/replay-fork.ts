import type { PromptImage } from "../shared/sessions";
import { isObject } from "../json";
import { exitDiagnostics, sessionManager, transcriptEntry } from "./modules";
import type { OmpSessionManager } from "./modules";

export interface PromptCut {
	manager: OmpSessionManager;
	prompt: { type: string; id: string; parentId?: string | null } & Record<string, unknown>;
	before: ({ type: string; id: string; parentId?: string | null } & Record<string, unknown>)[];
	text: string;
	images: PromptImage[];
	cwd: string;
	sessionId: string;
	at: number;
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
		return { manager, prompt, before, text, images, cwd: String(manager.getHeader()?.cwd ?? manager.getCwd()), sessionId: manager.getSessionId(), at: Date.parse(String(prompt.timestamp)) };
	} catch (error) {
		await manager.close();
		throw error;
	}
}

export async function writePromptFork(manager: OmpSessionManager, parentId: string | null, cwd: string, marker: unknown): Promise<{ file: string; repaired: boolean }> {
	if (parentId) manager.createBranchedSession(parentId, { copyArtifacts: true });
	else await manager.newSession();
	const repairs = exitDiagnostics.createInterruptedToolResults(manager.getEntries(), "fork");
	for (const result of repairs) manager.appendMessage(result);
	await manager.moveTo(cwd);
	await manager.setAdditionalDirectories([]);
	manager.appendCustomEntry("omp-agents-replay", marker);
	await manager.flush();
	const file = manager.getSessionFile();
	if (!file) throw new Error("omp did not create a replay session file.");
	await manager.close();
	return { file, repaired: repairs.length !== 0 };
}
