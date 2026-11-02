import { describe, expect, test } from "bun:test";
import type { Notice } from "../src/shared/notices";
import type { RosterHost, UserRequest } from "../src/shared/sessions";
import { inboxItems, nextAfter } from "./inbox-model";

const host = (instanceId: string, status: RosterHost["status"], extra: Partial<RosterHost> = {}): RosterHost =>
	({ instanceId, sessionId: instanceId, sessionName: instanceId, cwd: "/w", cwdDisplay: "~/w", status, requests: [], unread: null, ...extra }) as RosterHost;
const ask: UserRequest = { id: "r1", title: "Which branch?", deadline: null, kind: "confirm", message: "" } as UserRequest;
const turn = (at: number) => ({ at, reply: "Done.", body: "Done.", suggestions: ["Merge on main"] });
const slack = (id: string, at: number): Notice => ({ id, at, seen: true, read: false, kind: "slack", from: "Ana", avatarUrl: null, text: "hi", permalink: "https://x", type: "dm", count: 1 });

describe("inboxItems", () => {
	test("groups questions, then finished turns oldest first, then notices; a session that asks hides its unread turn", () => {
		const items = inboxItems(
			[host("late", "idle", { unread: turn(20) }), host("asks", "needs-input", { requests: [ask], unread: turn(5) }), host("early", "idle", { unread: turn(10) }), host("works", "working")],
			[slack("s1", 1), { id: "u", at: 0, seen: true, read: false, kind: "omp", current: "1", latest: "2", status: { state: "available" } }],
		);
		expect(items.map(item => item.key)).toEqual(["ask/asks/r1", "turn/early/10", "turn/late/20", "notice/s1"]);
	});

	test("a wait with no relayed question still asks", () => {
		expect(inboxItems([host("q", "needs-input")], []).map(item => item.key)).toEqual(["ask/q/input"]);
	});
});

describe("nextAfter", () => {
	const items = inboxItems([host("a", "idle", { unread: turn(1) }), host("b", "idle", { unread: turn(2) })], []);
	test("keeps an item still listed, else takes the one now at its place, else the last", () => {
		expect(nextAfter(items, "turn/b/2", 0)?.key).toBe("turn/b/2");
		expect(nextAfter(items, "gone", 1)?.key).toBe("turn/b/2");
		expect(nextAfter(items, "gone", 5)?.key).toBe("turn/b/2");
		expect(nextAfter([], "gone", 0)).toBeNull();
	});
});
