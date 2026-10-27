import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotId, BotSpec } from "../shared/bots";
import type { StartRequest, StartResult } from "../shared/sessions";
import { Bots, lastMessage } from "./bots";
import { BotsFile } from "./bots-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scout: BotSpec = { id: "scout" as BotId, name: "Scout", job: "Watch the build.", cwd: "/work/webapp", model: null, skill: null };

interface FakeSession {
	instanceId: string;
	sessionId: string;
	/** The extra `omp` arguments it launched with. */
	args: string[];
	/** Each message it took, as `<delivery> <text>`. */
	heard: string[];
	ended: boolean;
}

/** Bots over a fresh `bots.json`, with a starter that joins each start as the server's does and keeps the session files it wrote. */
function harness() {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-bots-"));
	dirs.push(dir);
	const file = new BotsFile(join(dir, "bots.json"));
	file.apply({ op: "save", bot: scout }, "2026-05-01T09:00:00.000Z");
	const sessions: FakeSession[] = [];
	const saved = new Set<string>();
	const requests: StartRequest[] = [];
	const live = (session: FakeSession | undefined) =>
		session && !session.ended
			? {
					sessionId: session.sessionId,
					prompt: async (_agentId: string | null, text: string, _images: unknown[], delivery: string) => void session.heard.push(`${delivery} ${text}`),
				}
			: undefined;
	const bots: Bots = new Bots({
		file,
		async start(request): Promise<StartResult> {
			requests.push(request);
			const join = bots.join(request);
			const instanceId = `i${sessions.length + 1}`;
			const session: FakeSession = { instanceId, sessionId: request.kind === "resume" ? request.sessionId : `s${sessions.length + 1}`, args: join.rpc.args, heard: [], ended: false };
			sessions.push(session);
			join.attach({ instanceId, sessionId: session.sessionId, cwd: "/work/webapp" });
			if (request.kind === "new") session.heard.push(`steer ${request.prompt}`);
			saved.add(session.sessionId);
			return { ok: true, instanceId, cwd: "/work/webapp", prompt: null };
		},
		live: sessionId => live(sessions.find(session => session.sessionId === sessionId && !session.ended)),
		session: instanceId => live(sessions.find(session => session.instanceId === instanceId)),
		savedFile: sessionId => (saved.has(sessionId) ? `/sessions/${sessionId}.jsonl` : null),
		paths: { extension: "/ext/bot.ts", botsFile: join(dir, "bots.json"), botsDir: join(dir, "bots") },
		now: () => "2026-05-02T09:00:00.000Z",
		onChange: () => {},
	});
	const end = (session: FakeSession): void => {
		session.ended = true;
		bots.exited(session.instanceId);
	};
	return { bots, file, sessions, requests, end, dir };
}

describe("Bots", () => {
	test("a Bot's first message starts its conversation in its workspace with the Bot extension, and the next one follows up in it", async () => {
		const { bots, file, sessions, requests, dir } = harness();
		expect(await bots.message(scout.id, "Remember that I prefer short answers.")).toBe("s1");
		expect(requests[0]).toMatchObject({ kind: "new", cwd: "/work/webapp", prompt: "Remember that I prefer short answers." });
		expect(sessions[0]?.args).toEqual(["-e", "/ext/bot.ts", "--omp-agents-bot", "scout", "--omp-agents-bots", join(dir, "bots.json"), "--omp-agents-bot-memory", join(dir, "bots", "scout", "memory.md")]);
		expect(file.value[0]?.sessionId).toBe("s1");

		expect(await bots.message(scout.id, "And now?")).toBe("s1");
		expect(requests).toHaveLength(1);
		expect(sessions[0]?.heard).toEqual(["steer Remember that I prefer short answers.", "followUp And now?"]);
	});

	test("after its session ended, a message resumes the same conversation with the extension and sends the text", async () => {
		const { bots, sessions, requests, end } = harness();
		await bots.message(scout.id, "Hello.");
		end(sessions[0]!);
		expect(await bots.message(scout.id, "Still there?")).toBe("s1");
		expect(requests[1]).toEqual({ kind: "resume", sessionId: "s1" });
		expect(sessions[1]?.args).toContain("--omp-agents-bot");
		expect(sessions[1]?.heard).toEqual(["followUp Still there?"]);
	});

	test("two messages at once start one conversation, in the order they were sent", async () => {
		const { bots, sessions, requests } = harness();
		await Promise.all([bots.message(scout.id, "One."), bots.message(scout.id, "Two.")]);
		expect(requests).toHaveLength(1);
		expect(sessions[0]?.heard).toEqual(["steer One.", "followUp Two."]);
	});

	test("a message to a removed Bot fails and starts nothing", async () => {
		const { bots, file, requests } = harness();
		file.apply({ op: "remove", id: scout.id }, "2026-05-02T09:00:00.000Z");
		await expect(bots.message(scout.id, "Hello.")).rejects.toThrow("This Bot is gone.");
		expect(requests).toEqual([]);
	});

	test("the page's resume of a Bot's conversation gets the extension, and any other start launches plain", async () => {
		const { bots } = harness();
		await bots.message(scout.id, "Hello.");
		expect(bots.join({ kind: "resume", sessionId: "s1" }).rpc.args).toContain("--omp-agents-bot");
		expect(bots.join({ kind: "resume", sessionId: "s9" }).rpc.args).toEqual([]);
	});

	test("a /move or an edited prompt rebinds the Bot to the session it moved to", async () => {
		const { bots, file } = harness();
		await bots.message(scout.id, "Hello.");
		bots.switched("i1", "s1-moved");
		expect(file.value[0]?.sessionId).toBe("s1-moved");
	});

	test("memories read each Bot's memory.md, empty before it remembers anything", () => {
		const { bots, file, dir } = harness();
		file.apply({ op: "save", bot: { ...scout, id: "scribe" as BotId, name: "Scribe" } }, "2026-05-02T09:00:00.000Z");
		mkdirSync(join(dir, "bots", "scout"), { recursive: true });
		writeFileSync(join(dir, "bots", "scout", "memory.md"), "- 2026-05-02 Prefers short answers.\n");
		expect(bots.memories).toEqual({ ["scout" as BotId]: "- 2026-05-02 Prefers short answers.\n", ["scribe" as BotId]: "" });
	});

	test("lasts holds no last words for a Bot whose conversation has no file", async () => {
		const { bots } = harness();
		expect(bots.lasts).toEqual({ ["scout" as BotId]: null });
		await bots.message(scout.id, "Hello.");
		expect(bots.lasts).toEqual({ ["scout" as BotId]: null });
	});
});

describe("lastMessage", () => {
	const line = (role: string, content: unknown, timestamp = "2026-05-02T09:30:00.000Z") => JSON.stringify({ type: "message", timestamp, message: { role, content } });
	const write = (lines: string[]): string => {
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-last-"));
		dirs.push(dir);
		const path = join(dir, "session.jsonl");
		writeFileSync(path, `${lines.join("\n")}\n`);
		return path;
	};

	test("the last reply with text wins, without its suggested prompts, past tool calls and results", () => {
		const path = write([
			JSON.stringify({ type: "session", id: "s1" }),
			line("user", "Watch the build.", "2026-05-02T09:00:00.000Z"),
			line("assistant", [{ type: "thinking", thinking: "Hm." }, { type: "text", text: "The build is green.\n\nSuggestions:\n1. Open the PR" }]),
			line("assistant", [{ type: "toolCall", id: "t1", name: "remember", arguments: {} }]),
			line("toolResult", [{ type: "text", text: "Remembered." }]),
		]);
		expect(lastMessage(path)).toEqual({ at: Date.parse("2026-05-02T09:30:00.000Z"), from: "bot", text: "The build is green." });
	});

	test("the user's own prompt counts, as one line; a prompt the dashboard sent does not", () => {
		const path = write([line("user", "Keep an eye on\nthe deploy."), line("user", "[omp-agents] Continue.")]);
		expect(lastMessage(path)).toEqual({ at: Date.parse("2026-05-02T09:30:00.000Z"), from: "user", text: "Keep an eye on the deploy." });
	});

	test("a file whose end is all tool output, or no file at all, has no last words", () => {
		const path = write([line("user", "Hello."), line("toolResult", [{ type: "text", text: "x".repeat(300 * 1024) }])]);
		expect(lastMessage(path)).toBeNull();
		expect(lastMessage(join(tmpdir(), "omp-agents-no-such-session.jsonl"))).toBeNull();
	});
});
