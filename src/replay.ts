import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { canonical, git, worktreeAt, worktreesOf } from "./git";
import { isObject } from "./json";
import { openPromptCut, readReplayBlob, readReplaySession } from "./omp/replay-fork";
import { writeReplayConfig } from "./omp/replay-launch";
import { REPLAY_CHECK, REPLAY_MARKER, replayMarkerOf, requestCheckOf } from "./shared/replay";
import type { ReplayComparison, ReplayDetail, ReplayFacts, ReplayMarker } from "./shared/replay";
import type { ModelOption } from "./shared/models";
import type { Turn } from "./shared/trajectory";
import { Trajectory } from "./trajectory";

const tokenKey = randomBytes(32);
interface SourcePin { file: string; sessionId: string; entryId: string; ancestry: string }
function sign(pin: SourcePin): string {
	const body = Buffer.from(JSON.stringify(pin)).toString("base64url");
	return `${body}.${createHmac("sha256", tokenKey).update(body).digest("base64url")}`;
}
function readPin(token: string): SourcePin {
	const [body, signature] = token.split(".");
	if (!body || !signature) throw new Error("This replay selection has expired. Open Replay from here again.");
	const expected = createHmac("sha256", tokenKey).update(body).digest();
	const received = Buffer.from(signature, "base64url");
	if (received.length !== expected.length || !timingSafeEqual(expected, received)) throw new Error("This replay selection has expired. Open Replay from here again.");
	return JSON.parse(Buffer.from(body, "base64url").toString()) as SourcePin;
}
// omp records its launch cwd without macOS's `/private` prefix and refuses to open a session whose header names another spelling.
async function ompSpelling(path: string): Promise<string> {
	if (process.platform !== "darwin" || !path.startsWith("/private/")) return path;
	const stripped = path.slice("/private".length);
	await mkdir(path, { recursive: true });
	const same = await Promise.all([canonical(stripped), canonical(path)]).then(([a, b]) => a === b, () => false);
	return same ? stripped : path;
}
export async function replayDetail(file: string, entryId: string): Promise<ReplayDetail> {
	const cut = await openPromptCut(file, entryId);
	try {
		const pin: SourcePin = { file, sessionId: cut.sessionId, entryId, ancestry: cut.ancestry };
		return { token: sign(pin), sessionId: cut.sessionId, cwd: cut.cwd, prompt: cut.text, images: cut.images, model: cut.model, thinking: cut.thinking };
	} finally { await cut.close(); }
}
export interface PreparedReplay {
	marker: ReplayMarker;
	forkFile: string;
	cwd: string;
	config: string;
	first: { text: string; images: ReplayDetail["images"] };
	discard(): Promise<void>;
}
export async function prepareReplay(choice: { token: string; model: ModelOption | null; thinking: string | null; prompt: string | null }, sourceFile: string, mayDiscard: (cwd: string) => Promise<string | null>): Promise<PreparedReplay> {
	const pin = readPin(choice.token);
	if (pin.file !== sourceFile) throw new Error("The selected source file changed. Open Replay from here again.");
	const cut = await openPromptCut(pin.file, pin.entryId);
	let owned: string | null = null;
	let forkFile: string | null = null;
	let config: string | null = null;
	const discard = async () => {
		if (owned) {
			const blocker = await mayDiscard(owned);
			if (blocker) throw new Error(`The failed replay checkout was kept at ${owned}: ${blocker}`);
			await git(cut.cwd, "worktree", "remove", "--", owned);
			owned = null;
		}
		if (forkFile) await rm(forkFile, { force: true });
		if (config) await rm(config, { force: true });
	};
	try {
		if (pin.sessionId !== cut.sessionId || pin.ancestry !== cut.ancestry) throw new Error("The selected prompt or its history changed. Open Replay from here again.");
		const firstText = choice.prompt ?? cut.text;
		if (firstText.trimStart().startsWith("!") || /^\/(?!skill:)/.test(firstText.trimStart())) throw new Error("Replay needs a model prompt, not a shell or local slash command. Use text or /skill:<name>.");
		if (!Number.isFinite(cut.at)) throw new Error("This prompt has no recorded timestamp.");
		const repo = await worktreeAt(cut.cwd);
		if (!repo) throw new Error(`Replay needs the original cwd's git repository. ${cut.cwd} is unavailable or outside git.`);
		const model = choice.model ?? cut.model;
		if (!model) throw new Error("The original model was not recorded. Choose a model for this replay.");
		const thinking = choice.thinking ?? cut.thinking;
		if (!thinking || thinking === "auto") throw new Error("Choose a concrete thinking level. Automatic thinking cannot identify one replay request reliably.");
		const id = randomUUID();
		const reflog = await git(cut.cwd, "reflog", "show", "--date=unix", "--format=%H %gd", "HEAD").catch(() => "");
		const historical = reflog.split("\n").map(line => /^([0-9a-f]+) HEAD@\{(\d+)\}$/.exec(line)).find(match => match && Number(match[2]) * 1000 <= cut.at);
		let historicalSha = historical?.[1] ?? null;
		if (historicalSha && !await git(cut.cwd, "cat-file", "-e", `${historicalSha}^{commit}`).then(() => true, () => false)) historicalSha = null;
		const sha = historicalSha ?? (await git(cut.cwd, "rev-parse", "HEAD")).trim();
		const main = (await worktreesOf(cut.cwd))[0]?.path;
		if (!main) throw new Error("Git lists no main checkout for the source repository.");
		const root = `${main}-replay-${id.slice(0, 8)}`;
		await git(cut.cwd, "worktree", "add", "--detach", "--", root, sha);
		owned = root;
		const subdirectory = relative(await canonical(repo.top), await canonical(cut.cwd));
		if (subdirectory === ".." || subdirectory.startsWith("../")) throw new Error("The source cwd does not resolve inside its repository.");
		const printedTop = !subdirectory ? cut.cwd : cut.cwd.endsWith(`/${subdirectory}`) ? cut.cwd.slice(0, -subdirectory.length - 1) : null;
		const cwd = await ompSpelling(join(root, subdirectory));
		await mkdir(cwd, { recursive: true });
		const original = cut.freezeOriginal();
		const marker: ReplayMarker = {
			v: 1, id, source: { sessionId: pin.sessionId, file: pin.file, turnId: pin.entryId, at: cut.at },
			roots: { original: [...new Set([repo.top, await canonical(repo.top), ...(printedTop ? [printedTop] : [])])], replay: await ompSpelling(root) }, base: { sha, how: historicalSha ? "reflog" : "head-now" },
			model, thinking, modelChanged: !!cut.model && (cut.model.id !== model.id || cut.model.provider !== model.provider), promptEdited: choice.prompt !== null && choice.prompt !== cut.text,
			repaired: cut.repaired, ...original,
		};
		const written = await cut.fork(cwd, marker);
		forkFile = written.file;
		config = await writeReplayConfig(forkFile);
		return { marker, forkFile, cwd, config, first: { text: choice.prompt ?? cut.text, images: cut.images }, discard };
	} catch (error) {
		try {
			await cut.close();
		} finally {
			await discard();
		}
		throw error;
	}
}
export class ReplayFold {
	#facts: ReplayFacts | null = null;
	applyEntry(entry: Record<string, unknown>): void {
		const marker = entry.type === "custom" && entry.customType === REPLAY_MARKER ? replayMarkerOf(entry.data) : null;
		const check = entry.type === "custom" && entry.customType === REPLAY_CHECK ? requestCheckOf(entry.data) : null;
		if (marker) this.#facts = { marker, request: null, turnId: null };
		else if (this.#facts && check) this.#facts = { ...this.#facts, request: check };
		else if (this.#facts && this.#facts.turnId === null && (entry.type === "message" && isObject(entry.message) && entry.message.role === "user" || entry.type === "custom_message" && entry.customType === "skill-prompt" && entry.attribution === "user") && typeof entry.id === "string") this.#facts = { ...this.#facts, turnId: entry.id };
	}
	facts(): ReplayFacts | null { return this.#facts; }
}
export function replayOriginalTurn(marker: ReplayMarker): Turn {
	return readReplayBlob(marker.originalTurnRef) as Turn;
}

export async function replayComparison(file: string): Promise<ReplayComparison> {
	const { entries, requestFor } = await readReplaySession(file);
	const fold = new ReplayFold();
	const trajectory = new Trajectory(true);
	for (const entry of entries) {
		fold.applyEntry(entry);
		trajectory.applyEntry(entry);
	}
	let facts = fold.facts();
	if (!facts) throw new Error("This session is not a replay.");
	const original = replayOriginalTurn(facts.marker);
	let originalBody: unknown = null;
	try { if (facts.marker.original) originalBody = readReplayBlob(facts.marker.original.bodyRef); } catch { /* Missing source data is already an unknown pre-send check. */ }
	const check = facts.request;
	const replayTurnId = facts.turnId;
	const recorded = check?.replayHash ? requestFor(replayTurnId, check.replayHash) : null;
	if (check && check.status !== "unknown" && (!recorded || recorded.hash !== check.replayHash)) facts = { ...facts, request: { status: "unknown", rawEqual: null, reason: "The replay request log did not reconstruct to the pre-send check's SHA-256." } };
	const replay = trajectory.turns().find(turn => turn.id === replayTurnId) ?? null;
	if (!facts.request && replay && replay.steps.some(step => step.kind === "request")) facts = { ...facts, request: { status: "unknown", rawEqual: null, reason: "No main provider request could be correlated with this replay prompt before send." } };
	return { facts, original, replay, requestBodies: { original: originalBody, replay: recorded?.body ?? null } };
}

