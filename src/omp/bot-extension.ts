// omp-agents Bots: gives a Bot's session its name, job, and memory on every turn, and the `remember` tool, the one
// writer of that memory. The dashboard loads it with `omp -e` and the flags in `BOT_FLAGS` for a Bot's session only
// (`Bots.join` in src/server/bots.ts), so no other session reads it.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorText, parseJson } from "../json";
import { parseBots, parseBotId, REMEMBER_TOOL } from "../shared/bots";

/** The flags a Bot's session starts with: its id, the `bots.json` it reads its name and job from, and its `memory.md`. */
export const BOT_FLAGS = { bot: "omp-agents-bot", bots: "omp-agents-bots", memory: "omp-agents-bot-memory" } as const;

interface ToolResult {
	content: { type: "text"; text: string }[];
	details: undefined;
}

/** The part of omp's `ExtensionAPI` this uses, by hand: `tsc` cannot resolve omp's own package here. */
export interface BotExtensionApi {
	registerFlag(name: string, options: { type: "string"; description: string }): void;
	getFlag(name: string): boolean | string | undefined;
	on(event: "before_agent_start", handler: (event: { systemPrompt: string[] }, ctx: { agent: { kind: "main" | "sub" } }) => { systemPrompt: string[] } | undefined): void;
	registerTool(tool: {
		name: string;
		label: string;
		description: string;
		parameters: unknown;
		loadMode: "essential";
		approval: "write";
		execute(toolCallId: string, params: { fact: string }): Promise<ToolResult>;
	}): void;
	typebox: { Type: { Object(properties: Record<string, unknown>): unknown; String(options: { description: string }): unknown } };
}

function readText(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

export default function botExtension(pi: BotExtensionApi): void {
	pi.registerFlag(BOT_FLAGS.bot, { type: "string", description: "The omp-agents Bot this session is." });
	pi.registerFlag(BOT_FLAGS.bots, { type: "string", description: "The omp-agents bots.json that holds its name and job." });
	pi.registerFlag(BOT_FLAGS.memory, { type: "string", description: "The memory.md the Bot remembers in." });
	// omp sets an extension's flags once every extension has loaded, so each is read when it is used.
	const flag = (name: string): string | null => {
		const value = pi.getFlag(name);
		return typeof value === "string" && value !== "" ? value : null;
	};

	pi.on("before_agent_start", (event, ctx) => {
		const id = parseBotId(flag(BOT_FLAGS.bot));
		const botsPath = flag(BOT_FLAGS.bots);
		const memoryPath = flag(BOT_FLAGS.memory);
		if (ctx.agent.kind === "sub" || !id || !botsPath || !memoryPath) return undefined;
		const bot = parseBots(parseJson(readText(botsPath)))?.find(bot => bot.id === id);
		if (!bot) return undefined;
		const memory = readText(memoryPath).trim();
		const prompt = [
			`You are ${bot.name}, an omp-agents Bot: a teammate the user keeps, with this one conversation they come back to.`,
			"Your job, and what you ask before doing:",
			bot.job.trim() || "No job yet. Ask the user what it is.",
			"What you remember from earlier turns:",
			memory || "Nothing yet.",
			"When the user tells you something worth keeping across turns, such as a preference, a decision, or a fact about the work, call `remember` with it as one short sentence.",
		].join("\n");
		return { systemPrompt: [...event.systemPrompt, prompt] };
	});

	pi.registerTool({
		name: REMEMBER_TOOL,
		label: "Remember",
		description: "Adds one fact to this Bot's memory, which every later turn's system prompt carries. Use one short sentence that stays true.",
		parameters: pi.typebox.Type.Object({ fact: pi.typebox.Type.String({ description: "The fact, as one short sentence." }) }),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { fact }) {
			const memoryPath = flag(BOT_FLAGS.memory);
			const line = fact.replace(/\s+/g, " ").trim();
			if (!memoryPath) throw new Error("This session is not an omp-agents Bot, so it has no memory.");
			if (!line) throw new Error("fact is empty.");
			try {
				mkdirSync(dirname(memoryPath), { recursive: true });
				appendFileSync(memoryPath, `- ${new Date().toISOString().slice(0, 10)} ${line}\n`);
			} catch (error) {
				throw new Error(`Cannot write the memory: ${errorText(error)}`);
			}
			return { content: [{ type: "text", text: `Remembered: ${line}` }], details: undefined };
		},
	});
}
