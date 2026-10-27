import { afterEach, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_FACT_LENGTH } from "../shared/bots";
import botExtension, { BOT_FLAGS, type BotExtensionApi } from "./bot-extension";

const dirs: string[] = [];
afterEach(() => {
	setSystemTime();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Handler = Parameters<BotExtensionApi["on"]>[1];
type Tool = Parameters<BotExtensionApi["registerTool"]>[0];

/** The extension loaded as omp loads it for Bot `scout`, whose memory file does not exist yet. */
function loadedBot() {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-bot-extension-"));
	dirs.push(dir);
	const bots = join(dir, "bots.json");
	const memory = join(dir, "bots", "scout", "memory.md");
	writeFileSync(bots, JSON.stringify({ bots: [{ id: "scout", name: "Scout", job: "Watch the build.\nAsk before merging.", cwd: "/tmp", model: null, skill: null, sessionId: "s1", createdAt: "2026-05-01T09:00:00.000Z" }] }));
	const flags = new Map<string, string>([[BOT_FLAGS.bot, "scout"], [BOT_FLAGS.bots, bots], [BOT_FLAGS.memory, memory]]);
	let handler: Handler | undefined;
	let tool: Tool | undefined;
	botExtension({
		registerFlag() {},
		getFlag: name => flags.get(name),
		on: (_event, registered) => void (handler = registered),
		registerTool: registered => void (tool = registered),
		typebox: { Type: { Object: properties => properties, String: options => options } },
	});
	const prompt = (kind: "main" | "sub" = "main") => handler!({ systemPrompt: ["base"] }, { agent: { kind } })?.systemPrompt;
	return { memory, prompt, remember: (fact: string) => tool!.execute("call-1", { fact }) };
}

test("a fact the Bot remembers lands in its memory as a dated line, and the next turn's system prompt carries it with its name and job", async () => {
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
		].join("\n"),
	]);
});

test("before the Bot remembers anything its prompt says so, and a subagent it spawns gets no Bot prompt", () => {
	const bot = loadedBot();
	expect(bot.prompt()?.[1]).toContain("What you remember from earlier turns:\nNothing yet.");
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
