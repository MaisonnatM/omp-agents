import { useMemo } from "react";
import type { ServerMsg } from "../src/shared/protocol";
import type { CompletionItem, View } from "../src/shared/sessions";
import { type AgentMedia, type ChangedFile, type Item, newestMediaFirst } from "../src/shared/transcript";
import { applyDelta } from "./keyed-list";
import { keyedStore } from "./keyed-store";
import { hashForView } from "./routing";
import { nextSuggestions, turnCount } from "./transcript-view";

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
	/** The files the view's agent changed, in first-touch order; `null` until the server sends them. */
	files: ChangedFile[] | null;
	/** The images its agent's and its subagents' tools returned, newest first; `null` until the server sends them. */
	media: AgentMedia[] | null;
}

/** The part of a view's data its composer reads: the server's last answers to its `complete` and its `dequeue`. */
export type ComposerData = Pick<PaneData, "completions" | "dequeued">;

export const EMPTY_PANE: PaneData = { items: [], loaded: false, completions: null, dequeued: null, files: null, media: null };

/** The server messages that belong to one open view: its transcript, its changed files, its images, its composer's suggestions, and its dequeued texts. */
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
			panes.set(key, { ...pane, items: applyDelta(pane.items, msg.reset, msg.items, item => item.id, []), loaded: true });
			break;
		case "work":
			panes.set(key, { ...pane, files: applyDelta(pane.files ?? [], msg.reset, msg.files, file => file.path, []) });
			break;
		case "media":
			panes.set(key, { ...pane, media: msg.reset ? msg.media : [...(pane.media ?? []), ...msg.media].sort(newestMediaFirst) });
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

/**
 * A field of `view`'s data, rendering again only when that field changes. A streamed token changes `items` alone, so a
 * component that reads another field never renders for it; each hook below names the field it reads.
 */
export function usePaneSelect<S>(view: View, select: (pane: PaneData) => S, equal?: (a: S, b: S) => boolean): S {
	return panes.useSelect(hashForView(view), select, equal);
}

const itemsOf = (pane: PaneData): Item[] => pane.items;
const loadedOf = (pane: PaneData): boolean => pane.loaded;
const filesOf = (pane: PaneData): ChangedFile[] | null => pane.files;
const mediaOf = (pane: PaneData): AgentMedia[] | null => pane.media;
const turnCountOf = (pane: PaneData): number => turnCount(pane.items);
const composerOf = ({ completions, dequeued }: PaneData): ComposerData => ({ completions, dequeued });
const sameComposer = (a: ComposerData, b: ComposerData): boolean => a.completions === b.completions && a.dequeued === b.dequeued;
const sameStrings = (a: string[], b: string[]): boolean => a.length === b.length && a.every((text, index) => text === b[index]);

/** `view`'s transcript: the one field a streamed token changes, so only the components that draw it read it. */
export const useTranscript = (view: View): Item[] => usePaneSelect(view, itemsOf);

/** Whether the server sent `view`'s transcript yet. */
export const usePaneLoaded = (view: View): boolean => usePaneSelect(view, loadedOf);

/** The files `view`'s agent changed, in first-touch order; `null` until the server sends them. */
export const useChangedFiles = (view: View): ChangedFile[] | null => usePaneSelect(view, filesOf);

/** The images `view`'s agent's and its subagents' tools returned, newest first; `null` until the server sends them. */
export const useMedia = (view: View): AgentMedia[] | null => usePaneSelect(view, mediaOf);

/** What the server answered `view`'s composer: its last `complete` and its last `dequeue`. */
export const useComposerData = (view: View): ComposerData => usePaneSelect(view, composerOf, sameComposer);

/** How many turns `view`'s transcript holds, so a tab can count them without reading the transcript. */
export const useTurnCount = (view: View): number => usePaneSelect(view, turnCountOf);

/** What the last turn of `view`'s transcript suggests sending next, as {@link nextSuggestions} reads it. */
export function useNextSuggestions(view: View, working: boolean): string[] {
	const select = useMemo(() => (pane: PaneData) => nextSuggestions(pane.items, working), [working]);
	return usePaneSelect(view, select, sameStrings);
}
