/** The screen changes a session asks you to compare: the latest `before-after` fence in its agent's replies, and the prompts the **Review** tab writes about them. */
import { MAX_BEFORE_AFTER } from "../src/shared/session-visuals";
import { fencedList } from "./fenced-list";

/** One change to compare: what to call it, its two screenshots on this computer, and what the agent says it changed. */
export interface BeforeAfter {
	title: string;
	before: string;
	after: string;
	description: string;
}

/** A spot pinned on a change's after screenshot, in percent of its width and height, with what should change there. */
export interface Pin {
	id: number;
	x: number;
	y: number;
	note: string;
}

/** What the user wrote about one change: the description when they edited it, `null` to keep the agent's, the spots pinned on it, and the request typed. */
export interface Draft {
	description: string | null;
	pins: Pin[];
	ask: string;
}

export const EMPTY_DRAFT: Draft = { description: null, pins: [], ask: "" };

/** What identifies a change: its title and both screenshots, so a list that reuses a title for new screenshots names a new change. */
export const changeKey = (change: BeforeAfter): string => `${change.title}\n${change.before}\n${change.after}`;

const isAbsolute = (path: unknown): path is string => typeof path === "string" && path.startsWith("/");

function changeOf(raw: unknown): BeforeAfter | null {
	if (typeof raw !== "object" || raw === null) return null;
	const { title, before, after, description } = raw as Record<string, unknown>;
	if (!isAbsolute(before) || !isAbsolute(after) || typeof title !== "string" || !title.trim()) return null;
	return { title: title.trim(), before, after, description: typeof description === "string" ? description.trim() : "" };
}

/** `before-after` fences: each a JSON array of `{title, before, after, description?}` with absolute screenshot paths, each change once, up to {@link MAX_BEFORE_AFTER}. */
const changes = fencedList({ language: "before-after", itemOf: changeOf, keyOf: changeKey, max: MAX_BEFORE_AFTER });

export const { parse: parseBeforeAfter, latest: latestBeforeAfter, same: sameChanges } = changes;

/** The description a draft shows: the user's edit, else the agent's. */
export const descriptionOf = (change: BeforeAfter, draft: Draft): string => draft.description ?? change.description;

/**
 * The prompt that asks the session to tweak `change`: its description as the user left it, each pin with a note, then
 * what the user typed; `null` when the draft has neither a noted pin nor a request.
 */
export function tweakPrompt(change: BeforeAfter, draft: Draft): string | null {
	const noted = draft.pins.filter(pin => pin.note.trim());
	const ask = draft.ask.trim();
	if (noted.length === 0 && !ask) return null;
	const lines = [`Tweak "${change.title}".`];
	const description = descriptionOf(change, draft).trim();
	if (description) lines.push("", `What this change is: ${description}`);
	if (noted.length > 0) {
		lines.push("", `On the after screenshot \`${change.after}\`:`);
		for (const pin of noted) lines.push(`- At ${Math.round(pin.x)}% across and ${Math.round(pin.y)}% down: ${pin.note.trim()}`);
	}
	if (ask) lines.push("", ask);
	return lines.join("\n");
}

/** The prompt that asks the session to undo `change`. */
export const revertPrompt = (change: BeforeAfter): string => `Revert "${change.title}" to how it looks in \`${change.before}\`.`;
