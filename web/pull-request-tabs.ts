import { useEffect } from "react";
import { parsePullRequest, prKey, type PullRequest } from "../src/shared/github";
import { hashForPullRequestFiles, hashForPullRequests } from "./routing";
import { useStoredState } from "./stored-state";

const DETAIL_TABS = ["summary", "timeline", "code", "review"] as const;
export type PullRequestDetailTab = (typeof DETAIL_TABS)[number];
export interface PullRequestTab extends PullRequest {
	detailTab: PullRequestDetailTab;
}
export interface PullRequestTabs {
	open: PullRequestTab[];
	active: string | null;
}
const PULL_REQUEST_TABS_KEY = "omp-agents.pull-request-tabs";
const isDetailTab = (value: unknown): value is PullRequestDetailTab => DETAIL_TABS.some(tab => tab === value);

function decodeTabList(items: unknown): PullRequestTab[] {
	const open: PullRequestTab[] = [];
	for (const item of Array.isArray(items) ? items : []) {
		if (!item || typeof item !== "object") continue;
		const pr = parsePullRequest(item.owner, item.repo, item.number);
		if (!pr || open.some(other => prKey(other) === prKey(pr.ok))) continue;
		open.push({ ...pr.ok, detailTab: isDetailTab(item.detailTab) ? item.detailTab : "summary" });
	}
	return open;
}

/** The Pull requests page's open tabs, which store no active tab, since the route says which one shows. */
export function decodePageTabs(raw: string | null): PullRequestTab[] {
	try {
		return decodeTabList(JSON.parse(raw ?? "null"));
	} catch {
		return [];
	}
}

export const pullRequestTabHash = (tab: PullRequestTab): string => (tab.detailTab === "code" ? hashForPullRequestFiles(tab) : hashForPullRequests(tab));

/** The tab that shows once the shown `pr` closes: its right neighbour, else its left, else none. */
export function neighbourAfterClose(open: readonly PullRequestTab[], pr: PullRequest): PullRequestTab | null {
	const index = open.findIndex(tab => prKey(tab) === prKey(pr));
	return index < 0 ? null : (open[index + 1] ?? open[index - 1] ?? null);
}

export type PullRequestTabEvent =
	| { type: "open"; pr: PullRequest }
	| { type: "close"; pr: PullRequest }
	| { type: "close-others"; pr: PullRequest }
	| { type: "move"; pr: PullRequest; to: number }
	| { type: "detail"; pr: PullRequest; tab: PullRequestDetailTab };

export function changePullRequestTabs(state: PullRequestTabs, event: PullRequestTabEvent): PullRequestTabs {
	const key = prKey(event.pr);
	const index = state.open.findIndex(pr => prKey(pr) === key);
	const tab = state.open[index];
	if (event.type === "open") {
		if (tab) return state.active === key ? state : { ...state, active: key };
		return { open: [...state.open, { owner: event.pr.owner, repo: event.pr.repo, number: event.pr.number, detailTab: "summary" }], active: key };
	}
	if (!tab) return state;
	switch (event.type) {
		case "close-others":
			return { open: [tab], active: key };
		case "close": {
			const open = state.open.filter(pr => pr !== tab);
			if (state.active !== key) return { ...state, open };
			const neighbour = neighbourAfterClose(state.open, tab);
			return { open, active: neighbour && prKey(neighbour) };
		}
		case "detail":
			if (tab.detailTab === event.tab) return state;
			return { ...state, open: state.open.map((pr, at) => at === index ? { ...pr, detailTab: event.tab } : pr) };
		case "move": {
			const to = Math.max(0, Math.min(state.open.length - 1, event.to));
			if (to === index) return state;
			const open = state.open.filter(pr => pr !== tab);
			open.splice(to, 0, tab);
			return { ...state, open };
		}
		default: {
			const unhandled: never = event;
			return unhandled;
		}
	}
}

/** The page's detail tab of `pr`: the route alone says whether it is Code, and otherwise it is the tab `pr` last showed. */
export function pageDetailTab(open: readonly PullRequestTab[], pr: PullRequest, code: boolean): PullRequestDetailTab {
	if (code) return "code";
	const kept = open.find(tab => prKey(tab) === prKey(pr))?.detailTab ?? "summary";
	return kept === "code" ? "summary" : kept;
}

export interface PullRequestTabsControl {
	tabs: PullRequestTabs;
	dispatch: (event: PullRequestTabEvent) => void;
}

/**
 * The Pull requests page's strip, which every window shares, with `target`, the route's PR, as its active tab. The route opening a
 * PR adds its tab; an event that changes the active tab changes the route.
 */
export function usePagePullRequestTabs(target: PullRequest | null): PullRequestTabsControl {
	const [stored, setStored] = useStoredState(PULL_REQUEST_TABS_KEY, decodePageTabs, JSON.stringify);
	const key = target && prKey(target);
	useEffect(() => {
		if (target) setStored(previous => changePullRequestTabs({ open: previous, active: null }, { type: "open", pr: target }).open);
	}, [key, setStored]);
	const tabs = target ? changePullRequestTabs({ open: stored, active: null }, { type: "open", pr: target }) : { open: stored, active: null };
	const dispatch = (event: PullRequestTabEvent): void => {
		const next = changePullRequestTabs(tabs, event);
		if (next.open !== tabs.open) setStored(next.open);
		if (next.active === tabs.active) return;
		const shown = next.open.find(tab => prKey(tab) === next.active);
		location.hash = shown ? pullRequestTabHash(shown) : hashForPullRequests(null);
	};
	return { tabs, dispatch };
}
