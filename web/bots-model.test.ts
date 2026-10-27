import { describe, expect, test } from "bun:test";
import type { Routine } from "../src/routines";
import type { Bot, BotId } from "../src/shared/bots";
import type { RosterHost } from "../src/shared/sessions";
import { botHost, botHue, botInitial, botRoutines, memoryEntries } from "./bots-model";

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
	test("the avatar's letter is the name's first character, upper-cased, and a blank name reads as a question mark", () => {
		expect(botInitial("  scout")).toBe("S");
		expect(botInitial("élan")).toBe("É");
		expect(botInitial(" ")).toBe("?");
	});

	test("the avatar's hue depends on the id alone and stays in a circle", () => {
		expect(botHue(scout)).toBe(botHue("scout" as BotId));
		expect(botHue(scout)).not.toBe(botHue("ranger" as BotId));
		for (const id of ["a", "scout", "3f2a9c1e-7b4d-4e8a-9f61-0c2d5e8b7a14"]) {
			expect(botHue(id as BotId)).toBeGreaterThanOrEqual(0);
			expect(botHue(id as BotId)).toBeLessThan(360);
		}
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

	test("a memory reads as one fact per line, with the day remember wrote when the line has one", () => {
		expect(memoryEntries("- 2026-10-05 Prefers short answers.\n\n- Uses pnpm\nplain line\n")).toEqual([
			{ date: "2026-10-05", fact: "Prefers short answers." },
			{ date: null, fact: "Uses pnpm" },
			{ date: null, fact: "plain line" },
		]);
		expect(memoryEntries("")).toEqual([]);
	});
});
