/** The message a view scrolls to once its transcript has loaded, which the command palette asks for when it opens a conversation at a match. */
import type { View } from "../src/shared/sessions";
import { keyedStore } from "./keyed-store";
import { hashForView } from "./routing";

/** The message to scroll to, by the view's hash; one view at a time. */
const reveals = keyedStore<string | null>(null);
let revealing: string | null = null;

/** Scroll `view`'s transcript to message `messageId` once it has loaded; a reveal asked before for another view is dropped. */
export function revealMessage(view: View, messageId: string): void {
	if (revealing !== null) reveals.set(revealing, null);
	revealing = hashForView(view);
	reveals.set(revealing, messageId);
}

/** The message `view` should scroll to, `null` for none. */
export const useReveal = (view: View): string | null => reveals.use(hashForView(view));

/** `view` tried its reveal, found or not, so a later visit keeps its own scroll. */
export function revealed(view: View): void {
	reveals.set(hashForView(view), null);
}
