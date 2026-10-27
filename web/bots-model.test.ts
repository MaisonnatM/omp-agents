import { describe, expect, test } from "bun:test";
import type { Routine } from "../src/routines";
import type { Bot, BotId, BotLast } from "../src/shared/bots";
import type { RosterHost } from "../src/shared/sessions";
import { botHost, botLook, botRoutines, botRows, jobLine, memoryEntries, starterPrompts } from "./bots-model";

const scout = "scout" as BotId;

const bot = (sessionId: string | null): Bot => ({ id: scout, name: "Scout", job: "", cwd: "~/code/webapp", model: null, skill: null, sessionId, createdAt: "2026-10-05T09:00:00.000Z" });

const routine = (id: string, target: Routine["target"]): Routine => ({
	id,
	name: id,
	cwd: "~/code/webapp",
	schedules: [{ kind: "weekly", days: [1], time: { hour: 9, minute: 0 } }],
	task: { kind: "prompt", prompt: "Post the standup.", pin: false },
	target,
	skill: null,
	enabled: true,
	createdAt: 0,
	runs: [],
});

describe("Bots", () => {
	test("the avatar's shape and hue depend on the id alone", () => {
		expect(botLook(scout)).toEqual({ shape: "clover", hue: 320 });
		expect(botLook("ranger" as BotId)).toEqual({ shape: "diamond", hue: 110 });
		expect(botLook("a" as BotId)).toEqual({ shape: "triangle", hue: 195 });
		expect(botLook("3f2a9c1e-7b4d-4e8a-9f61-0c2d5e8b7a14" as BotId)).toEqual({ shape: "square", hue: 195 });
	});

	test("the Bot's running session is the host of its session id, and none without one", () => {
		const hosts = [{ instanceId: "7c51f77b", sessionId: "s1" }] as RosterHost[];
		expect(botHost(bot("s1"), hosts)?.instanceId).toBe("7c51f77b");
		expect(botHost(bot("s2"), hosts)).toBeNull();
		expect(botHost(bot(null), hosts)).toBeNull();
	});

	test("a Bot's routines are those that send to it", () => {
		const routines = [routine("mine", { kind: "bot", botId: scout }), routine("other", { kind: "bot", botId: "ranger" as BotId }), routine("new", { kind: "new-session" })];
		expect(botRoutines(routines, scout).map(({ id }) => id)).toEqual(["mine"]);
	});

	test("a row previews the question first, then Working…, then the freshest words as plain text, else no messages", () => {
		const named = (id: string, name: string, sessionId: string | null): Bot => ({ ...bot(sessionId), id: id as BotId, name });
		const bots = [named("asker", "Asker", "s1"), named("worker", "Worker", "s2"), named("replied", "Replied", "s3"), named("talked", "Talked", "s4"), named("fresh", "Fresh", null)];
		const hosts = [
			{ sessionId: "s1", status: "needs-input", requests: [{ title: "Push to main?" }], unread: null },
			{ sessionId: "s2", status: "working", requests: [], unread: null },
			{ sessionId: "s3", status: "idle", requests: [], unread: { at: 5_000, reply: "**Résumé:** The build is `green`." } },
		] as unknown as RosterHost[];
		const lasts: Record<BotId, BotLast | null> = {
			["asker" as BotId]: { at: 4_000, from: "bot", text: "Shall I push?" },
			["worker" as BotId]: { at: 3_000, from: "user", text: "Check the deploy." },
			["replied" as BotId]: { at: 2_000, from: "user", text: "How is the build?" },
			["talked" as BotId]: { at: 1_000, from: "user", text: "Thanks." },
		};
		expect(botRows(bots, hosts, lasts).map(({ bot, status, asking, unread, preview, at }) => [bot.name, status, asking, unread, preview, at])).toEqual([
			["Fresh", null, null, false, "No messages yet", Date.parse("2026-10-05T09:00:00.000Z")],
			["Replied", "idle", null, true, "The build is green.", 5_000],
			["Asker", "needs-input", "Push to main?", false, "Push to main?", 4_000],
			["Worker", "working", null, false, "Working…", 3_000],
			["Talked", null, null, false, "You: Thanks.", 1_000],
		]);
	});

	test("a job's first line is its first sentence, past headings and list marks", () => {
		expect(jobLine("## Role\n\n- Watch the main branch's CI and tell me what broke. Ask before you push.")).toBe("Watch the main branch's CI and tell me what broke.");
		expect(jobLine("Triage the v1.2 issues")).toBe("Triage the v1.2 issues");
		expect(jobLine("  \n# Only a heading")).toBe("");
	});

	test("a new Bot offers its job's first sentence, then what it needs, then a fact to remember", () => {
		expect(starterPrompts("Watch the build. Ask first.")).toEqual(["Watch the build.", "What do you need from me to do this job well?", "Remember that I prefer short answers."]);
		expect(starterPrompts("")).toEqual(["What should your job be? Ask me a few questions.", "What can you help me with?", "Remember that I prefer short answers."]);
	});

	test("a memory reads as one fact per line, with the day remember wrote when the line has one", () => {
		expect(memoryEntries("- 2026-10-05 Prefers short answers.\n\n- Uses pnpm\nplain line\n")).toEqual([
			{ date: "2026-10-05", fact: "Prefers short answers." },
			{ date: null, fact: "Uses pnpm" },
			{ date: null, fact: "plain line" },
		]);
		expect(memoryEntries("")).toEqual([]);
	});
});
