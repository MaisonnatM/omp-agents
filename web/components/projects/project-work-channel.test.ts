import { expect, test } from "bun:test";
import type { BoardState } from "../../../src/shared/board";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { channelMessages, projectWork } from "./project-work";

test("a project's sessions list the running ones first; an unknown one keeps its place after them", () => {
	const live = { sessionId: "live", sessionName: "live host", cwdDisplay: "~/app", pullRequests: [], issues: ["A-1"] } as unknown as RosterHost;
	const saved = { sessionId: "saved", title: "saved copy", cwdDisplay: "~/app", pullRequests: [], issues: ["A-1", "A-2"] } as unknown as PastSession;
	const work = projectWork({ sessionIds: ["saved", "live", "gone"] }, { hosts: [live], past: [saved] });
	expect(work.sessions.map(session => [session.id, session.host !== null])).toEqual([["live", true], ["saved", false], ["gone", false]]);
	expect(work.running).toBe(1);
	expect(work.issues).toBe(2);
});

test("a project's log is its channel's messages, oldest first", () => {
	const board = {
		threads: [{ id: "t1", channel: "c" }, { id: "t2", channel: "other" }, { id: "t3", channel: "c" }],
		messages: [{ id: "m1", thread: "t3", at: 3 }, { id: "m2", thread: "t2", at: 1 }, { id: "m3", thread: "t1", at: 2 }],
	} as unknown as BoardState;
	expect(channelMessages(board, "c").map(message => message.id)).toEqual(["m3", "m1"]);
});
