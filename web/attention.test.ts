import { describe, expect, test } from "bun:test";
import type { Project } from "../src/shared/projects";
import type { HostStatus, RosterHost, UnreadTurn, UserRequest } from "../src/shared/sessions";
import { alertsOf, freshAlerts, needsYou, unreadShown, yourSessions } from "./attention";

const host = (instanceId: string, status: HostStatus, { unread = null, requests = [], sessionName = `Session ${instanceId}` }: { unread?: UnreadTurn | null; requests?: UserRequest[]; sessionName?: string | null } = {}) =>
	({ instanceId, sessionId: `s-${instanceId}`, sessionName, cwdDisplay: "~/code/webapp", status, unread, requests }) as RosterHost;
const ask = (id: string, title: string): UserRequest => ({ id, title, deadline: null, kind: "select", options: [], checked: [] });

describe("needsYou", () => {
	test("counts a session that asks or ended a turn unseen, not one that works or idles after you read it", () => {
		const hosts = [
			host("asks", "needs-input", { requests: [ask("r1", "Which branch?")] }),
			host("done", "idle", { unread: { at: 1, reply: "Done." } }),
			host("read", "idle"),
			host("works", "working"),
			host("unknown", "unknown"),
		];
		expect(hosts.filter(needsYou).map(row => row.instanceId)).toEqual(["asks", "done"]);
	});
});

describe("yourSessions", () => {
	test("leaves out a project's workers, which answer to its coordinator, and keeps the coordinator", () => {
		const projects = [{ coordinator: { sessionId: "s-coordinator" }, workers: [{ sessionId: "s-worker" }] }] as Project[];
		expect(yourSessions([host("coordinator", "idle"), host("worker", "idle"), host("mine", "idle")], projects).map(row => row.instanceId)).toEqual(["coordinator", "mine"]);
	});
});

describe("alertsOf", () => {
	test("raises one alert per open question and per unread turn, titled by the session", () => {
		const confirm: UserRequest = { id: "r2", title: "Delete the branch?", deadline: null, kind: "confirm", message: "feat/x has unpushed work." };
		expect(alertsOf([host("a", "needs-input", { requests: [ask("r1", "Which branch?"), confirm], unread: { at: 7, reply: "Merged." } })])).toEqual([
			{ key: "a/ask/r1", sessionId: "s-a", title: "Session a", body: "Which branch?" },
			{ key: "a/ask/r2", sessionId: "s-a", title: "Session a", body: "Delete the branch?\nfeat/x has unpushed work." },
			{ key: "a/turn/7", sessionId: "s-a", title: "Session a", body: "Merged." },
		]);
	});

	test("names a session without a title by its folder, a turn without a reply, and a wait Collab does not relay", () => {
		expect(alertsOf([host("b", "idle", { sessionName: null, unread: { at: 3, reply: null } }), host("c", "needs-input", { sessionName: null })])).toEqual([
			{ key: "b/turn/3", sessionId: "s-b", title: "webapp", body: "Finished its turn." },
			{ key: "c/input", sessionId: "s-c", title: "webapp", body: "Waits for your input." },
		]);
	});
});

describe("freshAlerts", () => {
	const turn = (at: number) => alertsOf([host("a", "idle", { unread: { at, reply: "Done." } })]);

	test("raises nothing for what already waited when the page loads", () => {
		const first = freshAlerts(null, turn(1));
		expect(first.fresh).toEqual([]);
		expect([...first.heard]).toEqual(["a/turn/1"]);
	});

	test("raises each moment once across roster pushes, and the next turn of the same session again", () => {
		let heard = freshAlerts(null, []).heard;
		const raised: string[] = [];
		for (const now of [turn(1), turn(1), [], turn(2), turn(2)]) {
			const next = freshAlerts(heard, now);
			raised.push(...next.fresh.map(alert => alert.key));
			heard = next.heard;
		}
		expect(raised).toEqual(["a/turn/1", "a/turn/2"]);
	});
});

describe("unreadShown", () => {
	test("reads only the unread sessions a pane shows as the session itself, not as one of its subagents", () => {
		const hosts = [host("a", "idle", { unread: { at: 1, reply: null } }), host("b", "idle", { unread: { at: 1, reply: null } }), host("c", "idle")];
		const shown = [
			{ kind: "live", instanceId: "a", agentId: null },
			{ kind: "live", instanceId: "b", agentId: "explore-1" },
			{ kind: "live", instanceId: "c", agentId: null },
			{ kind: "past", sessionId: "s-old" },
		] as const;
		expect(unreadShown(hosts, [...shown])).toEqual(["a"]);
	});
});
