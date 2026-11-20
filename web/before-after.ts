/** The screen changes a session asks you to compare: the latest `before-after` fence in its agent's replies, and the prompts the **Review** tab writes about them. */
import type { Item } from "../src/shared/transcript";

/** One change to compare: what to call it, its two screenshots on this computer, and what the agent says it changed. */
export interface BeforeAfter {
	title: string;
	before: string;
	after: string;
	description: string;
}

/** A spot pinned on a change's after screenshot, in percent of its width and height, with what should change there. */
export interface Pin {
	x: number;
	y: number;
	note: string;
}

/** The most changes one list holds. */
export const MAX_BEFORE_AFTER = 8;

const FENCE = /```before-after[^\S\n]*\n([\s\S]*?)```/g;

const isAbsolute = (path: unknown): path is string => typeof path === "string" && path.startsWith("/");

function changeOf(raw: unknown): BeforeAfter | null {
	if (typeof raw !== "object" || raw === null) return null;
	const { title, before, after, description } = raw as Record<string, unknown>;
	if (!isAbsolute(before) || !isAbsolute(after) || typeof title !== "string" || !title.trim()) return null;
	return { title: title.trim(), before, after, description: typeof description === "string" ? description.trim() : "" };
}

/**
 * The changes a `before-after` fence's `source` lists: a JSON array of `{title, before, after, description?}` with
 * absolute screenshot paths, each title once, up to {@link MAX_BEFORE_AFTER}; `null` when it is not a JSON array.
 */
export function parseBeforeAfter(source: string): BeforeAfter[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;
	const changes = parsed.flatMap(raw => changeOf(raw) ?? []);
	return changes.filter((change, at) => changes.findIndex(other => other.title === change.title) === at).slice(0, MAX_BEFORE_AFTER);
}

/** The changes of the last valid `before-after` fence in a settled agent reply; empty before one. */
export function latestBeforeAfter(items: readonly Item[]): BeforeAfter[] {
	for (let at = items.length - 1; at >= 0; at--) {
		const item = items[at]!;
		if (item.kind !== "assistant" || item.streaming) continue;
		for (const match of [...item.text.matchAll(FENCE)].reverse()) {
			const changes = parseBeforeAfter(match[1]!);
			if (changes !== null) return changes;
		}
	}
	return [];
}

/** Whether two lists name the same changes, so a reader renders only when the list changes. */
export const sameChanges = (a: readonly BeforeAfter[], b: readonly BeforeAfter[]): boolean =>
	a.length === b.length && a.every((change, at) => {
		const other = b[at]!;
		return change.title === other.title && change.before === other.before && change.after === other.after && change.description === other.description;
	});

/** The prompt that asks the session to tweak `change`: its description as the user left it, each pin with a note, then what the user typed. */
export function tweakPrompt(change: BeforeAfter, description: string, pins: readonly Pin[], ask: string): string {
	const lines = [`Tweak "${change.title}".`];
	if (description.trim()) lines.push("", `What this change is: ${description.trim()}`);
	const noted = pins.filter(pin => pin.note.trim());
	if (noted.length > 0) {
		lines.push("", `On the after screenshot \`${change.after}\`:`);
		for (const pin of noted) lines.push(`- At ${Math.round(pin.x)}% across and ${Math.round(pin.y)}% down: ${pin.note.trim()}`);
	}
	if (ask.trim()) lines.push("", ask.trim());
	return lines.join("\n");
}

/** The prompt that asks the session to undo `change`. */
export const revertPrompt = (change: BeforeAfter): string => `Revert "${change.title}" to how it looks in \`${change.before}\`.`;
