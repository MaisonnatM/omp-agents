import type { AgentMedia, CompletionItem, Item, ServerMsg, SessionWork, View } from "../src/shared";
import { keyedStore } from "./keyed-store";
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
	/** Whether the server sent the view's transcript yet, so an empty `items` means an empty conversation. */
	loaded: boolean;
	completions: Completions | null;
	/** The last texts the server took out of the view's queue, answering the composer's `dequeue` `reqId`. */
	dequeued: { reqId: number; texts: string[] } | null;
	/** What the view's agent planned and changed; `null` until the server sends it. */
	work: SessionWork | null;
	/** The images its agent's and its subagents' tools returned, newest first; `null` until the server sends them. */
	media: AgentMedia[] | null;
}

export const EMPTY_PANE: PaneData = { items: [], loaded: false, completions: null, dequeued: null, work: null, media: null };

/** The server messages that belong to one open view: its transcript, its plan and changes, its images, its composer's suggestions, and its dequeued texts. */
export type PaneMsg =
	| Extract<ServerMsg, { t: "items" | "work" | "media" | "dequeued" }>
	| (Extract<ServerMsg, { t: "completions" }> & { scope: { kind: "live" } });

/**
 * Per open view, by {@link hashForView}. Outside React state on purpose: a streamed token changes one view's entry and
 * wakes only the pane reading it, instead of rendering the whole page and every other pane's transcript again.
 */
const panes = keyedStore(EMPTY_PANE);
let open = new Set<string>();

/** Keeps the data of `views` and drops the rest; messages for other views are ignored until they open. */
export function retainPanes(views: View[]): void {
	const next = new Set(views.map(hashForView));
	for (const key of open) if (!next.has(key)) panes.set(key, EMPTY_PANE);
	open = next;
}

/** Applies a message to its view's entry. Views the page does not show ignore it. */
export function applyPaneMessage(msg: PaneMsg): void {
	const view = msg.t === "completions" ? msg.scope.view : msg.view;
	const key = hashForView(view);
	if (!open.has(key)) return;
	const pane = panes.get(key) ?? EMPTY_PANE;
	switch (msg.t) {
		case "items":
			panes.set(key, { ...pane, items: applyItems(pane.items, msg.reset, msg.items), loaded: true });
			break;
		case "work":
			panes.set(key, { ...pane, work: msg.work });
			break;
		case "media":
			panes.set(key, { ...pane, media: msg.media });
			break;
		case "completions":
			panes.set(key, { ...pane, completions: { reqId: msg.reqId, items: msg.items, error: msg.error } });
			break;
		case "dequeued":
			panes.set(key, { ...pane, dequeued: { reqId: msg.reqId, texts: msg.texts } });
			break;
		default: {
			const never: never = msg;
			return never;
		}
	}
}

/** `view`'s data from the server, rendering again only when that view's entry changes. */
export function usePane(view: View): PaneData {
	return panes.use(hashForView(view));
}
