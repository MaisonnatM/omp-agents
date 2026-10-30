/** The pages a session asks you to review visually: the latest `review-pages` fence in its agent's replies, and the request that opens them in the Browser. */
import type { Item } from "../src/shared/transcript";
import { isLoopbackUrl } from "../src/shared/desktop-bridge";
import { keyedStore } from "./keyed-store";

/** One page to look at: where it is on this computer, what to call its tab, and how to reach a state its address cannot open. */
export interface ReviewPage {
	label: string;
	url: string;
	note: string | null;
}

/** The most tabs one review opens, each a page kept loaded in memory. */
export const MAX_REVIEW_PAGES = 8;

const FENCE = /```review-pages[^\S\n]*\n([\s\S]*?)```/g;

function pageOf(raw: unknown): ReviewPage | null {
	if (typeof raw !== "object" || raw === null) return null;
	const { label, url, note } = raw as Record<string, unknown>;
	if (typeof url !== "string" || !isLoopbackUrl(url)) return null;
	return { label: typeof label === "string" && label.trim() ? label.trim() : url, url, note: typeof note === "string" && note.trim() ? note.trim() : null };
}

/**
 * The pages a `review-pages` fence's `source` lists: a JSON array of `{label, url, note?}`, keeping only addresses on
 * this computer, each once, up to {@link MAX_REVIEW_PAGES}; `null` when it is not a JSON array.
 */
export function parseReviewPages(source: string): ReviewPage[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;
	const pages = parsed.flatMap(raw => pageOf(raw) ?? []);
	return pages.filter((page, at) => pages.findIndex(other => other.url === page.url) === at).slice(0, MAX_REVIEW_PAGES);
}

/** The pages of the last valid `review-pages` fence in a settled agent reply; empty before one. */
export function latestReviewPages(items: readonly Item[]): ReviewPage[] {
	for (let at = items.length - 1; at >= 0; at--) {
		const item = items[at]!;
		if (item.kind !== "assistant" || item.streaming) continue;
		for (const match of [...item.text.matchAll(FENCE)].reverse()) {
			const pages = parseReviewPages(match[1]!);
			if (pages !== null) return pages;
		}
	}
	return [];
}

export const NO_REVIEW_PAGES: readonly ReviewPage[] = [];

/** Each live session's review pages, by instance id, which its transcript publishes and its Browser reads. */
export const reviewPagesStore = keyedStore<readonly ReviewPage[]>(NO_REVIEW_PAGES);

/** Each live session's latest **Review visuals** click, by instance id, which its Browser opens as tabs. */
export const reviewRequestStore = keyedStore<number>(0);
