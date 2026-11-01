import { indexText, memoryChanges, memoryTip, readMemory, type MemoryChange } from "./memory";
import { contains, landings, ownFiles, readIntents, targetOf, type Intent, type Landing, type Place, type Sha, type Target } from "./repo";

export const NOTE_TYPE = "omp-agents.project-memory";
const NEWEST = 10;
const INTENT_MAX = 80;
const CATCH_UP_BUDGET = 24_000;
const OVERLAP_FILES = 5;

/** What a session has been told: the target tip, the memory ref commit (`null` before any), and when. */
export interface Seen {
	tip: Sha;
	memory: Sha | null;
	/** ISO time. */
	at: string;
}

export interface News {
	text: string;
	seen: Seen;
}

/** The fields of an omp session entry this extension reads. */
export interface BranchEntry {
	type: string;
	customType?: string;
	attribution?: string;
	details?: unknown;
	message?: { role?: string };
}

/** `details.seen` of the newest project memory message on the branch, `null` when it has none. */
export function lastSeen(entries: readonly BranchEntry[]): Seen | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "custom_message" || entry.customType !== NOTE_TYPE) continue;
		const seen = typeof entry.details === "object" && entry.details !== null && "seen" in entry.details ? entry.details.seen : undefined;
		if (typeof seen !== "object" || seen === null || !("tip" in seen) || !("memory" in seen) || !("at" in seen)) continue;
		if (typeof seen.tip === "string" && (typeof seen.memory === "string" || seen.memory === null) && typeof seen.at === "string") {
			return { tip: seen.tip as Sha, memory: seen.memory as Sha | null, at: seen.at };
		}
	}
	return null;
}

/** Whether the branch holds no user turn yet: a typed message, or a skill the user invoked. */
export function isFirstPrompt(entries: readonly BranchEntry[]): boolean {
	return !entries.some(
		entry =>
			(entry.type === "message" && entry.message?.role === "user") ||
			(entry.type === "custom_message" && entry.customType === "skill-prompt" && entry.attribution === "user"),
	);
}

/**
 * The prompt's first line as the user wrote it: leading tag blocks such as `<system-reminder>` are dropped, and a
 * `/skill:` prompt, which omp expands into the whole skill, reads as the arguments the user gave it or `/skill:<name>`.
 */
export function intentOf(prompt: string): string | null {
	let text = prompt.replace(/^(\s*<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\2>)+/i, "");
	const skill = /^\s*\[IMPORTANT: User invoked the "([^"]+)" skill;/.exec(text);
	if (skill) text = /\n\[Skill directory: [^\n]*\][\s\S]*?\nUser: ([\s\S]*)$/.exec(text)?.[1] ?? `/skill:${skill[1]}`;
	const line = text
		.split("\n")
		.map(part => part.replace(/\s+/g, " ").trim())
		.find(Boolean);
	if (!line) return null;
	return line.length > INTENT_MAX ? `${line.slice(0, INTENT_MAX - 1)}…` : line;
}

function credit(sessions: readonly string[], intents: ReadonlyMap<string, Intent>): string {
	const earliest = sessions
		.filter(session => intents.has(session))
		.sort((a, b) => Date.parse(intents.get(a)?.at ?? "") - Date.parse(intents.get(b)?.at ?? ""))[0];
	const session = earliest ?? sessions[0];
	if (!session) return "";
	const intent = earliest && intents.get(earliest)?.intent;
	return ` (session ${session}${intent ? `, "${intent}"` : ""})`;
}

function briefText(place: Place, target: Target, index: string, landed: readonly Landing[], intents: ReadonlyMap<string, Intent>): string {
	return [
		`<project_memory repository="${place.root.name}" target="${target.name}">`,
		"Memory that this repository's omp sessions keep: decisions, facts, and lessons, one per slug.",
		'Read a memory\'s body with project_memory({ read: "<slug>" }), and change memory with one project_memory({ ops: [...] }) batch.',
		"Write a memory when the user states a decision, when you learn a fact the code does not show, or when a mistake teaches a lesson; update an existing memory rather than add a near-duplicate.",
		"A memory can be stale: when the code or the user contradicts one, follow them and fix the memory.",
		index || "This repository has no memories yet.",
		`Last ${landed.length} landings on ${target.name}, newest first (git log --first-parent ${target.name} for older):`,
		...landed.map(landing => `${landing.sha.slice(0, 7)} ${landing.title}${credit(landing.sessions, intents)}`),
		"</project_memory>",
	].join("\n");
}

function changeLine(change: MemoryChange): string {
	switch (change.change) {
		case "added":
		case "updated":
			return `- ${change.change} ${change.slug} [${change.memory.kind}] — ${change.memory.line}`;
		case "deleted":
			return `- deleted ${change.slug}`;
		default: {
			const unknown: never = change;
			throw new Error(`Unknown memory change ${JSON.stringify(unknown)}`);
		}
	}
}

interface CatchUp {
	place: Place;
	target: Target;
	since: Sha;
	rewritten: boolean;
	landed: readonly Landing[];
	changes: readonly MemoryChange[];
	started: readonly [string, Intent][];
	own: ReadonlySet<string>;
	intents: ReadonlyMap<string, Intent>;
}

function catchUpText({ place, target, since, rewritten, landed, changes, started, own, intents }: CatchUp): string {
	const sha7 = (sha: Sha) => sha.slice(0, 7);
	const head = [`<project_memory_update target="${target.name}" since="${sha7(since)}">`, `Meanwhile in ${place.root.name}:`];
	const tail = [
		...(changes.length > 0 ? ["Memory changed by other sessions:", ...changes.map(changeLine)] : []),
		...(started.length > 0 ? ["Sessions started here since:", ...started.map(([session, { intent }]) => `- "${intent}" (session ${session})`)] : []),
		"</project_memory_update>",
	];
	const lines: string[] = [];
	if (landed.length > 0) {
		if (rewritten) lines.push(`${target.name} no longer contains ${sha7(since)}, so these are its newest ${landed.length} landings.`);
		const overlapping: string[] = [];
		const rest: string[] = [];
		for (const landing of landed) {
			const shared = landing.files.filter(file => own.has(file));
			const line = `- ${sha7(landing.sha)} ${landing.title}${credit(landing.sessions, intents)}`;
			if (shared.length === 0) {
				rest.push(line);
				continue;
			}
			const more = shared.length > OVERLAP_FILES ? `, and ${shared.length - OVERLAP_FILES} more` : "";
			overlapping.push(`${line}; touches ${shared.slice(0, OVERLAP_FILES).join(", ")}${more}, which your branch changed.`);
		}
		lines.push(overlapping.length > 0 ? `Landed on ${target.name}, overlapping your branch first:` : `Landed on ${target.name}:`, ...overlapping);
		let room = CATCH_UP_BUDGET - [...head, ...lines, ...tail].join("\n").length;
		const kept = rest.findIndex(line => (room -= line.length + 1) < 0);
		lines.push(...(kept === -1 ? rest : rest.slice(0, kept)));
		if (kept !== -1) {
			const range = rewritten ? target.tip : `${since}..${target.tip}`;
			lines.push(`- and ${rest.length - kept} older landings; git log --first-parent --oneline ${range} lists every one.`);
		}
	}
	return [...head, ...lines, ...tail].join("\n");
}

/** The brief for a session with no baseline, else a catch-up on what is new since `seen`, else `null`. */
export function newsFor(place: Place, session: string, seen: Seen | null, now: Date): News | null {
	const target = targetOf(place.top);
	if (!target) return null;
	const { commonDir } = place.root;
	const memory = memoryTip(commonDir);
	const next: Seen = { tip: target.tip, memory, at: now.toISOString() };
	if (!seen) {
		const text = briefText(place, target, indexText(readMemory(commonDir, memory)), landings(place.top, target, { newest: NEWEST }, null), readIntents(place.root));
		return { text, seen: next };
	}
	if (seen.tip === target.tip && seen.memory === memory) return null;
	const moved = seen.tip !== target.tip;
	const rewritten = moved && !contains(place.top, target.tip, seen.tip);
	const landed = moved ? landings(place.top, target, rewritten ? { newest: NEWEST } : { since: seen.tip }, session) : [];
	const changes = memory && memory !== seen.memory ? memoryChanges(commonDir, seen.memory, memory, session) : [];
	if (landed.length === 0 && changes.length === 0) return null;
	const intents = readIntents(place.root);
	const after = Date.parse(seen.at);
	const started = [...intents]
		.filter(([other, { at }]) => other !== session && Date.parse(at) > after)
		.sort(([, a], [, b]) => Date.parse(b.at) - Date.parse(a.at))
		.slice(0, NEWEST);
	const own = landed.length > 0 ? ownFiles(place, target) : new Set<string>();
	return { text: catchUpText({ place, target, since: seen.tip, rewritten, landed, changes, started, own, intents }), seen: next };
}
