/** The message a view scrolls to once its transcript shows it, which the command palette asks for when it opens a conversation at a match. */
import { useSyncExternalStore } from "react";
import type { View } from "../src/shared/sessions";
import { hashForView } from "./routing";

/** How long a reveal waits for its message; a view opened later, by other means, keeps its own scroll. */
const REVEAL_WAIT_MS = 10_000;

let pending: { view: string; messageId: string; until: number } | null = null;
const listeners = new Set<() => void>();

const notify = (): void => {
	for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

/** Scroll `view`'s transcript to message `messageId` once it shows. */
export function revealMessage(view: View, messageId: string): void {
	pending = { view: hashForView(view), messageId, until: Date.now() + REVEAL_WAIT_MS };
	notify();
}

/** The message `view` should scroll to, `null` for none, and `done` to call once it has. */
export function useReveal(view: View): { messageId: string | null; done: () => void } {
	const target = useSyncExternalStore(subscribe, () => pending);
	const mine = target !== null && target.view === hashForView(view) && Date.now() < target.until ? target : null;
	return {
		messageId: mine?.messageId ?? null,
		done: () => {
			if (pending !== mine) return;
			pending = null;
			notify();
		},
	};
}
