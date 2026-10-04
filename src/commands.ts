/**
 * Per-session `/` and `@` support, built from omp's own pieces: pi-tui's
 * CombinedAutocompleteProvider (the TUI's matcher, ranking, fuzzy file search,
 * and insertion), omp's skill and file-command discovery, and omp's expanders.
 *
 * A guest prompt reaches the host as a collab message, which skips the TUI's
 * `/skill:` handling and session.prompt's file-command expansion; only
 * `@file` mentions are still read by the host. So the dashboard expands those
 * two itself, with the functions the TUI uses, before sending.
 */
import { isAbsolute, relative, resolve } from "node:path";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	buildSkillPromptMessage,
	CombinedAutocompleteProvider,
	expandSlashCommand,
	type FileSlashCommand,
	loadSessionSkills,
	loadSlashCommands,
	parseSkillInvocation,
	type Skill,
} from "./omp/prompts";
import type { CompletionItem, SkillOption } from "./shared";

/** Discovery reads disk; reuse it briefly so typing does not rescan, but new skills still show up. */
const CATALOG_TTL_MS = 30_000;
const MAX_ITEMS = 50;

interface Catalog {
	provider: AutocompleteProvider;
	/** `null` when `skills.enableSkillCommands` is off: `/skill:x` is then plain text in omp too. */
	skills: Map<string, Skill> | null;
	fileCommands: FileSlashCommand[];
}

const catalogs = new Map<string, { loading: Promise<Catalog>; at: number }>();

async function buildCatalog(cwd: string): Promise<Catalog> {
	const [{ enableSkillCommands, skills }, fileCommands] = await Promise.all([loadSessionSkills(cwd), loadSlashCommands({ cwd })]);
	const skillMap = enableSkillCommands ? new Map(skills.map(skill => [skill.name, skill])) : null;
	const commands = [
		...[...(skillMap?.values() ?? [])].map(skill => ({ name: `skill:${skill.name}`, description: skill.description })),
		...fileCommands.map(command => ({ name: command.name, description: command.description })),
	];
	return { provider: new CombinedAutocompleteProvider(commands, cwd), skills: skillMap, fileCommands };
}

/**
 * Keyed by session and cwd: two sessions in one directory get separate entries, and a `/move` gets a fresh one.
 * `instanceId` is `null` for a session not started yet, so every new-session draft in a directory shares one entry.
 */
function catalogFor(instanceId: string | null, cwd: string): Promise<Catalog> {
	const key = `${instanceId ?? ""}\u0000${cwd}`;
	const now = Date.now();
	// Entries nobody asks for again (every cwd a new-session draft once named) would otherwise stay for good.
	for (const [other, entry] of catalogs) if (now - entry.at >= CATALOG_TTL_MS) catalogs.delete(other);
	const cached = catalogs.get(key);
	if (cached) return cached.loading;
	const loading = buildCatalog(cwd);
	catalogs.set(key, { loading, at: now });
	loading.catch(() => {
		if (catalogs.get(key)?.loading === loading) catalogs.delete(key);
	});
	return loading;
}

export function forgetSession(instanceId: string): void {
	for (const key of catalogs.keys()) if (key.startsWith(`${instanceId}\u0000`)) catalogs.delete(key);
}

/** The pi-tui editor addresses text as lines plus a caret line and column. */
export function toEditor(text: string, cursor: number): { lines: string[]; line: number; col: number } {
	const before = text.slice(0, cursor).split("\n");
	return { lines: text.split("\n"), line: before.length - 1, col: (before.at(-1) ?? "").length };
}

export function fromEditor(lines: string[], line: number, col: number): { text: string; cursor: number } {
	const cursor = lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + col;
	return { text: lines.join("\n"), cursor };
}

/** An `@` suggestion's path (quotes and the `@` stripped), or `null` for anything else. */
export function mentionPath(value: string): string | null {
	if (!value.startsWith("@")) return null;
	return value.slice(1).replace(/^"|"$/g, "");
}

/** Mentions may only name paths inside the session's cwd; the page never learns about anything else. */
export function insideCwd(cwd: string, path: string): boolean {
	const rel = relative(cwd, resolve(cwd, path));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function kindOf(item: AutocompleteItem): CompletionItem["kind"] {
	const path = mentionPath(item.value);
	if (path !== null) return path.endsWith("/") ? "directory" : "file";
	return item.value.startsWith("skill:") ? "skill" : "command";
}

export async function complete(instanceId: string | null, cwd: string, text: string, cursor: number): Promise<CompletionItem[]> {
	const catalog = await catalogFor(instanceId, cwd);
	const { lines, line, col } = toEditor(text, cursor);
	const suggestions = await catalog.provider.getSuggestions(lines, line, col);
	if (!suggestions) return [];
	const items: CompletionItem[] = [];
	for (const item of suggestions.items) {
		const path = mentionPath(item.value);
		if (path !== null && !insideCwd(cwd, path)) continue;
		const applied = catalog.provider.applyCompletion(lines, line, col, item, suggestions.prefix);
		items.push({
			kind: kindOf(item),
			label: item.label,
			description: item.description ?? null,
			...fromEditor(applied.lines, applied.cursorLine, applied.cursorCol),
		});
		if (items.length >= MAX_ITEMS) break;
	}
	return items;
}

/** The skills `/skill:<name>` invokes in a session started in `cwd`; none when omp's `skills.enableSkillCommands` is off. */
export async function listSkills(cwd: string): Promise<SkillOption[]> {
	const { skills } = await catalogFor(null, cwd);
	return [...(skills?.values() ?? [])].map(({ name, description }) => ({ name, description: description || null }));
}

/**
 * A new session's first prompt with the pinned `skill` before it, as `/skill:<skill> <prompt>`, so omp invokes the skill
 * with the prompt as its arguments. A session in `cwd` that has no such skill, or a prompt that opens with a command of
 * its own, keeps the prompt as typed.
 */
export async function withPinnedSkill(cwd: string, skill: string | null, prompt: string): Promise<string> {
	if (skill === null || prompt.trimStart().startsWith("/")) return prompt;
	const { skills } = await catalogFor(null, cwd);
	return skills?.has(skill) ? `/skill:${skill} ${prompt}`.trimEnd() : prompt;
}

/**
 * What the TUI would hand the model for `text`. Skills expand for both targets.
 * File commands expand for session prompts only: subagent chat goes through
 * the host's session.prompt, which expands them itself.
 */
export async function expandPrompt(instanceId: string, cwd: string, text: string, target: "session" | "subagent"): Promise<string> {
	const catalog = await catalogFor(instanceId, cwd);
	if (text.startsWith("$")) {
		throw new Error("The $ Python shortcut runs in the omp terminal. Collab does not expose that session's Python kernel.");
	}
	if (text.startsWith("!")) {
		throw new Error("The ! shell shortcut runs in the omp terminal. Collab does not expose host shell commands.");
	}
	const invocation = parseSkillInvocation(text);
	const skill = invocation ? catalog.skills?.get(invocation.name) : undefined;
	if (invocation && skill) return (await buildSkillPromptMessage(skill, { args: invocation.args, prompt: invocation.prompt })).message;
	if (text.startsWith("/")) {
		const name = text.slice(1).split(" ", 1)[0];
		if (!catalog.fileCommands.some(command => command.name === name)) {
			throw new Error(`/${name} is not available through Collab. Use the omp terminal for built-in commands.`);
		}
	}
	return target === "session" ? expandSlashCommand(text, catalog.fileCommands) : text;
}
