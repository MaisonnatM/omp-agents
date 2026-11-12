import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ServerMsg } from "../src/shared/protocol";
import type { CompletionItem, View, WithdrawnMessage } from "../src/shared/sessions";
import type { Turn } from "../src/shared/trajectory";
import { type AgentMedia, type AgentSource, type ChangedFile, type Item, newestMediaFirst } from "../src/shared/transcript";
import { type Artifact, type ArtifactToolItem, artifactsOf, savedArtifact } from "./artifacts-model";
import { applyDelta } from "./keyed-list";
import { keyedStore } from "./keyed-store";
import { hashForView } from "./routing";
import { nextSuggestions } from "./transcript-view";

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
	/** The messages the server last took out of the view's queue, answering the composer's `reqId`. */
	withdrawn: { reqId: number; messages: WithdrawnMessage[] } | null;
	/** The files the view's agent changed, in first-touch order; `null` until the server sends them. */
	files: ChangedFile[] | null;
	/** The images its agent's and its subagents' tools returned, newest first; `null` until the server sends them. */
	media: AgentMedia[] | null;
	/** The web pages and remote items its agent's and its subagents' tools opened, oldest first; `null` until the server sends them. */
	sources: AgentSource[] | null;
	/** The view's turns while its Trajectory shows; `null` until the server sends them. */
	turns: Turn[] | null;
}

/** The part of a view's data its composer reads: the server's last answers to its `complete`, `dequeue`, and `interrupt`. */
export type ComposerData = Pick<PaneData, "completions" | "withdrawn">;

export const EMPTY_PANE: PaneData = { items: [], loaded: false, completions: null, withdrawn: null, files: null, media: null, sources: null, turns: null };

/** The server messages that belong to one open view: its transcript, its changed files, its images, its turns, its composer's suggestions, and the queued messages it took back. */
export type PaneMsg =
	| Extract<ServerMsg, { t: "items" | "work" | "media" | "turns" | "withdrawn" }>
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

let trajectories = new Set<string>();

/** Keeps the turns of `views` and drops the rest's, so a Trajectory shown again waits for fresh turns instead of showing stale ones. */
export function retainTrajectories(views: View[]): void {
	const next = new Set(views.map(hashForView));
	for (const key of trajectories) if (!next.has(key) && panes.get(key).turns !== null) panes.set(key, { ...panes.get(key), turns: null });
	trajectories = next;
}

/** Applies a message to its view's entry. Views the page does not show ignore it. */
export function applyPaneMessage(msg: PaneMsg): void {
	const view = msg.t === "completions" ? msg.scope.view : msg.view;
	const key = hashForView(view);
	if (!open.has(key)) return;
	const pane = panes.get(key);
	switch (msg.t) {
		case "items":
			panes.set(key, { ...pane, items: applyDelta(pane.items, msg.reset, msg.items, item => item.id, msg.removed), loaded: true });
			break;
		case "work":
			panes.set(key, { ...pane, files: applyDelta(pane.files ?? [], msg.reset, msg.files, file => file.path, []) });
			break;
		case "media":
			panes.set(key, {
				...pane,
				media: msg.reset ? msg.media : msg.media.length > 0 ? [...(pane.media ?? []), ...msg.media].sort(newestMediaFirst) : pane.media,
				sources: msg.reset ? msg.sources : msg.sources.length > 0 ? [...(pane.sources ?? []), ...msg.sources].sort((a, b) => a.at - b.at) : pane.sources,
			});
			break;
		case "turns":
			if (trajectories.has(key)) panes.set(key, { ...pane, turns: applyDelta(pane.turns ?? [], msg.reset, msg.turns, turn => turn.id, []) });
			break;
		case "completions":
			panes.set(key, { ...pane, completions: { reqId: msg.reqId, items: msg.items, error: msg.error } });
			break;
		case "withdrawn":
			panes.set(key, { ...pane, withdrawn: { reqId: msg.reqId, messages: msg.messages } });
			break;
		default: {
			const never: never = msg;
			return never;
		}
	}
}

/** `view`'s transcript as the store holds it now, outside React; `null` when the page does not show the view. */
export function paneItemsOf(view: View): Item[] | null {
	const key = hashForView(view);
	return open.has(key) ? panes.get(key).items : null;
}

/**
 * A field of `view`'s data, rendering again only when that field changes. A streamed token changes `items` alone, so a
 * component that reads another field never renders for it; each hook below names the field it reads. With no view it reads an empty pane.
 */
export function usePaneSelect<S>(view: View | null, select: (pane: PaneData) => S, equal?: (a: S, b: S) => boolean): S {
	return panes.useSelect(view ? hashForView(view) : "", select, equal);
}

const itemsOf = (pane: PaneData): Item[] => pane.items;
const loadedOf = (pane: PaneData): boolean => pane.loaded;
const filesOf = (pane: PaneData): ChangedFile[] | null => pane.files;
const mediaOf = (pane: PaneData): AgentMedia[] | null => pane.media;
const sourcesOf = (pane: PaneData): AgentSource[] | null => pane.sources;
const turnsOf = (pane: PaneData): Turn[] | null => pane.turns;
const composerOf = ({ completions, withdrawn }: PaneData): ComposerData => ({ completions, withdrawn });
const sameComposer = (a: ComposerData, b: ComposerData): boolean => a.completions === b.completions && a.withdrawn === b.withdrawn;
const sameElements = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((entry, index) => entry === b[index]);
const savesOf = (pane: PaneData): ArtifactToolItem[] => pane.items.filter(savedArtifact);

/** `view`'s transcript: the one field a streamed token changes, so only the components that draw it read it. */
export const useTranscript = (view: View): Item[] => usePaneSelect(view, itemsOf);

/** Whether the server sent `view`'s transcript yet. */
export const usePaneLoaded = (view: View): boolean => usePaneSelect(view, loadedOf);

/** The files `view`'s agent changed, in first-touch order; `null` until the server sends them. */
export const useChangedFiles = (view: View): ChangedFile[] | null => usePaneSelect(view, filesOf);

/** The images `view`'s agent's and its subagents' tools returned, newest first; `null` until the server sends them. */
export const useMedia = (view: View): AgentMedia[] | null => usePaneSelect(view, mediaOf);

/** The web pages and remote items `view`'s agent's and its subagents' tools opened, oldest first; `null` until the server sends them. */
export const useSources = (view: View): AgentSource[] | null => usePaneSelect(view, sourcesOf);

/** `view`'s turns, in order; `null` until the server sends them. */
export const useTurns = (view: View): Turn[] | null => usePaneSelect(view, turnsOf);

/**
 * `view`'s artifacts, built again only when a saving item changes: a delta keeps every item it did not change the same
 * object, so a streamed token leaves the saves as they were.
 */
export function useArtifacts(view: View): Artifact[] {
	const saves = usePaneSelect(view, savesOf, sameElements);
	return useMemo(() => artifactsOf(saves), [saves]);
}

/** Views some mounted components show, by {@link hashForView}, with how many components show each, as one list the page streams. */
interface ShownViews {
	change: (view: View, delta: 1 | -1) => void;
	subscribe: (listener: () => void) => () => void;
	snapshot: () => View[];
}

export function shownViews(): ShownViews {
	const counts = new Map<string, { view: View; count: number }>();
	const listeners = new Set<() => void>();
	let list: View[] = [];
	return {
		change: (view, delta) => {
			const key = hashForView(view);
			const count = (counts.get(key)?.count ?? 0) + delta;
			if (count > 0) counts.set(key, { view, count });
			else counts.delete(key);
			list = [...counts.values()].map(entry => entry.view);
			for (const listener of listeners) listener();
		},
		subscribe: listener => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		snapshot: () => list,
	};
}

/** Counts `view` in `views` while the calling component is mounted. Keyed by the view's hash, so a caller may build a new `view` object each render. */
function useShownIn(views: ShownViews, view: View | null): void {
	const key = view && hashForView(view);
	useEffect(() => {
		if (!view) return;
		views.change(view, 1);
		return () => views.change(view, -1);
	}, [views, key]);
}

const shownTrajectories = shownViews();
const shownConversations = shownViews();

/** Asks the server for `view`'s turns while the calling component is mounted. */
export const useShowTrajectory = (view: View): void => useShownIn(shownTrajectories, view);

/** The views whose Trajectory the page shows, which it asks the server to stream. */
export const useShownTrajectories = (): View[] => useSyncExternalStore(shownTrajectories.subscribe, shownTrajectories.snapshot, shownTrajectories.snapshot);

/**
 * Asks the server to stream `view`'s conversation while the calling component is mounted and a page covers the panes, as a
 * Bot's page does for its open session. `null` asks for nothing. It marks nothing read: `useAttention` does that.
 */
export const useShowConversation = (view: View | null): void => useShownIn(shownConversations, view);

/** The views whose conversation a page shows outside the panes, which the page asks the server to stream. */
export const useShownConversations = (): View[] => useSyncExternalStore(shownConversations.subscribe, shownConversations.snapshot, shownConversations.snapshot);

/** What the server answered `view`'s composer: its last `complete` and its last `dequeue`. */
export const useComposerData = (view: View): ComposerData => usePaneSelect(view, composerOf, sameComposer);

/** What the last turn of `view`'s transcript suggests sending next, as {@link nextSuggestions} reads it. */
export function useNextSuggestions(view: View, working: boolean): string[] {
	const select = useMemo(() => (pane: PaneData) => nextSuggestions(pane.items, working), [working]);
	return usePaneSelect(view, select, sameElements);
}
