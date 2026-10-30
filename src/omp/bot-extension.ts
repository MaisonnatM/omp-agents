// omp-agents Bots: gives a Bot's session its name, job, memory, and routines on every turn, the `remember` tool, the one
// writer of that memory, the `set_job` tool, which asks the dashboard to change the Bot's job, and the `save_routine` and
// `delete_routine` tools, which ask it to change the Bot's own routines. The dashboard loads it with `omp -e` and the
// flags in `BOT_FLAGS` for a Bot's session only (`Bots.join` in src/server/bots.ts), so no other session reads it.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { errorText, isObject, parseJson } from "../json";
import { readTail } from "../read-tail";
import { type BotRoutineRequest, MAX_COMMAND_LENGTH, parseRoutineSpec, type RoutineSpec, TRIGGER_KINDS } from "../routines";
import { type BotId, type BotJobRequest, MAX_FACT_LENGTH, MAX_JOB_LENGTH, MAX_MEMORY_BYTES, parseBots, parseBotId, REMEMBER_TOOL } from "../shared/bots";
import type { ShepherdRequest } from "../shared/shepherd";

/**
 * The flags a Bot's session starts with: its id, the `bots.json` it reads its name and job from, the directory its
 * `set_job` tool leaves its job in, its `memory.md`, the `routines.json` it reads its routines from, and the directory its
 * routine tools leave their requests in.
 */
export const BOT_FLAGS = {
	bot: "omp-agents-bot",
	bots: "omp-agents-bots",
	botInbox: "omp-agents-bot-inbox",
	memory: "omp-agents-bot-memory",
	routines: "omp-agents-routines",
	routineInbox: "omp-agents-routine-inbox",
} as const;

/** What `save_routine` takes: `id` names one of the Bot's routines to change, and every field left out keeps its value; without `id` it creates one. */
export type SaveRoutineParams = Partial<Omit<RoutineSpec, "botId">>;

interface ToolResult {
	content: { type: "text"; text: string }[];
	details: undefined;
}

export interface BotTool<Params> {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	loadMode: "essential";
	approval: "write";
	execute(toolCallId: string, params: Params): Promise<ToolResult>;
}

interface SchemaOptions {
	description?: string;
}

/** The part of omp's `ExtensionAPI` this uses, by hand: `tsc` cannot resolve omp's own package here. */
export interface BotExtensionApi {
	registerFlag(name: string, options: { type: "string"; description: string }): void;
	getFlag(name: string): boolean | string | undefined;
	on(event: "before_agent_start", handler: (event: { systemPrompt: string[] }, ctx: { agent: { kind: "main" | "sub" } }) => { systemPrompt: string[] } | undefined): void;
	registerTool<Params>(tool: BotTool<Params>): void;
	/** omptype's TypeBox shim, `@oh-my-pi/omptype/typebox`. */
	typebox: {
		Type: {
			Object(properties: Record<string, unknown>, options?: SchemaOptions): unknown;
			String(options: SchemaOptions & { minLength?: number; maxLength?: number }): unknown;
			Integer(options: SchemaOptions & { minimum?: number; maximum?: number }): unknown;
			Boolean(options: SchemaOptions): unknown;
			Literal(value: string): unknown;
			Union(schemas: unknown[], options?: SchemaOptions): unknown;
			Array(items: unknown, options: SchemaOptions & { minItems?: number; uniqueItems?: boolean }): unknown;
			Optional(schema: unknown): unknown;
		};
	};
}

function readText(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

/** How much of a routine's prompt or command its line in the system prompt shows. */
const TASK_PREVIEW_LENGTH = 80;

/** `routine` as one short line: its fields as `save_routine` takes them, then its task's kind and the start of its prompt or command. */
function routineLine({ id, name, enabled, schedules, triggers, task }: RoutineSpec): string {
	const text = (task.kind === "prompt" ? task.prompt : task.command).replace(/\s+/g, " ").trim();
	const preview = text.length > TASK_PREVIEW_LENGTH ? `${text.slice(0, TASK_PREVIEW_LENGTH)}…` : text;
	return `${JSON.stringify({ id, name, enabled, schedules, triggers })} ${task.kind}: ${preview}`;
}

/** Leaves `request` in `dir` for the dashboard: written under a name it skips, then renamed, so it never reads half a file. */
export function leave(dir: string, request: BotRoutineRequest | BotJobRequest | ShepherdRequest): void {
	try {
		mkdirSync(dir, { recursive: true });
		const name = `${Date.now()}-${randomUUID()}`;
		const temp = join(dir, `${name}.tmp`);
		writeFileSync(temp, JSON.stringify(request));
		renameSync(temp, join(dir, `${name}.json`));
	} catch (error) {
		throw new Error(`Cannot leave the change for the dashboard: ${errorText(error)}`);
	}
}

export const reply = (text: string): ToolResult => ({ content: [{ type: "text", text }], details: undefined });

const APPLIES = "The dashboard applies it, and while the dashboard is stopped the change waits for it.";
const NO_ROUTINES = "This session is not an omp-agents Bot, so it has no routines.";

/** A Bot's session as its flags name it: the Bot, its `bots.json` and `memory.md`, and its inboxes and `routines.json`, `null` when the dashboard passed none. */
interface ThisBot {
	botId: BotId;
	botsPath: string;
	memoryPath: string;
	botInbox: string | null;
	routinesPath: string | null;
	routineInbox: string | null;
}

export default function botExtension(pi: BotExtensionApi): void {
	pi.registerFlag(BOT_FLAGS.bot, { type: "string", description: "The omp-agents Bot this session is." });
	pi.registerFlag(BOT_FLAGS.bots, { type: "string", description: "The omp-agents bots.json that holds its name and job." });
	pi.registerFlag(BOT_FLAGS.botInbox, { type: "string", description: "The directory its set_job tool leaves its job in." });
	pi.registerFlag(BOT_FLAGS.memory, { type: "string", description: "The memory.md the Bot remembers in." });
	pi.registerFlag(BOT_FLAGS.routines, { type: "string", description: "The omp-agents routines.json that holds its routines." });
	pi.registerFlag(BOT_FLAGS.routineInbox, { type: "string", description: "The directory its routine tools leave their changes in." });
	// omp sets an extension's flags once every extension has loaded, so each is read when it is used.
	const flag = (name: string): string | null => {
		const value = pi.getFlag(name);
		return typeof value === "string" && value !== "" ? value : null;
	};

	/** This session's Bot, or `null` when it is not one. */
	const thisBot = (): ThisBot | null => {
		const botId = parseBotId(flag(BOT_FLAGS.bot));
		const botsPath = flag(BOT_FLAGS.bots);
		const memoryPath = flag(BOT_FLAGS.memory);
		if (!botId || !botsPath || !memoryPath) return null;
		return { botId, botsPath, memoryPath, botInbox: flag(BOT_FLAGS.botInbox), routinesPath: flag(BOT_FLAGS.routines), routineInbox: flag(BOT_FLAGS.routineInbox) };
	};

	/** The Bot's routines as `routines.json` holds them now; none when the file is missing or unreadable, or the dashboard named none. */
	const ownRoutines = ({ botId, routinesPath }: ThisBot): RoutineSpec[] => {
		const value = routinesPath === null ? null : parseJson(readText(routinesPath));
		if (!isObject(value) || !Array.isArray(value.routines)) return [];
		return value.routines.flatMap(entry => parseRoutineSpec(entry)?.ok ?? []).filter(routine => routine.botId === botId);
	};

	pi.on("before_agent_start", (event, ctx) => {
		const me = thisBot();
		if (ctx.agent.kind === "sub" || !me) return undefined;
		const bot = parseBots(parseJson(readText(me.botsPath)))?.find(bot => bot.id === me.botId);
		if (!bot) return undefined;
		let memory: { text: string; cut: boolean } | null = null;
		try {
			memory = readTail(me.memoryPath, MAX_MEMORY_BYTES);
		} catch {
			// An unreadable memory leaves this turn without it rather than stopping it.
		}
		const routines = ownRoutines(me);
		const prompt = [
			`You are ${bot.name}, an omp-agents Bot: a teammate the user keeps, with this one conversation they come back to.`,
			"Your job, and what you ask before doing:",
			bot.job.trim() || "No job yet. Ask the user what it is, and what you should ask before doing, then call `set_job` with what they say.",
			"What you remember from earlier turns:",
			...(memory?.cut ? ["(Older memory was cut to keep this prompt short; only the newest facts follow.)"] : []),
			memory?.text.trim() || "Nothing yet.",
			"When the user tells you something worth keeping across turns, such as a preference, a decision, or a fact about the work, call `remember` with it as one short sentence.",
			`Your routines, one per line: its fields as \`save_routine\` takes them, then its task's kind and its prompt or command, cut at ${TASK_PREVIEW_LENGTH} characters:`,
			...(routines.length > 0 ? routines.map(routineLine) : ["None yet."]),
			"A routine runs on its schedules and when its triggers see something happen; each run messages this conversation with its prompt, or runs its shell command in your workspace and posts the output here. Call `save_routine` to create one, or to change one with its `id` and only the fields that change, and `delete_routine` to delete one.",
		].join("\n");
		return { systemPrompt: [...event.systemPrompt, prompt] };
	});

	pi.registerTool<{ fact: string }>({
		name: REMEMBER_TOOL,
		label: "Remember",
		description: `Adds one fact to this Bot's memory, which every later turn's system prompt carries. Use one short sentence that stays true, at most ${MAX_FACT_LENGTH} characters.`,
		parameters: pi.typebox.Type.Object({ fact: pi.typebox.Type.String({ description: "The fact, as one short sentence.", maxLength: MAX_FACT_LENGTH }) }),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { fact }) {
			const memoryPath = thisBot()?.memoryPath;
			const line = fact.replace(/\s+/g, " ").trim();
			if (!memoryPath) throw new Error("This session is not an omp-agents Bot, so it has no memory.");
			if (!line) throw new Error("fact is empty.");
			if (line.length > MAX_FACT_LENGTH) throw new Error(`fact is ${line.length} characters; keep it to one short sentence of at most ${MAX_FACT_LENGTH}.`);
			try {
				mkdirSync(dirname(memoryPath), { recursive: true });
				appendFileSync(memoryPath, `- ${new Date().toISOString().slice(0, 10)} ${line}\n`);
			} catch (error) {
				throw new Error(`Cannot write the memory: ${errorText(error)}`);
			}
			return reply(`Remembered: ${line}`);
		},
	});

	pi.registerTool<{ job: string }>({
		name: "set_job",
		label: "Set job",
		description: `Replaces this Bot's job, which every later turn's system prompt carries and the user sees in the Bot's Job field: Markdown on what the Bot does and what it asks before doing, at most ${MAX_JOB_LENGTH} characters. An empty job clears it.`,
		parameters: pi.typebox.Type.Object({ job: pi.typebox.Type.String({ description: "The whole job, as Markdown; empty to clear it.", maxLength: MAX_JOB_LENGTH }) }),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { job }) {
			const bot = thisBot();
			if (!bot?.botInbox) throw new Error("This session is not an omp-agents Bot, so it has no job.");
			const text = job.trim();
			if (text.length > MAX_JOB_LENGTH) throw new Error(`job is ${text.length} characters; keep it to at most ${MAX_JOB_LENGTH}.`);
			leave(bot.botInbox, { botId: bot.botId, job: text });
			return reply(`${text ? "Saved your job" : "Cleared your job"}. ${APPLIES}`);
		},
	});

	const { Type } = pi.typebox;
	const integer = (minimum: number, maximum: number, description?: string) => Type.Integer({ minimum, maximum, description });
	const schedule = Type.Union(
		[
			Type.Object({ kind: Type.Literal("every"), minutes: Type.Integer({ minimum: 1, description: "Minutes between runs, counted from the last scheduled run." }) }),
			Type.Object({
				kind: Type.Literal("weekly"),
				days: Type.Array(integer(0, 6), { minItems: 1, uniqueItems: true, description: "The weekdays it runs on, 0 for Sunday; all seven for daily." }),
				time: Type.Object({ hour: integer(0, 23), minute: integer(0, 59) }, { description: "The local time it runs at." }),
			}),
		],
		{ description: "every: every so many minutes; weekly: at a local time on chosen weekdays." },
	);
	const task = Type.Union(
		[
			Type.Object({ kind: Type.Literal("prompt"), prompt: Type.String({ minLength: 1, description: "The message each run sends into this conversation." }) }),
			Type.Object({
				kind: Type.Literal("command"),
				command: Type.String({ minLength: 1, maxLength: MAX_COMMAND_LENGTH, description: "The shell command each run runs in this Bot's workspace; its output is posted here." }),
			}),
		],
		{ description: "What each run does; a new routine needs one." },
	);

	pi.registerTool<SaveRoutineParams>({
		name: "save_routine",
		label: "Save routine",
		description:
			"Creates one of this Bot's routines, or changes one. To change a routine, pass its `id` from the system prompt and only the fields that change; the rest keep their values. To create one, leave out `id` and pass a `name`, a `task`, and at least one schedule or trigger. The user sees it under the Bot's Routines.",
		parameters: Type.Object({
			id: Type.Optional(Type.String({ minLength: 1, description: "The id of one of your routines, to change it; omit it to create a routine." })),
			name: Type.Optional(Type.String({ minLength: 1, description: "A short name the user knows the routine by; a new routine needs one." })),
			schedules: Type.Optional(Type.Array(schedule, { description: "When it runs; empty when only its triggers run it." })),
			triggers: Type.Optional(
				Type.Array(Type.Object({ kind: Type.Union(TRIGGER_KINDS.map(kind => Type.Literal(kind))) }), {
					uniqueItems: true,
					description:
						"What else runs it, each kind at most once: slack, a Slack message that waits on the user; pull-request, a pull request that becomes the user's move; event, a calendar event about to start; gmail, unread mail in a Gmail inbox.",
				}),
			),
			task: Type.Optional(task),
			enabled: Type.Optional(Type.Boolean({ description: "Whether it runs; a new routine runs unless this is false." })),
		}),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { id, ...fields }) {
			const bot = thisBot();
			if (!bot?.routineInbox) throw new Error(NO_ROUTINES);
			const stored = id === undefined ? undefined : ownRoutines(bot).find(routine => routine.id === id);
			if (id !== undefined && !stored) throw new Error(`None of your routines has id ${id}; omit id to create a routine.`);
			const spec = parseRoutineSpec({ schedules: [], triggers: [], enabled: true, ...stored, ...fields, id: id ?? randomUUID(), botId: bot.botId });
			if (!spec) {
				throw new Error(
					`The routine is not valid: a new routine needs a name and a task, and every routine needs at least one schedule or trigger, schedules in range, each trigger kind at most once, and a prompt or a command that is not empty, a command at most ${MAX_COMMAND_LENGTH} characters.`,
				);
			}
			leave(bot.routineInbox, { botId: bot.botId, change: { op: "save", routine: spec.ok } });
			return reply(`${stored ? "Changed" : "Created"} routine "${spec.ok.name}". ${APPLIES}\n${routineLine(spec.ok)}`);
		},
	});

	pi.registerTool<{ id: string }>({
		name: "delete_routine",
		label: "Delete routine",
		description: "Deletes one of this Bot's routines, by its id from the system prompt.",
		parameters: Type.Object({ id: Type.String({ minLength: 1, description: "The id of one of your routines." }) }),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { id }) {
			const bot = thisBot();
			if (!bot?.routineInbox) throw new Error(NO_ROUTINES);
			const stored = ownRoutines(bot).find(routine => routine.id === id);
			if (!stored) throw new Error(`None of your routines has id ${id}.`);
			leave(bot.routineInbox, { botId: bot.botId, change: { op: "remove", id } });
			return reply(`Deleted routine "${stored.name}". ${APPLIES}`);
		},
	});
}
