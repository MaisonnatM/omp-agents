/** Unsent composer text, one draft per session, subagent, and new-session draft, kept in this browser across reloads. */
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { fields, isNumber, isObject, isString } from "../src/json";
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

/** The dedicated design-comparison composer keeps its text separately from single sessions. */
export const variantsDraftKey = "new-variants";

/** Puts `text` in the composer of `key` for its next mount; `""` forgets it. */
export const putDraft = (key: string, text: string): void => writeDraft(key, text === "" ? null : text);

export const clearDraft = (key: string): void => writeDraft(key, null);

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
	return [text, setText];
}
