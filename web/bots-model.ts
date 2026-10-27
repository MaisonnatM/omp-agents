/** What the page shows of a Bot: its avatar's shape and hue, its sidebar row, its running session and conversation, the routines that send to it, its memory's lines, and the prompts a new Bot offers. */
import type { Routine } from "../src/routines";
import type { Bot, BotId, BotLast } from "../src/shared/bots";
import type { HostStatus, RosterHost, View } from "../src/shared/sessions";
import { plainMarkdown } from "./labels";
import type { Page } from "./routing";

/** The shapes a Bot's avatar takes. */
export const BOT_SHAPES = ["circle", "triangle", "hexagon", "square", "cloud", "diamond", "clover", "pill"] as const;

export type BotShape = (typeof BOT_SHAPES)[number];

/** The avatar's hues on the OKLCH wheel, far enough apart that two Bots side by side read as different. */
export const BOT_HUES = [25, 70, 110, 150, 195, 235, 275, 320] as const;

/** A Bot's avatar: its shape and hue, both from its id, so a Bot keeps its look everywhere and across renames. */
export function botLook(id: BotId): { shape: BotShape; hue: number } {
	let hash = 0;
	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return { shape: BOT_SHAPES[hash % BOT_SHAPES.length]!, hue: BOT_HUES[Math.floor(hash / BOT_SHAPES.length) % BOT_HUES.length]! };
}

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

/** The conversation `page` shows: the open Bot's, `null` on another page, on the New Bot form, or for a Bot that is gone. */
export function openBotView(page: Page | null, bots: readonly Bot[] | null, hosts: readonly RosterHost[]): View | null {
	if (page?.kind !== "bots" || page.target === null) return null;
	const bot = bots?.find(({ id }) => id === page.target);
	return bot ? botView(bot, hosts) : null;
}

/** A Bot as the sidebar lists it, like a conversation in a messaging app. */
export interface BotRow {
	bot: Bot;
	/** Its running session's status, `null` while none runs. */
	status: HostStatus | null;
	/** The question its session waits on you for, `null` for none. */
	asking: string | null;
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
			const asking = host?.requests[0]?.title ?? null;
			const fresher = unread?.reply && (!last || unread.at >= last.at) ? unread.reply : null;
			const said = fresher ?? (last ? (last.from === "user" ? `You: ${last.text}` : last.text) : null);
			const preview = asking ?? (host?.status === "working" ? "Working…" : said ? plainMarkdown(said) : "No messages yet");
			return { bot, status: host?.status ?? null, asking, unread: unread !== null, preview, at: Math.max(last?.at ?? 0, unread?.at ?? 0) || Date.parse(bot.createdAt) };
		})
		.sort((a, b) => b.at - a.at || a.bot.name.localeCompare(b.bot.name));
}

/** The routines that message Bot `id`. */
export function botRoutines(routines: readonly Routine[], id: BotId): Routine[] {
	return routines.filter(({ task }) => task.kind === "bot" && task.botId === id);
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
