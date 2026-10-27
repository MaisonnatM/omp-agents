/** What the page shows of a Bot: the Bot its page opens, its sidebar row, its running session and conversation, its memory's lines, and the prompts a new Bot offers. */
import type { Routine } from "../src/routines";
import type { Bot, BotId, BotLast } from "../src/shared/bots";
import type { HostStatus, RosterHost, View } from "../src/shared/sessions";
import { statusLabel } from "./components/status-dot";
import { plainMarkdown } from "./labels";
import type { Page } from "./routing";

/** The running session of the Bot's conversation, `null` while none runs. */
export function botHost(bot: Bot, hosts: readonly RosterHost[]): RosterHost | null {
	return bot.sessionId === null ? null : (hosts.find(host => host.sessionId === bot.sessionId) ?? null);
}

/** The Bot's conversation: its running session, else its saved one, `null` before its first message. */
export function botView(bot: Bot, hosts: readonly RosterHost[]): View | null {
	const host = botHost(bot, hosts);
	if (host) return { kind: "live", instanceId: host.instanceId, agentId: null };
	return bot.sessionId === null ? null : { kind: "past", sessionId: bot.sessionId };
}

/** The question the Bot's running session waits on you for, `null` for none. */
export const botAsking = (host: RosterHost | null): string | null => host?.requests[0]?.title ?? null;

/** The Bot's state in lowercase words: asking you, its running session's status, not running, or no conversation yet. */
export function botStatus(bot: Bot, host: RosterHost | null): string {
	if (host) return botAsking(host) !== null ? "asking you" : statusLabel(host.status);
	return bot.sessionId === null ? "no conversation yet" : "not running";
}

/** The Bot's routines, in `routines`' order. */
export const botRoutines = (routines: readonly Routine[], id: BotId): Routine[] => routines.filter(({ botId }) => botId === id);

/** What a Bot's page shows: its conversation, a new routine's editor, one of its routines or that routine's editor, or that the routine its address names is missing. */
export type OpenRoutine = { kind: "conversation" } | { kind: "new" } | { kind: "open"; routine: Routine } | { kind: "edit"; routine: Routine } | { kind: "missing"; id: string };

/** The Bot whose page is open: what its page and its details show, and the conversation the server streams for it. */
export interface OpenBot {
	bot: Bot;
	/** Its running session, `null` while none runs. */
	host: RosterHost | null;
	/** The conversation on screen, which the server streams: `null` while anything else replaces it, or before its first message. */
	view: View | null;
	routines: Routine[];
	routine: OpenRoutine;
	/** Its state in lowercase words, as {@link botStatus}. */
	status: string;
}

/** The Bot `page` opens, `null` on another page, on the New Bot form, while the Bots load, or for a Bot that is gone. */
export function openBot(page: Page | null, bots: readonly Bot[] | null, hosts: readonly RosterHost[], routines: readonly Routine[]): OpenBot | null {
	if (page?.kind !== "bots" || page.target === null) return null;
	const bot = bots?.find(({ id }) => id === page.target);
	if (!bot) return null;
	const host = botHost(bot, hosts);
	const own = botRoutines(routines, bot.id);
	const route = page.routine;
	const named = route === null || route.kind === "new" ? undefined : own.find(({ id }) => id === route.id);
	const routine: OpenRoutine =
		route === null ? { kind: "conversation" } : route.kind === "new" ? route : named ? { kind: route.kind, routine: named } : { kind: "missing", id: route.id };
	return { bot, host, view: routine.kind === "conversation" ? botView(bot, hosts) : null, routines: own, routine, status: botStatus(bot, host) };
}

/** A Bot as the sidebar lists it, like a conversation in a messaging app. */
export interface BotRow {
	bot: Bot;
	/** Its running session, `null` while none runs; {@link botStatus} and {@link botAsking} read it. */
	host: RosterHost | null;
	/** A turn ended since you last looked at its conversation. */
	unread: boolean;
	/** The row's second line: the question, `Working…`, or the conversation's last words. */
	preview: string;
	/** When it last spoke or heard from you, in ms since the epoch; its creation before its first message. */
	at: number;
}

/** Each Bot's row, the most recent conversation first, then by name. */
export function botRows(bots: readonly Bot[], hosts: readonly RosterHost[], lasts: Readonly<Record<BotId, BotLast | null>>): BotRow[] {
	return bots
		.map(bot => {
			const host = botHost(bot, hosts);
			const last = lasts[bot.id] ?? null;
			const unread = host?.unread ?? null;
			const asking = botAsking(host);
			const fresher = unread?.reply && (!last || unread.at >= last.at) ? unread.reply : null;
			const said = fresher ?? (last ? (last.from === "user" ? `You: ${last.text}` : last.text) : null);
			const preview = asking ?? (host?.status === "working" ? "Working…" : said ? plainMarkdown(said) : "No messages yet");
			return {
				bot,
				host,
				unread: unread !== null,
				preview,
				at: Math.max(last?.at ?? 0, unread?.at ?? 0) || Date.parse(bot.createdAt),
			};
		})
		.sort((a, b) => b.at - a.at || a.bot.name.localeCompare(b.bot.name));
}

/** One fact of a memory: the day `remember` wrote it, when the line has one, and the fact. */
export interface MemoryEntry {
	date: string | null;
	fact: string;
}

/** The facts of a `memory.md`, one per non-empty line, oldest first. */
export function memoryEntries(text: string): MemoryEntry[] {
	return text.split("\n").flatMap(line => {
		const item = line.replace(/^\s*-\s*/, "").trim();
		if (!item) return [];
		const dated = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(item);
		return [dated ? { date: dated[1]!, fact: dated[2]! } : { date: null, fact: item }];
	});
}

/** The first sentence of a job written in Markdown, past its headings and without a list mark; empty for a blank job. */
export function jobLine(job: string): string {
	const line = job.split("\n").filter(text => !/^\s*#/.test(text)).map(text => text.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim()).find(Boolean) ?? "";
	return /^.+?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}

/** The prompts a Bot offers before its first message: its job's first sentence as a task, a question about what it needs, and a fact for its memory. */
export function starterPrompts(job: string): string[] {
	const task = jobLine(job);
	return task
		? [task, "What do you need from me to do this job well?", "Remember that I prefer short answers."]
		: ["What should your job be? Ask me a few questions.", "What can you help me with?", "Remember that I prefer short answers."];
}
