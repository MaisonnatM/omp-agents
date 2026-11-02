import { describe, expect, test } from "bun:test";
import type { Notice } from "../src/shared/notices";
import type { RosterHost, UserRequest } from "../src/shared/sessions";
import { type InboxSection, inboxSections, itemCount, nextAfter, sectionsIn } from "./inbox-model";

const host = (instanceId: string, status: RosterHost["status"], extra: Partial<RosterHost> = {}): RosterHost =>
	({ instanceId, sessionId: instanceId, sessionName: instanceId, cwd: "/w", cwdDisplay: "~/w", status, requests: [], unread: null, ...extra }) as RosterHost;
const ask: UserRequest = { id: "r1", title: "Which branch?", deadline: null, kind: "confirm", message: "" } as UserRequest;
const turn = (at: number, suggestions = ["Merge on main"]) => ({ at, reply: "Done.", body: "Done.", suggestions });
const slack = (id: string, at: number): Notice => ({ id, at, seen: true, read: false, kind: "slack", from: "Ana", avatarUrl: null, text: "hi", permalink: "https://x", type: "dm", count: 1 });
const keys = (sections: InboxSection[]) => sections.map(({ group, items }) => [group, items.map(item => item.key)]);

describe("inboxSections", () => {
	test("groups questions, then finished turns oldest first, then notices; a session that asks hides its unread turn", () => {
		const sections = inboxSections(
			[host("late", "idle", { unread: turn(20) }), host("asks", "needs-input", { requests: [ask], unread: turn(5) }), host("early", "idle", { unread: turn(10) }), host("works", "working")],
			[slack("s1", 1), { id: "u", at: 0, seen: true, read: false, kind: "omp", current: "1", latest: "2", status: { state: "available" } }],
			0,
		);
		expect(keys(sections)).toEqual([
			["Agents asking", ["ask/asks/r1"]],
			["Agents finished", ["turn/early/10", "turn/late/20"]],
			["Messages", ["notice/s1"]],
		]);
		expect(itemCount(sections)).toBe(4);
		expect(keys(sectionsIn(sections, "agents"))).toEqual([
			["Agents asking", ["ask/asks/r1"]],
			["Agents finished", ["turn/early/10", "turn/late/20"]],
		]);
	});

	test("a wait with no relayed question still asks", () => {
		expect(keys(inboxSections([host("q", "needs-input")], [], 0))).toEqual([["Agents asking", ["ask/q/input"]]]);
	});

	test("questions keep the sidebar's order: pinned sessions first, then the roster's", () => {
		const asking = ["a", "b", "c"].map(id => host(id, "needs-input", { requests: [ask] }));
		expect(keys(inboxSections(asking, [], 0, new Set(["c"])))).toEqual([["Agents asking", ["ask/c/r1", "ask/a/r1", "ask/b/r1"]]]);
	});

	test("each item says its title, place, and line: a question's title, a turn's first suggestion or reply, a notice's headline", () => {
		const [asking, finished, messages] = inboxSections([host("a", "needs-input", { requests: [ask] }), host("b", "idle", { unread: turn(1) }), host("c", "idle", { unread: turn(2, []) })], [slack("s1", 1)], 0);
		const text = (section: InboxSection | undefined) => section?.items.map(({ title, place, line }) => ({ title, place, line }));
		expect(text(asking)).toEqual([{ title: "a", place: "w", line: "Which branch?" }]);
		expect(text(finished)).toEqual([
			{ title: "b", place: "w", line: "↳ Merge on main" },
			{ title: "c", place: "w", line: "Done." },
		]);
		expect(text(messages)).toEqual([{ title: "Ana sent you a message", place: "Slack", line: "hi" }]);
	});
});

describe("nextAfter", () => {
	const items = inboxSections([host("a", "idle", { unread: turn(1) }), host("b", "idle", { unread: turn(2) })], [], 0).flatMap(({ items }) => items);
	test("keeps an item still listed, else takes the one now at its place, else the last", () => {
		expect(nextAfter(items, "turn/b/2", 0)?.key).toBe("turn/b/2");
		expect(nextAfter(items, "gone", 1)?.key).toBe("turn/b/2");
		expect(nextAfter(items, "gone", 5)?.key).toBe("turn/b/2");
		expect(nextAfter([], "gone", 0)).toBeNull();
	});
});
