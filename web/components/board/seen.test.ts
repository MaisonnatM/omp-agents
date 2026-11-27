import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, test } from "bun:test";
import type { RosterHost } from "../../../src/shared/sessions";
import type { BoardReply, BoardState, BoardTask } from "../../../templates/omp/agent/extensions/board/log";
import { waitingIn } from "./seen";

const reply = (kind: "user" | "session"): BoardReply => fromPartial<BoardReply>({ by: kind === "user" ? { kind } : { kind, sessionId: "s1" }, at: 1, text: "…" });
const thread = (id: number, workspace: string, replies: BoardReply[]) => fromPartial<BoardTask>({ id, workspace, replies });
const host = (instanceId: string, cwd: string, status: RosterHost["status"]) =>
	fromPartial<RosterHost>({ instanceId, cwd, workspace: null, status, unread: null, requests: [], agents: [], turnWaits: false, scheduledCheck: null });

describe("what waits on you in a Workspace", () => {
	const board = fromPartial<BoardState>({
		tasks: [
			thread(1, "/a", [reply("user"), reply("session"), reply("session")]),
			thread(2, "/a", [reply("session")]),
			thread(3, "/a", [reply("user")]),
			thread(4, "/b", [reply("session")]),
		],
	});
	const hosts = [host("h1", "/a", "needs-input"), host("h2", "/a", "working"), host("h3", "/b", "needs-input")];

	test("counts its sessions that need you and its threads with replies you have not read, one per thread", () => {
		expect(waitingIn(board, {}, hosts, "/a")).toBe(3);
	});

	test("leaves out a thread whose replies you have read, and your own replies", () => {
		expect(waitingIn(board, { 1: 3 }, hosts, "/a")).toBe(2);
		expect(waitingIn(board, { 1: 2 }, hosts, "/a")).toBe(3);
	});

	test("counts every Workspace for none, and only sessions before the Board loads", () => {
		expect(waitingIn(board, {}, hosts, null)).toBe(5);
		expect(waitingIn(null, {}, hosts, "/b")).toBe(1);
	});
});
