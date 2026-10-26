import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, sha256 } from "../templates/omp/agent/extensions/replay/request-log-reader";
import { checkReplayRequest } from "../templates/omp/agent/extensions/replay/replay-check";
import { isObject } from "./json";
import { loader, sessionManager } from "./omp/modules";
import type { OmpSessionManager } from "./omp/modules";
import { openPromptCut } from "./omp/replay-fork";
import { REPLAY_CHECK, REPLAY_MARKER } from "./shared/replay";
import { prepareReplay, replayComparison, replayDetail, ReplayFold } from "./replay";
import type { PreparedReplay } from "./replay";

const dirs: string[] = [];
const prepared: PreparedReplay[] = [];
afterEach(async () => {
	for (const replay of prepared.splice(0)) await replay.discard();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
interface SourceFixture { cwd: string; file: string; id: string; body: Record<string, unknown>; images: { data: string; mimeType: string }[] }
const model = { provider: "openai-codex", id: "gpt-5.6-sol" };
const assistant = (text: string) => ({ role: "assistant", provider: model.provider, model: model.id, api: "openai-codex-responses", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now() });
function temp() { const dir = mkdtempSync(join(tmpdir(), "omp-replay-behavior-")); dirs.push(dir); return dir; }
function git(cwd: string, ...args: string[]) {
	const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}
function record(manager: OmpSessionManager, body: Record<string, unknown>, leafId: string) {
	const blob = (value: unknown) => manager.putBlobSync(Buffer.from(canonicalJson(value))).ref;
	const { instructions, tools, input, ...params } = body;
	manager.appendCustomEntry("omp-request-log.record", { provider: model.provider, api: "openai-codex-responses", model: model.id, thinkingLevel: "low", leafId, requestHash: sha256(canonicalJson(body)), systemPromptHash: blob({ instructions }), toolsHash: blob({ tools }), paramsHash: blob(params), messages: { key: "input", base: null, edits: blob([{ add: input instanceof Array ? input[0] : input }]) } });
}
async function source(kind: "first" | "deep" | "mid" | "images" | "missing-image" | "skill" = "first", repository = false): Promise<SourceFixture> {
	const cwd = temp();
	if (repository) {
		git(cwd, "init", "-b", "main");
		writeFileSync(join(cwd, "tracked.txt"), "committed\n");
		git(cwd, "add", "tracked.txt");
		git(cwd, "-c", "user.name=Replay test", "-c", "user.email=replay@test.invalid", "commit", "-m", "initial");
	}
	const manager = sessionManager.SessionManager.create(cwd, join(cwd, "source-sessions"));
	await manager.setAdditionalDirectories([temp()]);
	if (kind === "deep" || kind === "mid") {
		manager.appendMessage({ role: "user", content: "earlier", timestamp: Date.now() });
		manager.appendMessage(kind === "mid" ? { ...assistant(""), content: [{ type: "toolCall", id: "unfinished", name: "write", arguments: { path: "tracked.txt", content: "never execute" } }], stopReason: "toolUse" } : assistant("earlier result"));
	}
	const images = [{ type: "image", mimeType: "image/png", data: "Zmlyc3Q=" }, { type: "image", mimeType: "image/jpeg", data: "c2Vjb25k" }];
	const content = kind === "images" || kind === "missing-image" ? [{ type: "text", text: "selected" }, ...images.map((image, i) => kind === "missing-image" && i === 1 ? { ...image, data: `blob:sha256:${"f".repeat(64)}` } : image)] : "selected";
	const id = kind === "skill" ? manager.appendCustomMessageEntry("skill-prompt", "expanded skill body", false, { name: "example", args: "explain", prompt: "/skill:example explain" }, "user") : manager.appendMessage({ role: "user", content, timestamp: Date.now() });
	const body = { model: model.id, instructions: `Work in ${cwd}`, tools: [], input: [{ role: "user", content: [{ type: "input_text", text: kind === "skill" ? "expanded skill body" : "selected" }] }], reasoning: { effort: "low" }, stream: true };
	if (kind !== "images" && kind !== "missing-image") record(manager, body, id);
	manager.appendMessage(assistant("source result"));
	await manager.flush();
	const file = manager.getSessionFile();
	if (!file) throw new Error("Native fixture did not create a session");
	await manager.close();
	return { cwd, file, id, body, images: images.map(({ data, mimeType }) => ({ data, mimeType })) };
}
async function launchFixture(input: SourceFixture, prompt: string | null = null) {
	const detail = await replayDetail(input.file, input.id);
	const replay = await prepareReplay({ token: detail.token, model, thinking: "low", prompt }, input.file, async () => null);
	prepared.push(replay);
	return replay;
}

describe("native prompt replay fork", () => {
	test("a first prompt forks empty history, changes cwd, clears write roots, and leaves source bytes untouched", async () => {
		const input = await source();
		const bytes = readFileSync(input.file);
		const cut = await openPromptCut(input.file, input.id);
		expect(cut.text).toBe("selected");
		const fork = await cut.fork(temp(), { test: "marker" });
		const entries = await loader.loadEntriesFromFile(fork.file);
		expect(entries.filter(entry => entry.type === "message")).toEqual([]);
		expect(entries.some(entry => entry.customType === REPLAY_MARKER)).toBe(true);
		const reopened = await sessionManager.SessionManager.open(fork.file, undefined, undefined, { suppressBreadcrumb: true });
		expect(reopened.getCwd()).not.toBe(input.cwd);
		expect(reopened.getHeader()?.additionalDirectories).toBeUndefined();
		await reopened.close();
		expect(readFileSync(input.file).equals(bytes)).toBe(true);
	});
	test("a deep prompt retains exactly its ancestors, never the selected prompt or its result", async () => {
		const input = await source("deep");
		const bytes = readFileSync(input.file);
		const cut = await openPromptCut(input.file, input.id);
		const ancestors = await loader.loadEntriesFromFile(input.file);
		const ids = ancestors.slice(0, ancestors.findIndex(entry => entry.id === input.id)).filter(entry => entry.type !== "session").map(entry => entry.id);
		const fork = await cut.fork(temp(), { test: "marker" });
		const entries = await loader.loadEntriesFromFile(fork.file);
		expect(entries.filter(entry => entry.type !== "session").slice(0, ids.length).map(entry => entry.id)).toEqual(ids);
		expect(entries.some(entry => entry.id === input.id)).toBe(false);
		expect(JSON.stringify(entries)).not.toContain("source result");
		expect(readFileSync(input.file).equals(bytes)).toBe(true);
	});
	test("unresolved inherited calls receive unknown outcomes only in the fork", async () => {
		const input = await source("mid");
		const bytes = readFileSync(input.file);
		const cut = await openPromptCut(input.file, input.id);
		const fork = await cut.fork(temp(), { test: "marker" });
		expect(fork.repaired).toBe(true);
		const entries = await loader.loadEntriesFromFile(fork.file);
		const result = entries.map(entry => entry.message).find(message => isObject(message) && message.role === "toolResult");
		expect(result).toMatchObject({ toolCallId: "unfinished", isError: true, content: [{ type: "text", text: "The parent session may still be running this tool; its outcome is unknown." }] });
		expect(readFileSync(input.file).equals(bytes)).toBe(true);
	});
	test("images recover original bytes, MIME types, and order through the native blob store", async () => {
		const input = await source("images");
		const cut = await openPromptCut(input.file, input.id);
		expect(cut.text).toBe("selected");
		expect(cut.images).toEqual(input.images);
		await cut.close();
	});
	test("a missing required image fails instead of silently dropping it", async () => {
		const input = await source("missing-image");
		await expect(openPromptCut(input.file, input.id)).rejects.toThrow();
	});
	test("skills restore invocations rather than expanded skill files", async () => {
		const input = await source("skill");
		const detail = await replayDetail(input.file, input.id);
		expect(detail.prompt).toBe("/skill:example explain");
		expect(detail.model).toEqual(model);
		expect(detail.thinking).toBe("low");
	});
});

describe("replay ownership and persistent comparison", () => {
	test("native request evidence supplies original settings and one selected first prompt in a detached committed checkout", async () => {
		const input = await source("deep", true);
		writeFileSync(join(input.cwd, "tracked.txt"), "dirty source\n");
		const bytes = readFileSync(input.file);
		const detail = await replayDetail(input.file, input.id);
		expect(detail.model).toEqual(model);
		expect(detail.thinking).toBe("low");
		const replay = await launchFixture(input);
		expect(replay.first).toEqual({ text: "selected", images: [] });
		expect(git(replay.cwd, "rev-parse", "HEAD")).toBe(replay.marker.base.sha);
		expect(git(replay.cwd, "branch", "--show-current")).toBe("");
		expect(readFileSync(join(replay.cwd, "tracked.txt"), "utf8")).toBe("committed\n");
		expect(readFileSync(input.file).equals(bytes)).toBe(true);
		expect(readFileSync(join(input.cwd, "tracked.txt"), "utf8")).toBe("dirty source\n");
	});
	test("editing the pinned prompt rejects stale history before creating a checkout", async () => {
		const input = await source("first", true);
		const detail = await replayDetail(input.file, input.id);
		writeFileSync(input.file, readFileSync(input.file, "utf8").replaceAll("selected", "changed"));
		await expect(prepareReplay({ token: detail.token, model, thinking: "low", prompt: null }, input.file, async () => null)).rejects.toThrow("history changed");
		expect(git(input.cwd, "worktree", "list", "--porcelain").match(/worktree /g)).toHaveLength(1);
	});
	test("later source appends remain valid and original outcomes stay frozen after launch", async () => {
		const input = await source("deep", true);
		const detail = await replayDetail(input.file, input.id);
		appendFileSync(input.file, `${JSON.stringify({ type: "custom", id: "later", parentId: input.id, timestamp: new Date().toISOString(), customType: "later-source-response", data: {} })}\n`);
		const replay = await prepareReplay({ token: detail.token, model, thinking: "low", prompt: null }, input.file, async () => null);
		prepared.push(replay);
		const worker = await sessionManager.SessionManager.open(replay.forkFile, undefined, undefined, { suppressBreadcrumb: true });
		const promptId = worker.appendMessage({ role: "user", content: replay.first.text, timestamp: Date.now() });
		const body = JSON.parse(JSON.stringify(input.body).replaceAll(input.cwd, replay.marker.roots.replay));
		worker.appendCustomEntry(REPLAY_CHECK, checkReplayRequest(replay.marker, input.body, body, "openai-codex-responses", model.id));
		record(worker, body, promptId);
		worker.appendMessage(assistant("replay result"));
		worker.appendMessage({ role: "user", content: "later replay prompt", timestamp: Date.now() });
		await worker.flush();
		await worker.close();
		writeFileSync(input.file, readFileSync(input.file, "utf8").replaceAll("source result", "mutated source outcome"));
		const compared = await replayComparison(replay.forkFile);
		expect(compared.facts.turnId).toBe(promptId);
		expect(compared.replay?.id).toBe(promptId);
		expect(compared.facts.request?.status).toBe("match");
		expect(JSON.stringify(compared.original)).toContain("source result");
		expect(JSON.stringify(compared.original)).not.toContain("mutated source outcome");
		expect(compared.requestBodies.original).toEqual(input.body);
		expect(compared.requestBodies.replay).toEqual(body);
		const fold = new ReplayFold();
		for (const entry of await loader.loadEntriesFromFile(replay.forkFile)) fold.applyEntry(entry);
		expect(fold.facts()?.turnId).toBe(promptId);
	});
	test("edited prompts persist as accepted choices and shell commands never become a first prompt", async () => {
		const input = await source("first", true);
		const replay = await launchFixture(input, "edited prompt");
		expect(replay.first.text).toBe("edited prompt");
		expect(replay.marker.promptEdited).toBe(true);
		const detail = await replayDetail(input.file, input.id);
		await expect(prepareReplay({ token: detail.token, model, thinking: "low", prompt: "!touch /outside" }, input.file, async () => null)).rejects.toThrow("model prompt");
	});
});

test("comparison reads complete source tool arguments, results, and final text rather than clipped stream previews", async () => {
	const input = await source("first", true);
	const manager = await sessionManager.SessionManager.open(input.file, undefined, undefined, { suppressBreadcrumb: true });
	manager.appendMessage({ ...assistant(""), content: [{ type: "toolCall", id: "large-call", name: "write", arguments: { content: "x".repeat(5000) } }], stopReason: "toolUse" });
	manager.appendMessage({ role: "toolResult", toolCallId: "large-call", toolName: "write", content: [{ type: "text", text: "y".repeat(5000) }], isError: false, timestamp: Date.now() });
	manager.appendMessage(assistant("z".repeat(8000)));
	await manager.flush();
	await manager.close();
	const replay = await launchFixture(input);
	const compared = await replayComparison(replay.forkFile);
	const tool = compared.original.steps.find(step => step.kind === "tool");
	if (!tool || tool.kind !== "tool") throw new Error("Missing source tool");
	expect(tool.args.cut).toBe(0);
	expect(tool.args.text).toContain("x".repeat(5000));
	expect(tool.result).toEqual({ text: "y".repeat(5000), cut: 0 });
	const reply = compared.original.steps.findLast(step => step.kind === "reply");
	expect(reply).toEqual({ kind: "reply", body: { text: "z".repeat(8000), cut: 0 } });
});
