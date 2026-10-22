import { expect, test } from "bun:test";
import { changePullRequestTabs as change, decodePageTabs, decodeSessionTabs, neighbourAfterClose, pageDetailTab, type PullRequestTabs, SESSION_TABS_KEPT, sessionPullRequestTabs, sessionTabsOf, storeSessionTabs } from "./pull-request-tabs";

const first = { owner: "acme", repo: "app", number: 1 };
const second = { owner: "acme", repo: "app", number: 2 };
const third = { owner: "acme", repo: "app", number: 3 };
const opened = (): PullRequestTabs => [first, second, third].reduce<PullRequestTabs>((tabs, pr) => change(tabs, { type: "open", pr }), { open: [], active: null });

test("opening an existing PR focuses it without moving it or losing its detail tab", () => {
	let tabs = change(opened(), { type: "detail", pr: first, tab: "timeline" });
	tabs = change(tabs, { type: "open", pr: { owner: "ACME", repo: "App", number: 1 } });
	expect(tabs).toEqual({ open: [{ ...first, detailTab: "timeline" }, { ...second, detailTab: "summary" }, { ...third, detailTab: "summary" }], active: "acme/app#1" });
});

test("closing the active tab picks its right neighbour, then its left, then the list", () => {
	let tabs = change(opened(), { type: "open", pr: second });
	tabs = change(tabs, { type: "close", pr: second });
	expect(tabs).toEqual({ open: [{ ...first, detailTab: "summary" }, { ...third, detailTab: "summary" }], active: "acme/app#3" });
	tabs = change(tabs, { type: "close", pr: third });
	expect(tabs).toEqual({ open: [{ ...first, detailTab: "summary" }], active: "acme/app#1" });
	expect(change(tabs, { type: "close", pr: first })).toEqual({ open: [], active: null });
});

test("closing an inactive tab leaves the active PR alone", () => {
	expect(change(opened(), { type: "close", pr: second })).toEqual({ open: [{ ...first, detailTab: "summary" }, { ...third, detailTab: "summary" }], active: "acme/app#3" });
});

test("moving tabs retains the active PR and each detail tab across storage", () => {
	let tabs = change(opened(), { type: "detail", pr: second, tab: "code" });
	tabs = change(tabs, { type: "move", pr: third, to: 0 });
	const stored = JSON.stringify(storeSessionTabs([], "session:s", tabs));
	expect(sessionTabsOf(decodeSessionTabs(stored), "session:s")).toEqual({ open: [{ ...third, detailTab: "summary" }, { ...first, detailTab: "summary" }, { ...second, detailTab: "code" }], active: "acme/app#3" });
});

test("close others focuses the kept tab", () => {
	expect(change(opened(), { type: "close-others", pr: second })).toEqual({ open: [{ ...second, detailTab: "summary" }], active: "acme/app#2" });
});

test("a session sidebar shows its first PR until another tab is active", () => {
	const empty: PullRequestTabs = { open: [], active: null };
	expect(sessionPullRequestTabs(empty, first)).toEqual({ open: [{ ...first, detailTab: "summary" }], active: "acme/app#1" });
	expect(sessionPullRequestTabs(empty, undefined)).toEqual(empty);
	const picked = change(opened(), { type: "open", pr: second });
	expect(sessionPullRequestTabs(picked, first)).toBe(picked);
	const closed = change(change(empty, { type: "open", pr: second }), { type: "close", pr: second });
	expect(sessionPullRequestTabs(closed, first)).toEqual({ open: [{ ...first, detailTab: "summary" }], active: "acme/app#1" });
});

test("storage rejects malformed PRs and duplicate identities, and resets an invalid active tab", () => {
	expect(decodeSessionTabs("broken")).toEqual([]);
	const open = [null, { ...first, detailTab: "old" }, { ...first, owner: "ACME" }, { ...second, number: -1 }];
	expect(decodeSessionTabs(JSON.stringify([{ scope: "session:s", open, active: "missing" }, { scope: "session:s", open: [second], active: null }, { open }]))).toEqual([{ scope: "session:s", open: [{ ...first, detailTab: "summary" }], active: null }]);
});

test("each session keeps its own tabs, the last changed move last, and the oldest past the cap drop", () => {
	let sessions = storeSessionTabs([], "session:a", opened());
	sessions = storeSessionTabs(sessions, "session:b", change({ open: [], active: null }, { type: "open", pr: second }));
	expect(sessionTabsOf(sessions, "session:a")).toEqual(opened());
	expect(sessionTabsOf(sessions, "session:c")).toEqual({ open: [], active: null });
	sessions = storeSessionTabs(sessions, "session:a", change(opened(), { type: "open", pr: first }));
	expect(sessions.map(session => session.scope)).toEqual(["session:b", "session:a"]);
	expect(storeSessionTabs(sessions, "session:b", { open: [], active: null }).map(session => session.scope)).toEqual(["session:a"]);
	for (let at = 0; at < SESSION_TABS_KEPT; at++) sessions = storeSessionTabs(sessions, `session:${at}`, opened());
	expect(sessions).toHaveLength(20);
	expect(sessions[0]?.scope).toBe("session:0");
});

test("the page's route alone says whether a PR shows Code", () => {
	let tabs = change(opened(), { type: "detail", pr: first, tab: "code" });
	tabs = change(tabs, { type: "detail", pr: second, tab: "timeline" });
	expect(pageDetailTab(tabs.open, first, false)).toBe("summary");
	expect(pageDetailTab(tabs.open, first, true)).toBe("code");
	expect(pageDetailTab(tabs.open, second, false)).toBe("timeline");
	expect(pageDetailTab(tabs.open, second, true)).toBe("code");
	expect(pageDetailTab(tabs.open, { owner: "acme", repo: "app", number: 9 }, false)).toBe("summary");
});

test("the shown tab's neighbour after it closes is the right one, then the left, then none", () => {
	const { open } = opened();
	expect(neighbourAfterClose(open, second)).toEqual({ ...third, detailTab: "summary" });
	expect(neighbourAfterClose(open, third)).toEqual({ ...second, detailTab: "summary" });
	expect(neighbourAfterClose([{ ...first, detailTab: "summary" }], first)).toBeNull();
	expect(neighbourAfterClose(open, { owner: "acme", repo: "app", number: 9 })).toBeNull();
});

test("the page stores its tabs' order and detail tabs without an active tab", () => {
	const { open } = change(opened(), { type: "detail", pr: third, tab: "comments" });
	expect(JSON.parse(JSON.stringify(open))).toEqual([{ ...first, detailTab: "summary" }, { ...second, detailTab: "summary" }, { ...third, detailTab: "comments" }]);
	expect(decodePageTabs(JSON.stringify(open))).toEqual(open);
	expect(decodePageTabs(JSON.stringify({ open, active: "acme/app#1" }))).toEqual([]);
	expect(decodePageTabs("broken")).toEqual([]);
});
