/** The pages a session asks you to review visually: the latest `review-pages` fence in its agent's replies, and the request that opens them in the Browser. */
import type { Item } from "../src/shared/transcript";
import { isLoopbackUrl } from "../src/shared/desktop-bridge";
import { keyedStore } from "./keyed-store";
import { storeOrRemove } from "./stored-state";

/** One page to look at: where it is on this computer, what to call its tab, and how to reach a state its address cannot open. */
export interface ReviewPage {
	label: string;
	url: string;
	note: string | null;
}

const FENCE = /```review-pages\s*\n([\s\S]*?)```/g;

function pageOf(raw: unknown): ReviewPage | null {
	if (typeof raw !== "object" || raw === null) return null;
	const { label, url, note } = raw as Record<string, unknown>;
	if (typeof url !== "string" || !isLoopbackUrl(url)) return null;
	return { label: typeof label === "string" && label.trim() ? label.trim() : url, url, note: typeof note === "string" && note.trim() ? note.trim() : null };
}

/** The pages of the last parseable `review-pages` fence the agent wrote, keeping only addresses on this computer; empty before one. */
export function latestReviewPages(items: readonly Item[]): ReviewPage[] {
	for (let at = items.length - 1; at >= 0; at--) {
		const item = items[at]!;
		if (item.kind !== "assistant" || item.streaming) continue;
		for (const match of [...item.text.matchAll(FENCE)].reverse()) {
			try {
				const parsed: unknown = JSON.parse(match[1]!);
				if (Array.isArray(parsed)) return parsed.flatMap(raw => pageOf(raw) ?? []);
			} catch {}
		}
	}
	return [];
}

export const NO_REVIEW_PAGES: readonly ReviewPage[] = [];

/** Each live session's review pages, by instance id, which its transcript publishes and its header and Browser read. */
export const reviewPagesStore = keyedStore<readonly ReviewPage[]>(NO_REVIEW_PAGES);

/** Each live session's latest **Review visuals** click, by instance id, which its Browser opens as tabs. */
export const reviewRequestStore = keyedStore<number>(0);

/** The right sidebar's tab key and default, as `session-details.tsx` keeps them. */
const TAB_KEY = "omp-agents.plan-tab";

export const REVIEW_OPEN_EVENT = "omp-agents:review-visuals";

/** Shows the right sidebar on its Browser tab and asks session `instanceId`'s Browser to open each review page. */
export function openReview(instanceId: string): void {
	storeOrRemove(TAB_KEY, "browser", "pull-requests");
	reviewRequestStore.set(instanceId, Date.now());
	window.dispatchEvent(new Event(REVIEW_OPEN_EVENT));
}
