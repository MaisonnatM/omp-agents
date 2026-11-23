import { describe, expect, test } from "bun:test";
import { applyBoardChange, type BoardChange, type BoardState, emptyBoard } from "../shared/board";
import type { Bot, BotId } from "../shared/bots";
import type { RosterHost } from "../shared/sessions";
import { BoardFeed, sessionThreadId } from "./board-feed";

const host = (sessionId: string, over: Partial<RosterHost> = {}): RosterHost =>
	({ sessionId, sessionName: "fix login", cwdDisplay: "~/code/webapp", model: null, requests: [], status: "idle", unread: null, ...over }) as unknown as RosterHost;
const asking = (sessionId: string) => host(sessionId, { status: "needs-input", requests: [{ id: "r1", title: "Which branch?", deadline: null, kind: "confirm", message: "" }] as RosterHost["requests"] });

function feedWith(bots: Bot[] = []) {
	let state: BoardState = emptyBoard();
	let hosts: RosterHost[] = [];
	const apply = (change: BoardChange) => {
		const applied = applyBoardChange(state, change);
		if ("error" in applied) throw new Error(applied.error);
		state = applied.ok;
	};
	const feed = new BoardFeed({ state: () => state, hosts: () => hosts, bots: () => bots, apply, active: () => true, now: () => 5 });
	const see = (next: RosterHost[]) => {
		hosts = next;
		feed.check();
	};
	const texts = () => state.messages.map(msg => msg.text);
	return { see, texts, state: () => state };
}

describe("BoardFeed", () => {
	test("a question and a finished turn post in the session's thread, mentioning the user", () => {
		const { see, texts, state } = feedWith();
		see([host("s1", { status: "working" })]);
		see([asking("s1")]);
		see([host("s1", { status: "working" })]);
		see([host("s1", { unread: { at: 4, reply: "Fixed the login redirect." } as RosterHost["unread"] })]);
		expect(texts()).toEqual(["@Maxence waits on you: Which branch?", "@Maxence finished: Fixed the login redirect."]);
		expect(state().messages.every(msg => msg.thread === sessionThreadId("s1") && msg.author === "s-s1")).toBe(true);
		expect(state().channels.map(channel => channel.name)).toContain("sessions");
	});

	test("a turn the user already saw, a quiet turn, or a session first seen idle posts nothing", () => {
		const { see, texts } = feedWith();
		see([host("s1")]);
		see([host("s1", { status: "working" })]);
		see([host("s1")]);
		expect(texts()).toEqual([]);
	});

	test("a restart that sees the same question again does not post it twice", () => {
		const first = feedWith();
		first.see([asking("s1")]);
		const again = new BoardFeed({ state: first.state, hosts: () => [asking("s1")], bots: () => [], apply: () => expect.unreachable(), active: () => true, now: () => 6 });
		again.check();
		expect(first.texts()).toHaveLength(1);
	});

	test("a Bot's conversation posts nothing", () => {
		const bot = { id: "scout" as BotId, sessionId: "s1" } as Bot;
		const { see, texts } = feedWith([bot]);
		see([asking("s1")]);
		expect(texts()).toEqual([]);
	});
});
