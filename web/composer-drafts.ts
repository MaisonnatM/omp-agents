/**
 * Unsent composer text, one draft per session, subagent, new-session draft, and Bot, kept in this browser across
 * reloads, and the channel that appends text to it from elsewhere on the page, such as the session's Preview.
 */
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { fields, isNumber, isObject, isString } from "../src/json";
import type { BotId } from "../src/shared/bots";
import type { LiveView } from "../src/shared/sessions";

const STORAGE_KEY = "omp-agents.composer-drafts";

/** How long a draft nobody changes is kept. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

interface Draft {
	text: string;
	/** When the text last changed, in epoch milliseconds. */
	at: number;
}

const isDraft = fields<Draft>({ text: isString, at: isNumber });

/** The drafts kept in this browser, without any entry in another shape. */
function storedDrafts(): Record<string, Draft> {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
		if (!isObject(stored) || Array.isArray(stored)) return {};
		return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, Draft] => isDraft(entry[1])));
	} catch {
		return {};
	}
}

/** Keeps `text` under `key`, or forgets `key` for `null`, dropping every other draft unchanged for {@link KEEP_MS}. */
function writeDraft(key: string, text: string | null): void {
	const drafts = storedDrafts();
	if ((drafts[key]?.text ?? null) === text) return;
	const now = Date.now();
	const kept = Object.fromEntries(Object.entries(drafts).filter(([other, draft]) => other !== key && now - draft.at < KEEP_MS));
	if (text !== null) kept[key] = { text, at: now };
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
	} catch {
		// Over quota: the composer still holds the text until it unmounts.
	}
}

/** The draft of a live session's or subagent's composer. */
export const liveDraftKey = (view: LiveView): string => (view.agentId === null ? `live/${view.instanceId}` : `live/${view.instanceId}/${view.agentId}`);

/** The draft of the new-session page: one for the plain draft, one for each todo it starts from. */
export const newDraftKey = (todoId: string | null): string => (todoId === null ? "new" : `new/todo/${todoId}`);

/** The draft of a Bot's composer while no omp runs its conversation. */
export const botDraftKey = (id: BotId): string => `bot/${id}`;

/** Puts `text` in the composer of `key` for its next mount; `""` forgets it. */
export const putDraft = (key: string, text: string): void => writeDraft(key, text === "" ? null : text);

export const clearDraft = (key: string): void => writeDraft(key, null);

/** `text` added to `draft`, a blank line after what was typed; the mounted composer and the kept draft must append alike. */
const withAppended = (draft: string, text: string): string => (draft.trim() ? `${draft}\n\n${text}` : text);

/** The mounted composers by draft key, each taking appended text. */
const appenders = new Map<string, Set<(text: string) => void>>();

/** Appends `text` to the composer of `key`: in place when it is mounted, without taking focus, else to its kept draft. */
export function appendToComposer(key: string, text: string): void {
	const mounted = appenders.get(key);
	if (mounted?.size) for (const append of mounted) append(text);
	else putDraft(key, withAppended(storedDrafts()[key]?.text ?? "", text));
}

/**
 * A composer's text, starting from the draft kept under `key`, else from `seed`, and kept there as it changes. Empty
 * text, or text equal to `seed`, keeps nothing, so a sent, scheduled, or emptied message forgets the draft. `null` keeps
 * nothing at all. The key is fixed for the composer's life: key the component by it to switch drafts.
 */
export function useComposerDraft(key: string | null, seed: string): [string, Dispatch<SetStateAction<string>>] {
	const [slot] = useState(key);
	const [text, setText] = useState(() => (slot === null ? seed : (storedDrafts()[slot]?.text ?? seed)));
	// The seed it opened with: a later one, such as a todo edited in another window, is not where this draft started.
	const [start] = useState(seed);
	useEffect(() => {
		if (slot !== null) writeDraft(slot, text === "" || text === start ? null : text);
	}, [slot, start, text]);
	useEffect(() => {
		if (slot === null) return;
		const append = (added: string): void => setText(current => withAppended(current, added));
		const mounted = appenders.get(slot) ?? new Set();
		appenders.set(slot, mounted.add(append));
		return () => {
			mounted.delete(append);
			if (mounted.size === 0) appenders.delete(slot);
		};
	}, [slot]);
	return [text, setText];
}
