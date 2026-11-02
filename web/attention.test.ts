import { describe, expect, test } from "bun:test";
import type { HostStatus, RosterHost, UnreadTurn, UserRequest } from "../src/shared/sessions";
import { type Attention, attend, needsYou, shownViews, unreadShown, waitOf } from "./attention";

const host = (instanceId: string, status: HostStatus, { unread = null, requests = [], sessionName = `Session ${instanceId}` }: { unread?: UnreadTurn | null; requests?: UserRequest[]; sessionName?: string | null } = {}) =>
	({ instanceId, sessionId: `s-${instanceId}`, sessionName, cwdDisplay: "~/code/webapp", status, unread, requests }) as RosterHost;
const ask = (id: string, title: string): UserRequest => ({ id, title, deadline: null, kind: "select", options: [], checked: [] });

describe("needsYou", () => {
	test("counts a session that asks or ended a turn unseen, not one that works or idles after you read it", () => {
		const hosts = [
			host("asks", "needs-input", { requests: [ask("r1", "Which branch?")] }),
			host("done", "idle", { unread: { at: 1, reply: "Done.", body: "Done.", suggestions: [] } }),
			host("read", "idle"),
			host("works", "working"),
			host("unknown", "unknown"),
		];
		expect(hosts.filter(needsYou).map(row => row.instanceId)).toEqual(["asks", "done"]);
	});
});

describe("waitOf", () => {
	test("takes the oldest question over a bare wait or an unread turn, and the bare wait over the turn", () => {
		const unread = { at: 1, reply: "Done.", body: "Done.", suggestions: [] };
		const first = ask("r1", "Which branch?");
		expect(waitOf(host("a", "needs-input", { requests: [first, ask("r2", "Merge it?")], unread }))).toEqual({ kind: "ask", request: first });
		expect(waitOf(host("b", "needs-input", { unread }))).toEqual({ kind: "input" });
		expect(waitOf(host("c", "idle", { unread }))).toEqual({ kind: "turn", turn: unread });
		expect(waitOf(host("d", "working"))).toBeNull();
	});
});

describe("attend", () => {
	const raisedOver = (pushes: RosterHost[][]): string[] => {
		let attention: Attention = new Map();
		const raised: string[] = [];
		for (const hosts of pushes) {
			const next = attend(attention, hosts);
			raised.push(...next.raise.map(({ alert }) => alert.body));
			attention = next.attention;
		}
		return raised;
	};
	const idle = [host("q", "idle")];
	const working = [host("q", "working")];
	const placeholder = [host("q", "needs-input")];
	const asks = (id = "r1", title = "Which branch?") => [host("q", "needs-input", { requests: [ask(id, title)] })];
	const turn = (at: number) => [host("q", "idle", { unread: { at, reply: `Turn ${at}.`, body: `Turn ${at}.`, suggestions: [] } })];

	test("raises one alert per session, titled by the session and opening it: its oldest question over an unread turn", () => {
		const confirm: UserRequest = { id: "r2", title: "Delete the branch?", deadline: null, kind: "confirm", message: "feat/x has unpushed work." };
		const seen = attend(new Map(), [host("a", "idle"), host("b", "idle"), host("c", "idle")]).attention;
		const { raise } = attend(seen, [
			host("a", "needs-input", { requests: [ask("r1", "Which branch?"), confirm], unread: { at: 7, reply: "Merged.", body: "Merged.", suggestions: [] } }),
			host("b", "needs-input", { requests: [confirm] }),
			host("c", "idle", { sessionName: null, unread: { at: 3, reply: null, body: null, suggestions: [] } }),
		]);
		expect(raise).toEqual([
			{ alert: { hash: "#session/s-a", title: "Session a", body: "Which branch?" }, turn: false },
			{ alert: { hash: "#session/s-b", title: "Session b", body: "Delete the branch?\nfeat/x has unpushed work." }, turn: false },
			{ alert: { hash: "#session/s-c", title: "webapp", body: "Finished its turn." }, turn: true },
		]);
	});

	test("raises nothing for a session that already waited the first time the page sees it", () => {
		expect(raisedOver([asks(), asks()])).toEqual([]);
		expect(raisedOver([[], turn(1), turn(1)])).toEqual([]);
	});

	test("hears the question a terminal session replays after its welcome as the wait it showed when it joined", () => {
		expect(raisedOver([[], placeholder, asks()])).toEqual([]);
		expect(raisedOver([idle, placeholder, asks()])).toEqual(["Waits for your input."]);
	});

	test("raises a question once though a reconnect drops it for a push and replays it", () => {
		expect(raisedOver([idle, asks(), placeholder, asks(), idle, asks()])).toEqual(["Which branch?"]);
	});

	test("raises each new question and turn after the page saw the session not need you", () => {
		expect(raisedOver([idle, asks(), working, asks("r2", "Merge it?"), working, turn(1), turn(1), working, turn(2)])).toEqual(["Which branch?", "Merge it?", "Turn 1.", "Turn 2."]);
		expect(raisedOver([idle, asks(), asks("r2", "Merge it?")])).toEqual(["Which branch?", "Merge it?"]);
	});

	test("raises each wait with no question that starts after the session stopped needing you", () => {
		expect(raisedOver([idle, placeholder, placeholder, working, placeholder])).toEqual(["Waits for your input.", "Waits for your input."]);
	});

	test("forgets a session that leaves the roster, so it returns as one the page sees for the first time", () => {
		expect(raisedOver([idle, [], asks()])).toEqual([]);
	});
});

describe("unreadShown", () => {
	test("reads only the unread sessions a pane shows as the session itself, not as one of its subagents", () => {
		const hosts = [host("a", "idle", { unread: { at: 1, reply: null, body: null, suggestions: [] } }), host("b", "idle", { unread: { at: 1, reply: null, body: null, suggestions: [] } }), host("c", "idle")];
		const shown = [
			{ kind: "live", instanceId: "a", agentId: null },
			{ kind: "live", instanceId: "b", agentId: "explore-1" },
			{ kind: "live", instanceId: "c", agentId: null },
			{ kind: "past", sessionId: "s-old" },
		] as const;
		expect(unreadShown(hosts, [...shown])).toEqual(["a"]);
	});
});

describe("shownViews", () => {
	const a = { kind: "live", instanceId: "a", agentId: null } as const;
	const b = { kind: "live", instanceId: "b", agentId: null } as const;
	const layout = { panes: [a, b], focus: 1, maximized: false };

	test("shows every pane, or only the focused one while it is maximized", () => {
		expect(shownViews({ cover: null, layout }, null)).toEqual([a, b]);
		expect(shownViews({ cover: null, layout: { ...layout, maximized: true } }, null)).toEqual([b]);
	});

	test("shows no pane under a page or a session link, which opens another session over them, but a Bot's page shows its conversation", () => {
		expect(shownViews({ cover: { kind: "page", page: { kind: "inbox", open: null } }, layout }, null)).toEqual([]);
		expect(shownViews({ cover: { kind: "session", sessionId: "s-c" }, layout }, null)).toEqual([]);
		expect(shownViews({ cover: { kind: "page", page: { kind: "bots", target: "bot", routine: null } }, layout }, a)).toEqual([a]);
	});
});
