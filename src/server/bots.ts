/**
 * The Bots on the server: how a Bot's session launches with the Bot extension, which conversation each Bot is bound
 * to as that session lives, and a message to a Bot, which reaches its live session or resumes it.
 */
import { join } from "node:path";
import { isObject } from "../json";
import type { LiveSession } from "../live-session";
import { BOT_FLAGS } from "../omp/bot-extension";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { type Bot, type BotEdit, type BotId, type BotLast, MAX_MEMORY_BYTES } from "../shared/bots";
import type { ServerMsg } from "../shared/protocol";
import { modelOfSelector } from "../shared/models";
import { newSessionRequest, type StartRequest, type StartResult } from "../shared/sessions";
import { isDashboardPrompt } from "../shared/transcript";
import { entryTime, oneLine, textOf } from "../session-entries";
import { readTail } from "../read-tail";
import { splitSuggestions } from "../transcript";
import type { BotsFile } from "./bots-file";
import type { SessionJoin } from "./start";

/** What a message needs of a live session. */
type BotSession = Pick<LiveSession, "sessionId" | "prompt">;

/** A Bot's memory and its conversation's last words, as read for its session `sessionId`. */
type BotFiles = { sessionId: string | null; memory: string; last: BotLast | null };

/** How much of a session file's end {@link lastMessage} reads; a conversation whose last words sit further back previews none. */
const LAST_TAIL = 256 * 1024;

/** The last prompt or reply with text in session file `path`, the user's own or the agent's without its suggested prompts; `null` when its end holds none or the file is gone. */
export function lastMessage(path: string): BotLast | null {
	const lines = readTail(path, LAST_TAIL)?.text.split("\n") ?? [];
	for (let i = lines.length - 1; i >= 0; i--) {
		const last = messageOf(lines[i]!);
		if (last) return last;
	}
	return null;
}

function messageOf(line: string): BotLast | null {
	let entry: unknown;
	try {
		entry = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isObject(entry) || entry.type !== "message" || !isObject(entry.message)) return null;
	const { role, content } = entry.message;
	const text = textOf(content).trim();
	if (!text) return null;
	if (role === "user" && !isDashboardPrompt(text)) return { at: entryTime(entry) ?? 0, from: "user", text: oneLine(text) };
	if (role === "assistant") return { at: entryTime(entry) ?? 0, from: "bot", text: oneLine(splitSuggestions(text).body) };
	return null;
}

export interface BotsDeps {
	file: BotsFile;
	start(request: StartRequest): Promise<StartResult>;
	/** The live session that continues `sessionId`. */
	live(sessionId: string): BotSession | undefined;
	session(instanceId: string): BotSession | undefined;
	savedFile(sessionId: string): string | null;
	/** The extension a Bot's session loads, the `bots.json` it reads and the inbox its `set_job` tool writes, the directory of the Bots' memories, and the `routines.json` and routine inbox its routine tools read and write. */
	paths: { extension: string; botsFile: string; botInboxDir: string; botsDir: string; routinesFile: string; routineInboxDir: string };
	now(): string;
	/** A Bot's conversation moved to another session, which the list registry did not publish. */
	onChange(): void;
}

export class Bots {
	readonly #deps: BotsDeps;
	/** The Bot each live Bot session is, by instance id. */
	readonly #live = new Map<string, BotId>();
	/** Each Bot's message under way, which the next waits on, so two at once never start two conversations. */
	readonly #sending = new Map<BotId, Promise<unknown>>();
	/** Each Bot's memory and last words as last read, with the session they were read for; {@link changed} drops a Bot's. */
	#read = new Map<BotId, BotFiles>();

	constructor(deps: BotsDeps) {
		this.#deps = deps;
	}

	get list(): Bot[] {
		return this.#deps.file.value;
	}

	/**
	 * The `bots` message: every Bot, the newest of what each remembers, as much as its turns' system prompt carries, and its
	 * conversation's last words. Only a Bot that is new, whose conversation moved, or whose session {@link changed} since
	 * the last message has its files read again.
	 */
	msg(): Extract<ServerMsg, { t: "bots" }> {
		const memories: Record<BotId, string> = {};
		const lasts: Record<BotId, BotLast | null> = {};
		const read = new Map<BotId, BotFiles>();
		for (const bot of this.list) {
			const cached = this.#read.get(bot.id);
			const entry = cached?.sessionId === bot.sessionId ? cached : { sessionId: bot.sessionId, memory: readTail(this.#memoryPath(bot.id), MAX_MEMORY_BYTES)?.text ?? "", last: this.#last(bot.sessionId) };
			read.set(bot.id, entry);
			memories[bot.id] = entry.memory;
			lasts[bot.id] = entry.last;
		}
		this.#read = read;
		return { t: "bots", bots: this.list, memories, lasts };
	}

	/** The last words of conversation `sessionId`, `null` before its first message. */
	#last(sessionId: string | null): BotLast | null {
		const path = sessionId === null ? null : this.#deps.savedFile(sessionId);
		return path === null ? null : lastMessage(path);
	}

	/** Reads `bots.json` again, after another server saved it, and forgets every Bot's files as read. */
	reload(): void {
		this.#deps.file.reload();
		this.#read.clear();
	}

	#memoryPath(id: BotId): string {
		return join(this.#deps.paths.botsDir, id, "memory.md");
	}

	/**
	 * How `request` joins the server: a new session that names a Bot, or the resume of a Bot's conversation, launches with
	 * the Bot extension and binds the Bot to the session once it is live. Any other start launches plain.
	 */
	join(request: StartRequest): SessionJoin {
		const id = request.kind === "new" ? request.bot : request.kind === "resume" ? this.list.find(bot => bot.sessionId === request.sessionId)?.id : undefined;
		if (!id) return { rpc: PLAIN_LAUNCH, attach() {} };
		const { extension, botsFile, botInboxDir, routinesFile, routineInboxDir } = this.#deps.paths;
		const flags = {
			[BOT_FLAGS.bot]: id,
			[BOT_FLAGS.bots]: botsFile,
			[BOT_FLAGS.botInbox]: botInboxDir,
			[BOT_FLAGS.memory]: this.#memoryPath(id),
			[BOT_FLAGS.routines]: routinesFile,
			[BOT_FLAGS.routineInbox]: routineInboxDir,
		};
		return {
			rpc: { ...PLAIN_LAUNCH, args: ["-e", extension, ...Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value])] },
			attach: session => {
				this.#live.set(session.instanceId, id);
				this.#bind(id, session.sessionId);
			},
		};
	}

	/** Live session `instanceId` now runs as `sessionId`, after a `/move` or an edited prompt; its Bot follows it. */
	switched(instanceId: string, sessionId: string): void {
		const id = this.#live.get(instanceId);
		if (id) this.#bind(id, sessionId);
	}

	exited(instanceId: string): void {
		this.#live.delete(instanceId);
	}

	/**
	 * Live session `instanceId` started or ended a turn, or exited, so its Bot's memory and last words may have changed;
	 * the next {@link msg} reads them again. Whether the session is a Bot's conversation.
	 */
	changed(instanceId: string): boolean {
		const id = this.#live.get(instanceId);
		if (id) this.#read.delete(id);
		return id !== undefined;
	}

	/**
	 * Sends `text` into Bot `id`'s conversation: queued as a follow-up in its live session, else after resuming it, else
	 * as the first message of a new one in the Bot's workspace. Resolves to the conversation's session id once omp took it.
	 */
	message(id: BotId, text: string): Promise<string> {
		const sent = (this.#sending.get(id) ?? Promise.resolve())
			.catch(() => {})
			.then(() => this.#send(id, text))
			.finally(() => {
				if (this.#sending.get(id) === sent) this.#sending.delete(id);
			});
		this.#sending.set(id, sent);
		return sent;
	}

	async #send(id: BotId, text: string): Promise<string> {
		const bot = this.list.find(candidate => candidate.id === id);
		if (!bot) throw new Error("This Bot is gone.");
		const live = bot.sessionId === null ? undefined : this.#deps.live(bot.sessionId);
		if (live) {
			await live.prompt(null, text, [], "followUp");
			return live.sessionId;
		}
		const request: StartRequest =
			bot.sessionId !== null && this.#deps.savedFile(bot.sessionId) !== null
				? { kind: "resume", sessionId: bot.sessionId }
				: newSessionRequest(bot.cwd, text, { model: bot.model === null ? null : modelOfSelector(bot.model), skill: bot.skill, bot: id });
		const result = await this.#deps.start(request);
		if (!result.ok) throw new Error(result.error);
		const session = this.#deps.session(result.instanceId);
		if (!session) throw new Error("The Bot's session exited as it started.");
		if (request.kind === "resume") await session.prompt(null, text, [], "followUp");
		return session.sessionId;
	}

	#bind(id: BotId, sessionId: string): void {
		const edit: BotEdit = { op: "bind", id, sessionId };
		if (this.#deps.file.apply(edit, this.#deps.now())) this.#deps.onChange();
	}
}
