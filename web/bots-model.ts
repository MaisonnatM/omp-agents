/** What the page shows of a Bot: its avatar's letter and hue, its running session, the routines that send to it, and its memory's lines. */
import type { Routine } from "../src/routines";
import type { Bot, BotId } from "../src/shared/bots";
import type { RosterHost } from "../src/shared/sessions";

/** The avatar's letter: the first character of the Bot's name, upper-cased. */
export function botInitial(name: string): string {
	return (Array.from(name.trim())[0] ?? "?").toUpperCase();
}

/** The avatar's hue, from the Bot's id, so a Bot keeps its color everywhere and across renames. */
export function botHue(id: BotId): number {
	let hash = 0;
	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return hash % 360;
}

/** The running session of the Bot's conversation, `null` while none runs. */
export function botHost(bot: Bot, hosts: readonly RosterHost[]): RosterHost | null {
	return bot.sessionId === null ? null : (hosts.find(host => host.sessionId === bot.sessionId) ?? null);
}

/** The routines that send their prompt to Bot `id`. */
export function botRoutines(routines: readonly Routine[], id: BotId): Routine[] {
	return routines.filter(({ target }) => target.kind === "bot" && target.botId === id);
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
