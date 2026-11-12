/**
 * What passes between a view's artifact cards and its Artifacts tab: the version the tab is asked to show, the requests
 * that ask for one, and the version the tab has on screen, which turns a card's Open into Showing.
 */
import type { View } from "../src/shared/sessions";
import type { ArtifactPick } from "./artifacts-model";
import { keyedStore } from "./keyed-store";
import { hashForView } from "./routing";

/** A save the agent made, which shows its file's latest version, or a card's Open, which shows that card's version. */
export interface ArtifactRequest extends ArtifactPick {
	view: View;
	reason: "saved" | "clicked";
}

/** The version on screen in the Artifacts tab, by its file and number. */
export interface ShownArtifact {
	file: string;
	number: number;
}

/** Per view, by {@link hashForView}, so the pick outlives the tab while another tab shows and the details of another view. */
const picks = keyedStore<ArtifactPick | null>(null);
const shown = keyedStore<ShownArtifact | null>(null);
const listeners = new Set<(request: ArtifactRequest) => void>();

/** Points the view's tab at the request's version, then tells the listeners, such as the page, which brings the tab into sight. */
export function requestArtifact(request: ArtifactRequest): void {
	picks.set(hashForView(request.view), { file: request.file, version: request.version });
	for (const listener of listeners) listener(request);
}

/** Calls `listener` after each {@link requestArtifact}, until the returned function stops it. */
export function onArtifactRequest(listener: (request: ArtifactRequest) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Points the view's tab at `pick`, as its own tabs, version buttons, and Go to latest do. */
export const pickArtifact = (view: View, pick: ArtifactPick): void => picks.set(hashForView(view), pick);

export const useArtifactPick = (view: View): ArtifactPick | null => picks.use(hashForView(view));

/** Records what the view's tab has on screen; `null` once it no longer shows, such as when another tab or the closed sidebar hides it. */
export const showArtifact = (view: View, artifact: ShownArtifact | null): void => shown.set(hashForView(view), artifact);

export const useShownArtifact = (view: View): ShownArtifact | null => shown.use(hashForView(view));
