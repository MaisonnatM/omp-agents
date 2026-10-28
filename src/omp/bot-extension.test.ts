import { afterEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Schedule } from "../routines";
import { MAX_FACT_LENGTH } from "../shared/bots";
import botExtension, { BOT_FLAGS, type BotExtensionApi, type BotTool, type SaveRoutineParams } from "./bot-extension";

const dirs: string[] = [];
afterEach(() => {
	setSystemTime();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Handler = Parameters<BotExtensionApi["on"]>[1];

const weekdays: Schedule = { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 9, minute: 0 } };
const standup = { id: "r1", botId: "scout", name: "Standup", schedules: [weekdays], triggers: [], task: { kind: "prompt", prompt: "Post the standup." }, enabled: false, createdAt: 1, scheduledAt: null, runs: [] };
const relayMail = { id: "r2", botId: "relay", name: "Relay mail", schedules: [], triggers: [{ kind: "gmail" }], task: { kind: "command", command: "./relay.sh" }, enabled: true, createdAt: 1, scheduledAt: null, runs: [] };

/** The extension loaded as omp loads it for Bot `scout`, whose memory file does not exist yet, beside Bot `relay`'s routine and, unless `routines` is false, its own. */
function loadedBot({ routines = true } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-bot-extension-"));
	dirs.push(dir);
	const bots = join(dir, "bots.json");
	const memory = join(dir, "bots", "scout", "memory.md");
	const routinesFile = join(dir, "routines.json");
	const inbox = join(dir, "routine-inbox");
	writeFileSync(bots, JSON.stringify({ bots: [{ id: "scout", name: "Scout", job: "Watch the build.\nAsk before merging.", cwd: "/tmp", model: null, skill: null, sessionId: "s1", createdAt: "2026-05-01T09:00:00.000Z" }] }));
	if (routines) writeFileSync(routinesFile, JSON.stringify({ routines: [relayMail, standup] }));
	const flags = new Map<string, string>([
		[BOT_FLAGS.bot, "scout"],
		[BOT_FLAGS.bots, bots],
		[BOT_FLAGS.memory, memory],
		[BOT_FLAGS.routines, routinesFile],
		[BOT_FLAGS.routineInbox, inbox],
	]);
	let handler: Handler | undefined;
	const tools = new Map<string, BotTool<unknown>>();
	botExtension({
		registerFlag() {},
		getFlag: name => flags.get(name),
		on: (_event, registered) => void (handler = registered),
		registerTool: registered => void tools.set(registered.name, registered),
		typebox: {
			Type: {
				Object: properties => properties,
				String: options => options,
				Integer: options => options,
				Boolean: options => options,
				Literal: value => value,
				Union: schemas => schemas,
				Array: items => items,
				Optional: schema => schema,
			},
		},
	});
	const prompt = (kind: "main" | "sub" = "main") => handler!({ systemPrompt: ["base"] }, { agent: { kind } })?.systemPrompt;
	const call = <Params>(name: string, params: Params) => tools.get(name)!.execute("call-1", params);
	/** The requests the routine tools left for the dashboard, oldest first. */
	const requests = () => (existsSync(inbox) ? readdirSync(inbox).sort().map(name => (name.endsWith(".json") ? JSON.parse(readFileSync(join(inbox, name), "utf8")) : name)) : []);
	return {
		memory,
		prompt,
		requests,
		remember: (fact: string) => call("remember", { fact }),
		saveRoutine: (params: SaveRoutineParams) => call("save_routine", params),
		deleteRoutine: (id: string) => call("delete_routine", { id }),
	};
}

test("a fact the Bot remembers lands in its memory as a dated line, and the next turn's system prompt carries it with its name, job, and own routines", async () => {
	const bot = loadedBot();
	setSystemTime(new Date("2026-05-03T10:00:00.000Z"));
	expect(await bot.remember("  The user prefers\nshort answers. ")).toEqual({ content: [{ type: "text", text: "Remembered: The user prefers short answers." }], details: undefined });
	expect(readFileSync(bot.memory, "utf8")).toBe("- 2026-05-03 The user prefers short answers.\n");

	expect(bot.prompt()).toEqual([
		"base",
		[
			"You are Scout, an omp-agents Bot: a teammate the user keeps, with this one conversation they come back to.",
			"Your job, and what you ask before doing:",
			"Watch the build.\nAsk before merging.",
			"What you remember from earlier turns:",
			"- 2026-05-03 The user prefers short answers.",
			"When the user tells you something worth keeping across turns, such as a preference, a decision, or a fact about the work, call `remember` with it as one short sentence.",
			"Your routines, one per line in the fields `save_routine` takes:",
			'{"id":"r1","name":"Standup","enabled":false,"schedules":[{"kind":"weekly","days":[1,2,3,4,5],"time":{"hour":9,"minute":0}}],"triggers":[],"task":{"kind":"prompt","prompt":"Post the standup."}}',
			"A routine runs on its schedules and when its triggers see something happen; each run messages this conversation with its prompt, or runs its shell command in your workspace and posts the output here. Call `save_routine` to create or change one, and `delete_routine` to delete one.",
		].join("\n"),
	]);
});

test("before the Bot remembers anything or has a routine its prompt says so, and a subagent it spawns gets no Bot prompt", () => {
	const bot = loadedBot({ routines: false });
	expect(bot.prompt()?.[1]).toContain("What you remember from earlier turns:\nNothing yet.");
	expect(bot.prompt()?.[1]).toContain("Your routines, one per line in the fields `save_routine` takes:\nNone yet.\n");
	expect(bot.prompt("sub")).toBeUndefined();
});

test("a fact longer than one short sentence is refused and the memory keeps nothing of it", async () => {
	const bot = loadedBot();
	expect(await bot.remember("x".repeat(MAX_FACT_LENGTH))).toMatchObject({ content: [{ type: "text" }] });
	await expect(bot.remember("y".repeat(MAX_FACT_LENGTH + 1))).rejects.toThrow(`fact is ${MAX_FACT_LENGTH + 1} characters`);
	expect(readFileSync(bot.memory, "utf8")).not.toContain("y");
});

test("a memory past the cap reaches the prompt as its newest facts with a note that older ones were cut, and a short one whole", () => {
	const bot = loadedBot();
	mkdirSync(dirname(bot.memory), { recursive: true });
	const lines = Array.from({ length: 1000 }, (_, index) => `- 2026-05-03 Fact number ${index}.`);
	writeFileSync(bot.memory, `${lines.join("\n")}\n`);
	const prompt = bot.prompt()?.[1] ?? "";
	expect(prompt).toContain("What you remember from earlier turns:\n(Older memory was cut to keep this prompt short; only the newest facts follow.)\n- 2026-05-03 Fact number");
	expect(prompt).toContain("- 2026-05-03 Fact number 999.\nWhen the user tells you");
	expect(prompt).not.toContain("Fact number 0.");

	writeFileSync(bot.memory, `${lines.slice(0, 2).join("\n")}\n`);
	expect(bot.prompt()?.[1]).toContain(`What you remember from earlier turns:\n${lines.slice(0, 2).join("\n")}\nWhen the user tells you`);
});

test("save_routine leaves the dashboard one request per call: a new routine of this Bot, enabled, then an edit of its own that keeps it disabled", async () => {
	const bot = loadedBot();
	setSystemTime(new Date("2026-05-03T10:00:00.000Z"));
	const created = await bot.saveRoutine({ name: "Mail digest", schedules: [], triggers: ["gmail", "slack"], task: { kind: "command", command: "./digest.sh" } });
	const [request] = bot.requests();
	expect(request).toEqual({
		botId: "scout",
		change: { op: "save", routine: { id: expect.any(String), botId: "scout", name: "Mail digest", schedules: [], triggers: [{ kind: "gmail" }, { kind: "slack" }], task: { kind: "command", command: "./digest.sh" }, enabled: true } },
	});
	const newId: string = request.change.routine.id;
	expect(created.content[0]?.text).toBe(
		`Created routine "Mail digest". The dashboard applies it, and while the dashboard is stopped the change waits for it.\n{"id":"${newId}","name":"Mail digest","enabled":true,"schedules":[],"triggers":["gmail","slack"],"task":{"kind":"command","command":"./digest.sh"}}`,
	);

	setSystemTime(new Date("2026-05-03T10:01:00.000Z"));
	await bot.saveRoutine({ id: "r1", name: "Standup", schedules: [weekdays], triggers: ["slack"], task: { kind: "prompt", prompt: "Post the standup, with Slack's news." } });
	expect(bot.requests()).toEqual([
		request,
		{
			botId: "scout",
			change: { op: "save", routine: { id: "r1", botId: "scout", name: "Standup", schedules: [weekdays], triggers: [{ kind: "slack" }], task: { kind: "prompt", prompt: "Post the standup, with Slack's news." }, enabled: false } },
		},
	]);
});

test("delete_routine leaves the dashboard a request to delete one of this Bot's routines", async () => {
	const bot = loadedBot();
	expect((await bot.deleteRoutine("r1")).content[0]?.text).toBe('Deleted routine "Standup". The dashboard applies it, and while the dashboard is stopped the change waits for it.');
	expect(bot.requests()).toEqual([{ botId: "scout", change: { op: "remove", id: "r1" } }]);
});

test("the routine tools refuse another Bot's routine, an id no routine has, and a routine with neither schedule nor trigger, and leave nothing", async () => {
	const bot = loadedBot();
	const relayEdit: SaveRoutineParams = { id: "r2", name: "Mine now", schedules: [], triggers: ["gmail"], task: { kind: "prompt", prompt: "Take over." } };
	await expect(bot.saveRoutine(relayEdit)).rejects.toThrow("None of your routines has id r2; omit id to create a routine.");
	await expect(bot.deleteRoutine("r2")).rejects.toThrow("None of your routines has id r2.");
	await expect(bot.deleteRoutine("r9")).rejects.toThrow("None of your routines has id r9.");
	await expect(bot.saveRoutine({ name: "Never", schedules: [], triggers: [], task: { kind: "prompt", prompt: "Hello." } })).rejects.toThrow("The routine is not valid");
	expect(bot.requests()).toEqual([]);
});
