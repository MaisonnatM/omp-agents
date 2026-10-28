/**
 * Unsent composer text, one draft per session, subagent, new-session draft, and Bot, kept in this browser across
 * reloads, and the channels that append text and attach files to it from elsewhere on the page, such as the session's Browser.
 */
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import type { BotId } from "../src/shared/bots";
import type { LiveView } from "../src/shared/sessions";
import { expiringStrings } from "./expiring-strings";

/** Each draft, dropped once nobody changed it for 30 days. */
const drafts = expiringStrings("omp-agents.composer-drafts", 30 * 24 * 60 * 60 * 1000);

/** The draft of a live session's or subagent's composer. */
export const liveDraftKey = (view: LiveView): string => (view.agentId === null ? `live/${view.instanceId}` : `live/${view.instanceId}/${view.agentId}`);

/** The draft of the new-session page: one for the plain draft, one for each todo it starts from. */
export const newDraftKey = (todoId: string | null): string => (todoId === null ? "new" : `new/todo/${todoId}`);

/** The draft of a Bot's composer while no omp runs its conversation. */
export const botDraftKey = (id: BotId): string => `bot/${id}`;

/** Puts `text` in the composer of `key` for its next mount; `""` forgets it. */
export const putDraft = (key: string, text: string): void => drafts.set(key, text === "" ? null : text);

export const clearDraft = (key: string): void => drafts.set(key, null);

/** `text` added to `draft`, a blank line after what was typed; the mounted composer and the kept draft must append alike. */
const withAppended = (draft: string, text: string): string => (draft.trim() ? `${draft}\n\n${text}` : text);

/** What the mounted composers take from elsewhere on the page, by draft key: `send` reaches each one and says whether any did. */
function composerChannel<T>() {
	const receivers = new Map<string, Set<(value: T) => void>>();
	return {
		send(key: string, value: T): boolean {
			const mounted = receivers.get(key);
			if (!mounted?.size) return false;
			for (const receive of mounted) receive(value);
			return true;
		},
		/** Has the composer of `key` take what is sent to it while mounted; `null` takes nothing. */
		useReceiver(key: string | null, receive: (value: T) => void): void {
			const latest = useRef(receive);
			latest.current = receive;
			useEffect(() => {
				if (key === null) return;
				const forward = (value: T): void => latest.current(value);
				const mounted = receivers.get(key) ?? new Set();
				receivers.set(key, mounted.add(forward));
				return () => {
					mounted.delete(forward);
					if (mounted.size === 0) receivers.delete(key);
				};
			}, [key]);
		},
	};
}

const texts = composerChannel<string>();
const files = composerChannel<File>();

/** Appends `text` to the composer of `key`: in place when it is mounted, without taking focus, else to its kept draft. */
export function appendToComposer(key: string, text: string): void {
	if (!texts.send(key, text)) putDraft(key, withAppended(drafts.get(key) ?? "", text));
}

/** Attaches `file` to the mounted composer of `key`, without taking focus; `false` when none is mounted, since attachments live only in it. */
export const attachToComposer = (key: string, file: File): boolean => files.send(key, file);

/** Has the composer of `key` take the files {@link attachToComposer} sends it. */
export const useComposerFiles = files.useReceiver;

/**
 * A composer's text, starting from the draft kept under `key`, else from `seed`, and kept there as it changes. Empty
 * text, or text equal to `seed`, keeps nothing, so a sent, scheduled, or emptied message forgets the draft. `null` keeps
 * nothing at all. The key is fixed for the composer's life: key the component by it to switch drafts.
 */
export function useComposerDraft(key: string | null, seed: string): [string, Dispatch<SetStateAction<string>>] {
	const [slot] = useState(key);
	const [text, setText] = useState(() => (slot === null ? seed : (drafts.get(slot) ?? seed)));
	// The seed it opened with: a later one, such as a todo edited in another window, is not where this draft started.
	const [start] = useState(seed);
	useEffect(() => {
		if (slot !== null) drafts.set(slot, text === "" || text === start ? null : text);
	}, [slot, start, text]);
	texts.useReceiver(slot, added => setText(current => withAppended(current, added)));
	return [text, setText];
}
