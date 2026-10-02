import { useCallback, useSyncExternalStore } from "react";
import type { CompletionItem, Item, ServerMsg, View } from "../src/shared";
import { hashForView } from "./routing";
import { applyItems } from "./transcript-view";

export interface Completions {
	reqId: number;
	items: CompletionItem[];
	error: string | null;
}

/** What the server sent for one open view. */
export interface PaneData {
	items: Item[];
	completions: Completions | null;
	/** The last texts the server took out of the view's queue, answering the composer's `dequeue` `reqId`. */
	dequeued: { reqId: number; texts: string[] } | null;
}

export const EMPTY_PANE: PaneData = { items: [], completions: null, dequeued: null };

/** The server messages that belong to one open view: its transcript, its composer's suggestions, and its dequeued texts. */
export type PaneMsg =
	| Extract<ServerMsg, { t: "items" | "dequeued" }>
	| (Extract<ServerMsg, { t: "completions" }> & { scope: { kind: "live" } });

export const isPaneMsg = (msg: ServerMsg): msg is PaneMsg => msg.t === "items" || msg.t === "dequeued" || (msg.t === "completions" && msg.scope.kind === "live");

/**
 * Per open view, by {@link hashForView}. Outside React state on purpose: a streamed token changes one view's entry and
 * wakes only the pane reading it, instead of rendering the whole page and every other pane's transcript again.
 */
const panes = new Map<string, PaneData>();
const listeners = new Map<string, Set<() => void>>();
let open = new Set<string>();

/** Keeps the data of `views` and drops the rest; messages for other views are ignored until they open. */
export function retainPanes(views: View[]): void {
	open = new Set(views.map(hashForView));
	for (const key of panes.keys()) if (!open.has(key)) panes.delete(key);
}

/** Applies a message to its view's entry. Views the page does not show ignore it. */
export function applyPaneMessage(msg: PaneMsg): void {
	const view = msg.t === "completions" ? msg.scope.view : msg.view;
	const key = hashForView(view);
	if (!open.has(key)) return;
	const pane = panes.get(key) ?? EMPTY_PANE;
	switch (msg.t) {
		case "items":
			panes.set(key, { ...pane, items: applyItems(pane.items, msg.reset, msg.items) });
			break;
		case "completions":
			panes.set(key, { ...pane, completions: { reqId: msg.reqId, items: msg.items, error: msg.error } });
			break;
		case "dequeued":
			panes.set(key, { ...pane, dequeued: { reqId: msg.reqId, texts: msg.texts } });
			break;
	}
	for (const listener of listeners.get(key) ?? []) listener();
}

const subscribe = (key: string, listener: () => void): (() => void) => {
	const set = listeners.get(key) ?? new Set();
	listeners.set(key, set.add(listener));
	return () => {
		set.delete(listener);
		if (set.size === 0) listeners.delete(key);
	};
};

/** `view`'s data from the server, rendering again only when that view's entry changes. */
export function usePane(view: View): PaneData {
	const key = hashForView(view);
	const watch = useCallback((listener: () => void) => subscribe(key, listener), [key]);
	return useSyncExternalStore(watch, () => panes.get(key) ?? EMPTY_PANE);
}
