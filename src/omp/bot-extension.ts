// omp-agents Bots: gives a Bot's session its name, job, memory, and routines on every turn, the `remember` tool, the one
// writer of that memory, and the `save_routine` and `delete_routine` tools, which ask the dashboard to change the Bot's
// own routines. The dashboard loads it with `omp -e` and the flags in `BOT_FLAGS` for a Bot's session only
// (`Bots.join` in src/server/bots.ts), so no other session reads it.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { errorText, isObject, parseJson } from "../json";
import { readTail } from "../read-tail";
import { type BotRoutineRequest, MAX_COMMAND_LENGTH, parseRoutineSpec, type RoutineSpec, type RoutineTask, type Schedule, TRIGGER_KINDS, type TriggerKind } from "../routines";
import { type BotId, MAX_FACT_LENGTH, MAX_MEMORY_BYTES, parseBots, parseBotId, REMEMBER_TOOL } from "../shared/bots";

/**
 * The flags a Bot's session starts with: its id, the `bots.json` it reads its name and job from, its `memory.md`, the
 * `routines.json` it reads its routines from, and the directory its routine tools leave their requests in.
 */
export const BOT_FLAGS = {
	bot: "omp-agents-bot",
	bots: "omp-agents-bots",
	memory: "omp-agents-bot-memory",
	routines: "omp-agents-routines",
	routineInbox: "omp-agents-routine-inbox",
} as const;

/** What `save_routine` takes: a routine in the fields the page edits, with its triggers as their kinds. */
export interface SaveRoutineParams {
	/** One of the Bot's routines to change; none creates one. */
	id?: string;
	name: string;
	schedules: Schedule[];
	triggers: TriggerKind[];
	task: RoutineTask;
	/** None keeps a changed routine's, and enables a new one. */
	enabled?: boolean;
}

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

/** The routines the `routines.json` at `path` holds; none when it is missing or unreadable. */
function readRoutines(path: string): RoutineSpec[] {
	const value = parseJson(readText(path));
	if (!isObject(value) || !Array.isArray(value.routines)) return [];
	return value.routines.flatMap(entry => parseRoutineSpec(entry)?.ok ?? []);
}

/** `routine` as one line of JSON in `save_routine`'s fields, so the Bot can pass it back with its edits. */
const routineLine = ({ id, name, enabled, schedules, triggers, task }: RoutineSpec): string =>
	JSON.stringify({ id, name, enabled, schedules, triggers: triggers.map(({ kind }) => kind), task });

/** Leaves `request` in `dir` for the dashboard: written under a name it skips, then renamed, so it never reads half a file. */
function leave(dir: string, request: BotRoutineRequest): void {
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

const reply = (text: string): ToolResult => ({ content: [{ type: "text", text }], details: undefined });

const APPLIES = "The dashboard applies it, and while the dashboard is stopped the change waits for it.";

export default function botExtension(pi: BotExtensionApi): void {
	pi.registerFlag(BOT_FLAGS.bot, { type: "string", description: "The omp-agents Bot this session is." });
	pi.registerFlag(BOT_FLAGS.bots, { type: "string", description: "The omp-agents bots.json that holds its name and job." });
	pi.registerFlag(BOT_FLAGS.memory, { type: "string", description: "The memory.md the Bot remembers in." });
	pi.registerFlag(BOT_FLAGS.routines, { type: "string", description: "The omp-agents routines.json that holds its routines." });
	pi.registerFlag(BOT_FLAGS.routineInbox, { type: "string", description: "The directory its routine tools leave their changes in." });
	// omp sets an extension's flags once every extension has loaded, so each is read when it is used.
	const flag = (name: string): string | null => {
		const value = pi.getFlag(name);
		return typeof value === "string" && value !== "" ? value : null;
	};

	/** This Bot, its routines as the file holds them now, and where its routine tools leave their changes. */
	const ownRoutines = (): { botId: BotId; mine: RoutineSpec[]; inbox: string } => {
		const botId = parseBotId(flag(BOT_FLAGS.bot));
		const routinesPath = flag(BOT_FLAGS.routines);
		const inbox = flag(BOT_FLAGS.routineInbox);
		if (!botId || !routinesPath || !inbox) throw new Error("This session is not an omp-agents Bot, so it has no routines.");
		return { botId, mine: readRoutines(routinesPath).filter(routine => routine.botId === botId), inbox };
	};

	pi.on("before_agent_start", (event, ctx) => {
		const id = parseBotId(flag(BOT_FLAGS.bot));
		const botsPath = flag(BOT_FLAGS.bots);
		const memoryPath = flag(BOT_FLAGS.memory);
		const routinesPath = flag(BOT_FLAGS.routines);
		if (ctx.agent.kind === "sub" || !id || !botsPath || !memoryPath || !routinesPath) return undefined;
		const bot = parseBots(parseJson(readText(botsPath)))?.find(bot => bot.id === id);
		if (!bot) return undefined;
		let memory: { text: string; cut: boolean } | null = null;
		try {
			memory = readTail(memoryPath, MAX_MEMORY_BYTES);
		} catch {
			// An unreadable memory leaves this turn without it rather than stopping it.
		}
		const routines = readRoutines(routinesPath).filter(routine => routine.botId === id);
		const prompt = [
			`You are ${bot.name}, an omp-agents Bot: a teammate the user keeps, with this one conversation they come back to.`,
			"Your job, and what you ask before doing:",
			bot.job.trim() || "No job yet. Ask the user what it is, and what you should ask before doing, then `remember` what they say.",
			"What you remember from earlier turns:",
			...(memory?.cut ? ["(Older memory was cut to keep this prompt short; only the newest facts follow.)"] : []),
			memory?.text.trim() || "Nothing yet.",
			"When the user tells you something worth keeping across turns, such as a preference, a decision, or a fact about the work, call `remember` with it as one short sentence.",
			"Your routines, one per line in the fields `save_routine` takes:",
			...(routines.length > 0 ? routines.map(routineLine) : ["None yet."]),
			"A routine runs on its schedules and when its triggers see something happen; each run messages this conversation with its prompt, or runs its shell command in your workspace and posts the output here. Call `save_routine` to create or change one, and `delete_routine` to delete one.",
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
			const memoryPath = flag(BOT_FLAGS.memory);
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
		{ description: "What each run does." },
	);

	pi.registerTool<SaveRoutineParams>({
		name: "save_routine",
		label: "Save routine",
		description:
			"Creates one of this Bot's routines, or changes one, replacing all its fields: pass the routine's line from the system prompt with your edits. The user sees it under the Bot's Routines. A routine needs at least one schedule or trigger.",
		parameters: Type.Object({
			id: Type.Optional(Type.String({ minLength: 1, description: "The id of one of your routines, to change it; omit it to create a routine." })),
			name: Type.String({ minLength: 1, description: "A short name the user knows the routine by." }),
			schedules: Type.Array(schedule, { description: "When it runs; empty when only its triggers run it." }),
			triggers: Type.Array(Type.Union(TRIGGER_KINDS.map(kind => Type.Literal(kind))), {
				uniqueItems: true,
				description:
					"What else runs it, each at most once: slack, a Slack message that waits on the user; pull-request, a pull request that becomes the user's move; event, a calendar event about to start; gmail, unread mail in a Gmail inbox.",
			}),
			task,
			enabled: Type.Optional(Type.Boolean({ description: "Whether it runs; omit it to keep a routine's as it is, or to enable a new one." })),
		}),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, params) {
			const { botId, mine, inbox } = ownRoutines();
			const stored = params.id === undefined ? undefined : mine.find(routine => routine.id === params.id);
			if (params.id !== undefined && !stored) throw new Error(`None of your routines has id ${params.id}; omit id to create a routine.`);
			const spec = parseRoutineSpec({
				id: params.id ?? randomUUID(),
				botId,
				name: params.name,
				schedules: params.schedules,
				triggers: params.triggers.map(kind => ({ kind })),
				task: params.task,
				enabled: params.enabled ?? stored?.enabled ?? true,
			});
			if (!spec) {
				throw new Error(
					`The routine is not valid: it needs a name, at least one schedule or trigger, schedules in range, each trigger kind at most once, and a prompt or a command that is not empty, a command at most ${MAX_COMMAND_LENGTH} characters.`,
				);
			}
			leave(inbox, { botId, change: { op: "save", routine: spec.ok } });
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
			const { botId, mine, inbox } = ownRoutines();
			const stored = mine.find(routine => routine.id === id);
			if (!stored) throw new Error(`None of your routines has id ${id}.`);
			leave(inbox, { botId, change: { op: "remove", id } });
			return reply(`Deleted routine "${stored.name}". ${APPLIES}`);
		},
	});
}
