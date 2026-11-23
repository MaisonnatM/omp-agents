import { describe, expect, test } from "bun:test";
import type { Channel, ChannelProject, Message, Thread } from "../../src/shared/board";
import { type Board, type BoardChannel, type BoardMessage, type BoardProject, type BoardThread, boardIn, briefText } from "./agent/extensions/project/brief";

type Fits<A, B> = [A] extends [B] ? true : false;

describe("the kit's copy of the board's shape", () => {
	test("reads only fields the dashboard's board has", () => {
		const fits: [Fits<ChannelProject, BoardProject>, Fits<Channel, BoardChannel>, Fits<Thread, BoardThread>, Fits<Message, BoardMessage>] = [true, true, true, true];
		expect(fits).toEqual([true, true, true, true]);
	});
});

const step = (id: string, title: string, done: boolean, createdAt: number, parent?: string): BoardThread => ({ id, channel: "c1", title, task: done ? "done" : "open", createdAt, ...(parent ? { parent } : {}) });

const board: Board = {
	channels: [
		{ id: "c1", name: "migration", project: { goal: "Move to Postgres", decisions: ["Use pgvector"], sessionIds: ["me"] } },
		{ id: "c2", name: "old", project: { goal: "", decisions: [], sessionIds: ["gone"], archivedAt: 1 } },
		{ id: "c3", name: "general" },
	],
	threads: [
		step("s2", "Backfill", false, 2),
		step("s1", "Schema", true, 1),
		step("s21", "Rows", true, 3, "s2"),
		{ id: "chat", channel: "c1", title: "Chat", task: null, createdAt: 4 },
		{ id: "t-session-me", channel: "c1", title: "Feed", task: null, createdAt: 5 },
	],
	messages: [
		...Array.from({ length: 12 }, (_, index): BoardMessage => ({ thread: "chat", author: index % 2 ? "me" : "other", at: Date.UTC(2026, 10, 1 + index), text: `line ${index}` })),
		{ thread: "t-session-me", author: "me", at: Date.UTC(2026, 10, 30), text: "feed noise" },
	],
};

describe("briefText", () => {
	test("builds the brief of the session's open project", () => {
		const brief = briefText(board, "me")!;
		expect(brief).toContain('project "migration"');
		expect(brief).toContain("Goal: Move to Postgres");
		expect(brief).toContain("Plan (2 of 3 done; a step numbered like 2.1 is a sub-step of step 2):\n1. [x] Schema\n2. [ ] Backfill\n   2.1. [x] Rows");
		expect(brief).toContain("Decisions:\n1. Use pgvector");
		expect(brief).toContain("(the last 10 of 12)");
		expect(brief).not.toContain("line 1\n");
		expect(brief).toContain("- 2026-11-12 this session: line 11");
		expect(brief).toContain("other: line 10");
		expect(brief).not.toContain("feed noise");
		expect(brief).toContain("board tool's done action");
	});

	test("gives none outside an open project or for a bad file", () => {
		expect(briefText(board, "gone")).toBeNull();
		expect(briefText(board, "nobody")).toBeNull();
		expect(briefText(boardIn(null), "me")).toBeNull();
	});
});
