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

/**
 * What a Bot is for, picked when it is made and kept after: `bot-designer` asks what Bot you want and creates it,
 * `routines` works through its routines and conversation alone, and `pr-shepherd` also drives your approved pull
 * requests to merged; each but `routines` through the tools only its session loads.
 */
export const BOT_KINDS = ["bot-designer", "routines", "pr-shepherd"] as const;

export type BotKind = (typeof BOT_KINDS)[number];

/** How the New Bot form offers each kind. */
export const BOT_KIND_INFO: Record<BotKind, { label: string; description: string }> = {
	"bot-designer": { label: "Bot designer", description: "Asks a few questions about the Bot you want, then creates it for you." },
	routines: { label: "Routines", description: "Works through its conversation and the routines you give it." },
	"pr-shepherd": {
		label: "PR shepherd",
		description: "Watches your approved pull requests and fixes conflicts, failing checks, and review comments until they merge.",
	},
};

export interface Bot extends BotLook {
	id: BotId;
	kind: BotKind;
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
	/** Listed under Pinned, above every section, whatever its section. */
	pinned: boolean;
	/** The name of the section it lists under while it is not pinned, `null` for none; a section exists while a Bot names it. */
	section: string | null;
}

/** What the page edits of a Bot: all but its conversation, its creation time, and where it lists, which a save keeps. */
export type BotSpec = Omit<Bot, "sessionId" | "createdAt" | "pinned" | "section">;

/** The longest section name a Bot keeps, which fits the sidebar's group label. */
export const MAX_SECTION_LENGTH = 60;

/**
 * One edit the page sends; `message` is the user's text for the Bot's conversation, which edits no Bot. `rename-section`
 * moves every Bot of section `from` to `to`, or out of any section for `null`, which removes the section.
 */
export type BotChange =
	| { op: "save"; bot: BotSpec }
	| { op: "remove"; id: BotId }
	| { op: "pin"; id: BotId; pinned: boolean }
	| { op: "move"; id: BotId; section: string | null }
	| { op: "rename-section"; from: string; to: string | null }
	| { op: "message"; id: BotId; text: string };

/** What edits `bots.json`: a page's change of a Bot or of where Bots list, or the server binding a Bot to the session its conversation runs in. */
export type BotEdit = Exclude<BotChange, { op: "message" }> | { op: "bind"; id: BotId; sessionId: string };

/** What a Bot's `set_job` tool asks of the server: Bot `botId`'s job becomes `job`, empty to clear it. */
export interface BotJobRequest {
	botId: BotId;
	job: string;
}

/** The Bot a designer's `create_bot` tool names: its id, minted by the tool so a request read twice creates once, and its workspace. */
export type BotCreate = Pick<BotSpec, "id" | "kind" | "name" | "job" | "cwd">;

/** What a Bot designer's `create_bot` tool asks of the server: designer `botId` creates the Bot `create`. */
export interface BotCreateRequest {
	botId: BotId;
	create: BotCreate;
}

/** A request a Bot's tool leaves in `bot-inbox/`: a `set_job`'s job, or a designer's new Bot. */
export type BotInboxRequest = ({ op: "job" } & BotJobRequest) | ({ op: "create" } & BotCreateRequest);

/** The longest job a Bot keeps, since every turn's system prompt carries it. */
export const MAX_JOB_LENGTH = 20_000;

/** The longest fact `remember` keeps, one short sentence; the tool refuses a longer one. */
export const MAX_FACT_LENGTH = 500;

/**
 * How much of a Bot's memory every turn's system prompt and every `bots` message carry: its newest whole lines within
 * this many bytes of `memory.md`'s end, so a memory that grows for months costs each turn the same.
 */
export const MAX_MEMORY_BYTES = 16 * 1024;

/**
 * The last words of a Bot's conversation, which its sidebar row previews: when, in ms since the epoch, who said them,
 * and the text as one line; a routine's message names the routine as of the send.
 */
export type BotLast = { at: number; from: "user" | "bot"; text: string } | { at: number; from: "routine"; name: string; text: string };

/** The tool a Bot's session writes its memory with; the page marks each finished call in the conversation. */
export const REMEMBER_TOOL = "remember";

/**
 * `bots` after `edit`, or `bots` itself when it changes nothing. A save keeps the Bot's conversation, its kind, and where
 * it lists; a remove forgets it but leaves its file.
 */
export function applyBot(bots: Bot[], edit: BotEdit, now: string): Bot[] {
	if (edit.op === "rename-section") {
		if (!bots.some(bot => bot.section === edit.from) || edit.from === edit.to) return bots;
		return bots.map(bot => (bot.section === edit.from ? { ...bot, section: edit.to } : bot));
	}
	const id = edit.op === "save" ? edit.bot.id : edit.id;
	const index = bots.findIndex(bot => bot.id === id);
	const stored = bots[index];
	switch (edit.op) {
		case "save": {
			if (!stored) return [...bots, { ...edit.bot, sessionId: null, createdAt: now, pinned: false, section: null }];
			const { name, job, cwd, model, skill, shape, hue } = edit.bot;
			if (name === stored.name && job === stored.job && cwd === stored.cwd && model === stored.model && skill === stored.skill && shape === stored.shape && hue === stored.hue) return bots;
			return bots.with(index, { ...stored, ...edit.bot, kind: stored.kind });
		}
		case "remove":
			return stored ? bots.toSpliced(index, 1) : bots;
		case "bind":
			return !stored || stored.sessionId === edit.sessionId ? bots : bots.with(index, { ...stored, sessionId: edit.sessionId });
		case "pin":
			return !stored || stored.pinned === edit.pinned ? bots : bots.with(index, { ...stored, pinned: edit.pinned });
		case "move":
			return !stored || stored.section === edit.section ? bots : bots.with(index, { ...stored, section: edit.section });
		default: {
			const unhandled: never = edit;
			return unhandled;
		}
	}
}

/** A section's name as typed, trimmed, or `null` when it is blank, too long, or not a string. */
export function parseSectionName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.trim();
	return name && name.length <= MAX_SECTION_LENGTH ? name : null;
}

/** An id names the Bot's memory directory, so it holds no path separator or dot. */
export const parseBotId = (value: unknown): BotId | null => (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? (value as BotId) : null);

/**
 * A Bot as the page saves it, or `null` when a field is missing, of the wrong type, or too long; other fields drop. A Bot
 * saved without a look gets {@link defaultLook}, and one saved before kinds existed is a `routines` Bot.
 */
export function parseBotSpec(value: unknown): Parsed<BotSpec> {
	if (!isObject(value)) return null;
	const { name, job, cwd, model = null, kind = "routines" } = value;
	const id = parseBotId(value.id);
	const skill = parseSkill(value.skill);
	if (!id || !isNonEmpty(name) || typeof job !== "string" || job.length > MAX_JOB_LENGTH || !isNonEmpty(cwd) || !skill) return null;
	if (model !== null && (typeof model !== "string" || !modelOfSelector(model))) return null;
	if (!BOT_KINDS.includes(kind as BotKind)) return null;
	const look = defaultLook(id);
	const { shape = look.shape, hue = look.hue } = value;
	if (!BOT_SHAPES.includes(shape as BotShape) || !BOT_HUES.includes(hue as BotHue)) return null;
	return { ok: { id, kind: kind as BotKind, name: name.trim(), job, cwd, model, skill: skill.ok, shape: shape as BotShape, hue: hue as BotHue } };
}

/** A saved Bot; one saved before it could be pinned or put in a section is neither. */
function parseBot(value: unknown): Bot | null {
	const spec = parseBotSpec(value);
	if (!spec || !isObject(value)) return null;
	const { sessionId, createdAt, pinned = false, section = null } = value;
	if ((sessionId !== null && !isNonEmpty(sessionId)) || !isNonEmpty(createdAt) || typeof pinned !== "boolean") return null;
	const home = section === null ? null : parseSectionName(section);
	if (section !== null && home === null) return null;
	return { ...spec.ok, sessionId, createdAt, pinned, section: home };
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
		case "pin": {
			const id = parseBotId(value.id);
			return id && typeof value.pinned === "boolean" ? { op: "pin", id, pinned: value.pinned } : null;
		}
		case "move": {
			const id = parseBotId(value.id);
			const section = value.section === null ? null : parseSectionName(value.section);
			return id && (value.section === null || section !== null) ? { op: "move", id, section } : null;
		}
		case "rename-section": {
			const from = parseSectionName(value.from);
			const to = value.to === null ? null : parseSectionName(value.to);
			return from !== null && (value.to === null || to !== null) ? { op: "rename-section", from, to } : null;
		}
		case "message": {
			const id = parseBotId(value.id);
			return id && isNonEmpty(value.text) ? { op: "message", id, text: value.text } : null;
		}
		default:
			return null;
	}
}

/**
 * A request a Bot's tool leaves in `bot-inbox/`, told apart by its `job` or `create` field, or `null`. A job holds the
 * same limit as one the page saves, and a new Bot holds every rule of one the page saves.
 */
export function parseBotInboxRequest(value: unknown): Parsed<BotInboxRequest> {
	if (!isObject(value)) return null;
	const botId = parseBotId(value.botId);
	if (!botId) return null;
	const { job, create } = value;
	if (typeof job === "string") return job.length <= MAX_JOB_LENGTH ? { ok: { op: "job", botId, job } } : null;
	const spec = isObject(create) && parseBotSpec({ ...create, model: null, skill: null });
	if (!spec) return null;
	const { id, kind, name, cwd } = spec.ok;
	return { ok: { op: "create", botId, create: { id, kind, name, job: spec.ok.job, cwd } } };
}
