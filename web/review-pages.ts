/** The pages a session asks you to review visually: the latest `review-pages` fence in its agent's replies. */
import { isLoopbackUrl } from "../src/shared/desktop-bridge";
import { MAX_REVIEW_PAGES } from "../src/shared/session-visuals";
import { fencedList } from "./fenced-list";

/** One page to look at: where it is on this computer, what to call its tab, and how to reach a state its address cannot open. */
export interface ReviewPage {
	label: string;
	url: string;
	note: string | null;
}

function pageOf(raw: unknown): ReviewPage | null {
	if (typeof raw !== "object" || raw === null) return null;
	const { label, url, note } = raw as Record<string, unknown>;
	if (typeof url !== "string" || !isLoopbackUrl(url)) return null;
	return { label: typeof label === "string" && label.trim() ? label.trim() : url, url, note: typeof note === "string" && note.trim() ? note.trim() : null };
}

/** `review-pages` fences: each a JSON array of `{label, url, note?}`, keeping only addresses on this computer, each once, up to {@link MAX_REVIEW_PAGES}. */
const pages = fencedList({ language: "review-pages", itemOf: pageOf, keyOf: page => page.url, max: MAX_REVIEW_PAGES });

export const { parse: parseReviewPages, latest: latestReviewPages, same: samePages } = pages;

/** A **Review visuals** click on a reply: the live session whose Browser opens `pages` as tabs. */
interface ReviewRequest {
	instanceId: string;
	pages: readonly ReviewPage[];
}

/** The request no Browser took yet, kept so a Browser that mounts after the click still opens it. */
let pending: ReviewRequest | null = null;
const listeners = new Set<() => void>();

export function requestReview(request: ReviewRequest): void {
	pending = request;
	for (const listener of listeners) listener();
}

/** The pages a click asked session `instanceId`'s Browser to open, once; `null` when none waits for it. */
export function takeReview(instanceId: string): readonly ReviewPage[] | null {
	if (pending?.instanceId !== instanceId) return null;
	const { pages } = pending;
	pending = null;
	return pages;
}

/** Calls `listener` after each {@link requestReview}, until the returned function stops it. */
export function onReviewRequest(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
