/** Bots: named, long-lived teammates, each one conversation with a job and a memory; how a change edits the list `bots.json` keeps, and which Bot the page and the file may hold. */
import { isNonEmpty, isObject, type Parsed } from "../json";
import { modelOfSelector } from "./models";
import { parseSkill } from "./sessions";

declare const BOT_ID: unique symbol;
/** A Bot's id, which the page picks when it creates one, so a save sent twice saves once. */
export type BotId = string & { readonly [BOT_ID]: true };

/** The shapes a Bot's avatar takes. */
export const BOT_SHAPES = ["circle", "triangle", "hexagon", "square", "cloud", "diamond", "clover", "pill"] as const;

export type BotShape = (typeof BOT_SHAPES)[number];

/** The avatar's hues on the OKLCH wheel, far enough apart that two Bots side by side read as different. */
export const BOT_HUES = [25, 70, 110, 150, 195, 235, 275, 320] as const;

export type BotHue = (typeof BOT_HUES)[number];

/** A Bot's avatar: the shape and color you pick for it. */
export interface BotLook {
	shape: BotShape;
	hue: BotHue;
}

/** The look a Bot saved before you could pick one gets, from its id, so it keeps the face it had. */
export function defaultLook(id: BotId): BotLook {
	let hash = 0;
	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return { shape: BOT_SHAPES[hash % BOT_SHAPES.length]!, hue: BOT_HUES[Math.floor(hash / BOT_SHAPES.length) % BOT_HUES.length]! };
}

export interface Bot extends BotLook {
	id: BotId;
	/** Shown in the sidebar and the Bot's header. */
	name: string;
	/** Markdown: what the Bot does, and what it asks before doing; empty until you give it one. */
	job: string;
	/** The workspace its conversation runs in. */
	cwd: string;
	/** `provider/id`; `null` for omp's default model. */
	model: string | null;
	skill: string | null;
	/** Its one conversation; `null` until its first message starts it. */
	sessionId: string | null;
	createdAt: string;
}

/** What the page edits of a Bot: all but its conversation and its creation time, which the server keeps. */
export type BotSpec = Omit<Bot, "sessionId" | "createdAt">;

/** One edit the page sends; `message` is the user's text for the Bot's conversation, which edits no Bot. */
export type BotChange =
	| { op: "save"; bot: BotSpec }
	| { op: "remove"; id: BotId }
	| { op: "message"; id: BotId; text: string };

/** What edits `bots.json`: a page's save or remove, or the server binding a Bot to the session its conversation runs in. */
export type BotEdit = Exclude<BotChange, { op: "message" }> | { op: "bind"; id: BotId; sessionId: string };

/** What a Bot's `set_job` tool asks of the server: Bot `botId`'s job becomes `job`, empty to clear it. */
export interface BotJobRequest {
	botId: BotId;
	job: string;
}

/** The longest job a Bot keeps, since every turn's system prompt carries it. */
export const MAX_JOB_LENGTH = 20_000;

/** The longest fact `remember` keeps, one short sentence; the tool refuses a longer one. */
export const MAX_FACT_LENGTH = 500;

/**
 * How much of a Bot's memory every turn's system prompt and every `bots` message carry: its newest whole lines within
 * this many bytes of `memory.md`'s end, so a memory that grows for months costs each turn the same.
 */
export const MAX_MEMORY_BYTES = 16 * 1024;

/** The last words of a Bot's conversation, which its sidebar row previews: when, in ms since the epoch, who said them, and the text as one line. */
export interface BotLast {
	at: number;
	from: "user" | "bot";
	text: string;
}

/** The tool a Bot's session writes its memory with; the page marks each finished call in the conversation. */
export const REMEMBER_TOOL = "remember";

/** `bots` after `edit`, or `bots` itself when it changes nothing. A save keeps the Bot's conversation; a remove forgets it but leaves its file. */
export function applyBot(bots: Bot[], edit: BotEdit, now: string): Bot[] {
	const id = edit.op === "save" ? edit.bot.id : edit.id;
	const index = bots.findIndex(bot => bot.id === id);
	const stored = bots[index];
	switch (edit.op) {
		case "save": {
			if (!stored) return [...bots, { ...edit.bot, sessionId: null, createdAt: now }];
			const { name, job, cwd, model, skill, shape, hue } = edit.bot;
			if (name === stored.name && job === stored.job && cwd === stored.cwd && model === stored.model && skill === stored.skill && shape === stored.shape && hue === stored.hue) return bots;
			return bots.with(index, { ...edit.bot, sessionId: stored.sessionId, createdAt: stored.createdAt });
		}
		case "remove":
			return stored ? bots.toSpliced(index, 1) : bots;
		case "bind":
			return !stored || stored.sessionId === edit.sessionId ? bots : bots.with(index, { ...stored, sessionId: edit.sessionId });
		default: {
			const unhandled: never = edit;
			return unhandled;
		}
	}
}

/** An id names the Bot's memory directory, so it holds no path separator or dot. */
export const parseBotId = (value: unknown): BotId | null => (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? (value as BotId) : null);

/** A Bot as the page saves it, or `null` when a field is missing, of the wrong type, or too long; other fields drop. A Bot saved without a look gets {@link defaultLook}. */
export function parseBotSpec(value: unknown): Parsed<BotSpec> {
	if (!isObject(value)) return null;
	const { name, job, cwd, model = null } = value;
	const id = parseBotId(value.id);
	const skill = parseSkill(value.skill);
	if (!id || !isNonEmpty(name) || typeof job !== "string" || job.length > MAX_JOB_LENGTH || !isNonEmpty(cwd) || !skill) return null;
	if (model !== null && (typeof model !== "string" || !modelOfSelector(model))) return null;
	const look = defaultLook(id);
	const { shape = look.shape, hue = look.hue } = value;
	if (!BOT_SHAPES.includes(shape as BotShape) || !BOT_HUES.includes(hue as BotHue)) return null;
	return { ok: { id, name: name.trim(), job, cwd, model, skill: skill.ok, shape: shape as BotShape, hue: hue as BotHue } };
}

function parseBot(value: unknown): Bot | null {
	const spec = parseBotSpec(value);
	if (!spec || !isObject(value)) return null;
	const { sessionId, createdAt } = value;
	if ((sessionId !== null && !isNonEmpty(sessionId)) || !isNonEmpty(createdAt)) return null;
	return { ...spec.ok, sessionId, createdAt };
}

/** `bots.json`'s list, or `null` when the file holds anything else. */
export function parseBots(value: unknown): Bot[] | null {
	if (!isObject(value) || !Array.isArray(value.bots)) return null;
	const bots: Bot[] = [];
	for (const entry of value.bots) {
		const bot = parseBot(entry);
		if (!bot) return null;
		bots.push(bot);
	}
	return bots;
}

/** A page's edit of the Bots, or `null` when it is not one. */
export function parseBotChange(value: unknown): BotChange | null {
	if (!isObject(value)) return null;
	switch (value.op) {
		case "save": {
			const bot = parseBotSpec(value.bot);
			return bot && { op: "save", bot: bot.ok };
		}
		case "remove": {
			const id = parseBotId(value.id);
			return id && { op: "remove", id };
		}
		case "message": {
			const id = parseBotId(value.id);
			return id && isNonEmpty(value.text) ? { op: "message", id, text: value.text } : null;
		}
		default:
			return null;
	}
}

/** A request a Bot's `set_job` tool leaves for the server, with the same limit as a job the page saves, or `null`. */
export function parseBotJobRequest(value: unknown): Parsed<BotJobRequest> {
	if (!isObject(value)) return null;
	const botId = parseBotId(value.botId);
	const { job } = value;
	return botId && typeof job === "string" && job.length <= MAX_JOB_LENGTH ? { ok: { botId, job } } : null;
}
