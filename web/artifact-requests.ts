/**
 * What passes between a view's artifact cards and its Artifacts tab: the version the tab is asked to show, the asks that
 * bring the tab into sight, and the version the tab has on screen, which turns a card's Open into Showing.
 */
import type { ServerMsg } from "../src/shared/protocol";
import type { View } from "../src/shared/sessions";
import { type ArtifactPick, landedSaves } from "./artifacts-model";
import { keyedStore } from "./keyed-store";
import { applyPaneMessage, paneItemsOf } from "./pane-store";
import { hashForView } from "./routing";

/** The version on screen in the Artifacts tab, by its file and number. */
export interface ShownArtifact {
	file: string;
	number: number;
}

/** Per view, by {@link hashForView}, so the pick outlives the tab while another tab shows and the details of another view. */
const picks = keyedStore<ArtifactPick | null>(null);
const shown = keyedStore<ShownArtifact | null>(null);
const reveals = new Set<(view: View) => void>();
const opens = new Set<(view: View) => void>();

function listen(listeners: Set<(view: View) => void>, listener: (view: View) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Points the view's tab at `pick`, as its own tabs, version buttons, and Go to latest do. */
export const pickArtifact = (view: View, pick: ArtifactPick): void => picks.set(hashForView(view), pick);

export const useArtifactPick = (view: View): ArtifactPick | null => picks.use(hashForView(view));

/**
 * Applies an `items` message to its view, then points the view's tab at the latest version of each artifact the delta
 * newly saved and asks {@link onArtifactsReveal}'s listeners to show the tab. The transcript is read before the delta
 * applies, so a call turning from running to done lands its save once.
 */
export function applyItems(msg: Extract<ServerMsg, { t: "items" }>): void {
	const before = paneItemsOf(msg.view);
	const saves = before ? landedSaves(before, msg) : [];
	applyPaneMessage(msg);
	for (const save of saves) {
		pickArtifact(msg.view, { file: save.file, version: "latest" });
		for (const listener of reveals) listener(msg.view);
	}
}

/** Calls `listener` for each save that lands in a view, until the returned function stops it. */
export const onArtifactsReveal = (listener: (view: View) => void): (() => void) => listen(reveals, listener);

/** A card's Open: points the view's tab at `pick`, then asks {@link onArtifactOpen}'s listeners to bring the view and its tab into sight. */
export function openArtifact(view: View, pick: ArtifactPick): void {
	pickArtifact(view, pick);
	for (const listener of opens) listener(view);
}

/** Calls `listener` after each {@link openArtifact}, until the returned function stops it. */
export const onArtifactOpen = (listener: (view: View) => void): (() => void) => listen(opens, listener);

/** Records what the view's tab has on screen; `null` once it no longer shows, such as when another tab or the closed sidebar hides it. */
export const showArtifact = (view: View, artifact: ShownArtifact | null): void => shown.set(hashForView(view), artifact);

export const useShownArtifact = (view: View): ShownArtifact | null => shown.use(hashForView(view));
