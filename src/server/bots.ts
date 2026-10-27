/**
 * The Bots on the server: how a Bot's session launches with the Bot extension, which conversation each Bot is bound
 * to as that session lives, and a message to a Bot, which reaches its live session or resumes it.
 */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { isObject } from "../json";
import type { LiveSession } from "../live-session";
import { BOT_FLAGS } from "../omp/bot-extension";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { type Bot, type BotEdit, type BotId, type BotLast } from "../shared/bots";
import { modelOfSelector } from "../shared/models";
import { newSessionRequest, type StartRequest, type StartResult } from "../shared/sessions";
import { isDashboardPrompt } from "../shared/transcript";
import { entryTime, oneLine, textOf } from "../session-entries";
import { splitSuggestions } from "../transcript";
import type { BotsFile } from "./bots-file";
import type { SessionJoin } from "./start";

/** What a message needs of a live session. */
type BotSession = Pick<LiveSession, "sessionId" | "prompt">;

/** How much of a session file's end {@link lastMessage} reads; a conversation whose last words sit further back previews none. */
const LAST_TAIL = 256 * 1024;

/** The last prompt or reply with text in session file `path`, the user's own or the agent's without its suggested prompts; `null` when its end holds none or the file is gone. */
export function lastMessage(path: string): BotLast | null {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	try {
		const size = fstatSync(fd).size;
		const length = Math.min(size, LAST_TAIL);
		const tail = Buffer.alloc(length);
		readSync(fd, tail, 0, length, size - length);
		const lines = tail.toString("utf8").split("\n");
		if (length < size) lines.shift();
		for (const line of lines.toReversed()) {
			const last = messageOf(line);
			if (last) return last;
		}
		return null;
	} finally {
		closeSync(fd);
	}
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
	/** The extension a Bot's session loads, the `bots.json` it reads, and the directory of the Bots' memories. */
	paths: { extension: string; botsFile: string; botsDir: string };
	now(): string;
	/** A Bot's conversation moved to another session, which the list registry did not publish. */
	onChange(): void;
}

export class Bots {
	readonly #deps: BotsDeps;
	/** The Bot each live Bot session is, by instance id. */
	readonly #live = new Map<string, BotId>();
	/** Each Bot's last message, which the next waits on, so two at once never start two conversations. */
	readonly #sending = new Map<BotId, Promise<unknown>>();

	constructor(deps: BotsDeps) {
		this.#deps = deps;
	}

	get list(): Bot[] {
		return this.#deps.file.value;
	}

	/** What each Bot remembers, as its session wrote it; empty before it remembers anything. */
	get memories(): Record<BotId, string> {
		const memories: Record<BotId, string> = {};
		for (const { id } of this.list) {
			try {
				memories[id] = readFileSync(this.#memoryPath(id), "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				memories[id] = "";
			}
		}
		return memories;
	}

	/** The last words of each Bot's conversation, `null` before its first message. */
	get lasts(): Record<BotId, BotLast | null> {
		const lasts: Record<BotId, BotLast | null> = {};
		for (const { id, sessionId } of this.list) {
			const path = sessionId === null ? null : this.#deps.savedFile(sessionId);
			lasts[id] = path === null ? null : lastMessage(path);
		}
		return lasts;
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
		const { extension, botsFile } = this.#deps.paths;
		return {
			rpc: { ...PLAIN_LAUNCH, args: ["-e", extension, `--${BOT_FLAGS.bot}`, id, `--${BOT_FLAGS.bots}`, botsFile, `--${BOT_FLAGS.memory}`, this.#memoryPath(id)] },
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

	/** Whether live session `instanceId` is a Bot's conversation. */
	isBot(instanceId: string): boolean {
		return this.#live.has(instanceId);
	}

	/**
	 * Sends `text` into Bot `id`'s conversation: queued as a follow-up in its live session, else after resuming it, else
	 * as the first message of a new one in the Bot's workspace. Resolves to the conversation's session id once omp took it.
	 */
	message(id: BotId, text: string): Promise<string> {
		const sent = (this.#sending.get(id) ?? Promise.resolve()).catch(() => {}).then(() => this.#send(id, text));
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
