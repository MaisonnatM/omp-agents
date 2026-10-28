import { afterEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Schedule } from "../routines";
import { MAX_FACT_LENGTH, MAX_JOB_LENGTH } from "../shared/bots";
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
const nightly = {
	id: "r3",
	botId: "scout",
	name: "Nightly build",
	schedules: [],
	triggers: [{ kind: "pull-request" }],
	task: { kind: "command", command: "bun install --frozen-lockfile &&\n  bun run build && bun test --coverage --reporter=junit --reporter-outfile=report.xml" },
	enabled: true,
	createdAt: 1,
	scheduledAt: null,
	runs: [],
};

/**
 * The extension loaded as omp loads it for Bot `scout`, whose memory file does not exist yet, beside Bot `relay`'s routine and, unless `routines` is
 * false, its own; `job` is Scout's job in `bots.json`, and `unset` names flags the dashboard leaves out.
 */
function loadedBot({ routines = true, job = "Watch the build.\nAsk before merging.", unset = [] as string[] } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-bot-extension-"));
	dirs.push(dir);
	const bots = join(dir, "bots.json");
	const memory = join(dir, "bots", "scout", "memory.md");
	const routinesFile = join(dir, "routines.json");
	const inbox = join(dir, "routine-inbox");
	const botInbox = join(dir, "bot-inbox");
	writeFileSync(bots, JSON.stringify({ bots: [{ id: "scout", name: "Scout", job, cwd: "/tmp", model: null, skill: null, sessionId: "s1", createdAt: "2026-05-01T09:00:00.000Z" }] }));
	if (routines) writeFileSync(routinesFile, JSON.stringify({ routines: [relayMail, standup, nightly] }));
	const flags = new Map<string, string>([
		[BOT_FLAGS.bot, "scout"],
		[BOT_FLAGS.bots, bots],
		[BOT_FLAGS.botInbox, botInbox],
		[BOT_FLAGS.memory, memory],
		[BOT_FLAGS.routines, routinesFile],
		[BOT_FLAGS.routineInbox, inbox],
	]);
	for (const name of unset) flags.delete(name);
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
	/** The requests the tools left in `inboxDir` for the dashboard, oldest first. */
	const left = (inboxDir: string) => (existsSync(inboxDir) ? readdirSync(inboxDir).sort().map(name => (name.endsWith(".json") ? JSON.parse(readFileSync(join(inboxDir, name), "utf8")) : name)) : []);
	return {
		memory,
		prompt,
		requests: () => left(inbox),
		jobRequests: () => left(botInbox),
		remember: (fact: string) => call("remember", { fact }),
		setJob: (job: string) => call("set_job", { job }),
		saveRoutine: (params: SaveRoutineParams) => call("save_routine", params),
		deleteRoutine: (id: string) => call("delete_routine", { id }),
	};
}

test("a fact the Bot remembers lands in its memory as a dated line, and the next turn's system prompt carries it with its name, job, and own routines, a long command cut short", async () => {
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
			"Your routines, one per line: its fields as `save_routine` takes them, then its task's kind and its prompt or command, cut at 80 characters:",
			'{"id":"r1","name":"Standup","enabled":false,"schedules":[{"kind":"weekly","days":[1,2,3,4,5],"time":{"hour":9,"minute":0}}],"triggers":[]} prompt: Post the standup.',
			'{"id":"r3","name":"Nightly build","enabled":true,"schedules":[],"triggers":[{"kind":"pull-request"}]} command: bun install --frozen-lockfile && bun run build && bun test --coverage --reporter…',
			"A routine runs on its schedules and when its triggers see something happen; each run messages this conversation with its prompt, or runs its shell command in your workspace and posts the output here. Call `save_routine` to create one, or to change one with its `id` and only the fields that change, and `delete_routine` to delete one.",
		].join("\n"),
	]);
});

test("before the Bot remembers anything or has a routine its prompt says so, and a subagent it spawns gets no Bot prompt", () => {
	const bot = loadedBot({ routines: false });
	expect(bot.prompt()?.[1]).toContain("What you remember from earlier turns:\nNothing yet.");
	expect(bot.prompt()?.[1]).toContain("cut at 80 characters:\nNone yet.\n");
	expect(bot.prompt("sub")).toBeUndefined();
});

test("a session the dashboard named no routine files for still gets its name, job, and memory, with no routines, and its routine tools refuse", async () => {
	const bot = loadedBot({ unset: [BOT_FLAGS.routines, BOT_FLAGS.routineInbox] });
	await bot.remember("The user prefers short answers.");
	const prompt = bot.prompt()?.[1] ?? "";
	expect(prompt).toStartWith("You are Scout, an omp-agents Bot");
	expect(prompt).toContain("Your job, and what you ask before doing:\nWatch the build.\nAsk before merging.\n");
	expect(prompt).toContain(" The user prefers short answers.\nWhen the user tells you");
	expect(prompt).toContain("cut at 80 characters:\nNone yet.\n");
	await expect(bot.saveRoutine({ name: "Digest", triggers: [{ kind: "gmail" }], task: { kind: "prompt", prompt: "Sum up the mail." } })).rejects.toThrow("This session is not an omp-agents Bot, so it has no routines.");
	await expect(bot.deleteRoutine("r1")).rejects.toThrow("This session is not an omp-agents Bot, so it has no routines.");
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

test("save_routine leaves the dashboard one request per call: a new routine of this Bot, enabled, then edits that keep every field they leave out", async () => {
	const bot = loadedBot();
	setSystemTime(new Date("2026-05-03T10:00:00.000Z"));
	const created = await bot.saveRoutine({ name: "Mail digest", triggers: [{ kind: "gmail" }, { kind: "slack" }], task: { kind: "command", command: "./digest.sh" } });
	const [request] = bot.requests();
	expect(request).toEqual({
		botId: "scout",
		change: { op: "save", routine: { id: expect.any(String), botId: "scout", name: "Mail digest", schedules: [], triggers: [{ kind: "gmail" }, { kind: "slack" }], task: { kind: "command", command: "./digest.sh" }, enabled: true } },
	});
	const newId: string = request.change.routine.id;
	expect(created.content[0]?.text).toBe(
		`Created routine "Mail digest". The dashboard applies it, and while the dashboard is stopped the change waits for it.\n{"id":"${newId}","name":"Mail digest","enabled":true,"schedules":[],"triggers":[{"kind":"gmail"},{"kind":"slack"}]} command: ./digest.sh`,
	);

	setSystemTime(new Date("2026-05-03T10:01:00.000Z"));
	await bot.saveRoutine({ id: "r1", triggers: [{ kind: "slack" }] });
	setSystemTime(new Date("2026-05-03T10:02:00.000Z"));
	await bot.saveRoutine({ id: "r3", enabled: false });
	expect(bot.requests()).toEqual([
		request,
		{
			botId: "scout",
			change: { op: "save", routine: { id: "r1", botId: "scout", name: "Standup", schedules: [weekdays], triggers: [{ kind: "slack" }], task: { kind: "prompt", prompt: "Post the standup." }, enabled: false } },
		},
		{
			botId: "scout",
			change: { op: "save", routine: { id: "r3", botId: "scout", name: "Nightly build", schedules: [], triggers: [{ kind: "pull-request" }], task: nightly.task, enabled: false } },
		},
	]);
});

test("delete_routine leaves the dashboard a request to delete one of this Bot's routines", async () => {
	const bot = loadedBot();
	expect((await bot.deleteRoutine("r1")).content[0]?.text).toBe('Deleted routine "Standup". The dashboard applies it, and while the dashboard is stopped the change waits for it.');
	expect(bot.requests()).toEqual([{ botId: "scout", change: { op: "remove", id: "r1" } }]);
});

test("the routine tools refuse another Bot's routine, an id no routine has, a new routine without a name or a task, and a routine with neither schedule nor trigger, and leave nothing", async () => {
	const bot = loadedBot();
	const relayEdit: SaveRoutineParams = { id: "r2", name: "Mine now", task: { kind: "prompt", prompt: "Take over." } };
	await expect(bot.saveRoutine(relayEdit)).rejects.toThrow("None of your routines has id r2; omit id to create a routine.");
	await expect(bot.deleteRoutine("r2")).rejects.toThrow("None of your routines has id r2.");
	await expect(bot.deleteRoutine("r9")).rejects.toThrow("None of your routines has id r9.");
	await expect(bot.saveRoutine({ schedules: [weekdays], task: { kind: "prompt", prompt: "Hello." } })).rejects.toThrow("The routine is not valid: a new routine needs a name and a task");
	await expect(bot.saveRoutine({ name: "Never", triggers: [{ kind: "gmail" }] })).rejects.toThrow("The routine is not valid: a new routine needs a name and a task");
	await expect(bot.saveRoutine({ name: "Never", schedules: [], triggers: [], task: { kind: "prompt", prompt: "Hello." } })).rejects.toThrow("The routine is not valid");
	await expect(bot.saveRoutine({ id: "r3", triggers: [] })).rejects.toThrow("The routine is not valid");
	expect(bot.requests()).toEqual([]);
});

test("set_job leaves the dashboard one request with this Bot's new job, and the next prompt still reads the job from bots.json, which only the dashboard saves", async () => {
	const bot = loadedBot({ job: "" });
	expect(bot.prompt()?.[1]).toContain("Your job, and what you ask before doing:\nNo job yet. Ask the user what it is, and what you should ask before doing, then call `set_job` with what they say.\n");
	expect((await bot.setJob("  Triage the inbox.\nAsk before replying.\n")).content[0]?.text).toBe("Saved your job. The dashboard applies it, and while the dashboard is stopped the change waits for it.");
	expect(bot.jobRequests()).toEqual([{ botId: "scout", job: "Triage the inbox.\nAsk before replying." }]);
	expect(bot.prompt()?.[1]).toContain("Your job, and what you ask before doing:\nNo job yet.");
});

test("set_job with an empty job asks to clear it, and refuses a job past the page's limit or a session with no bot inbox, leaving nothing", async () => {
	const bot = loadedBot();
	await expect(bot.setJob("x".repeat(MAX_JOB_LENGTH + 1))).rejects.toThrow(`job is ${MAX_JOB_LENGTH + 1} characters; keep it to at most ${MAX_JOB_LENGTH}.`);
	expect(bot.jobRequests()).toEqual([]);
	expect((await bot.setJob(" ")).content[0]?.text).toBe("Cleared your job. The dashboard applies it, and while the dashboard is stopped the change waits for it.");
	expect(bot.jobRequests()).toEqual([{ botId: "scout", job: "" }]);
	await expect(loadedBot({ unset: [BOT_FLAGS.botInbox] }).setJob("Watch the build.")).rejects.toThrow("This session is not an omp-agents Bot, so it has no job.");
});
