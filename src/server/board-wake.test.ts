import { describe, expect, test } from "bun:test";
import { applyBoardChange, type BoardChange, type BoardState, boardMembers, botMemberId, emptyBoard, inBotsName, type Message } from "../shared/board";
import type { Bot, BotId } from "../shared/bots";
import type { RosterHost } from "../shared/sessions";
import { BoardWake } from "./board-wake";

const scout = "scout" as BotId;
const bot = (sessionId: string | null): Bot => ({ id: scout, kind: "routines", name: "Scout", job: "", cwd: "~/code/webapp", model: null, skill: null, shape: "clover", hue: 320, sessionId, createdAt: "2026-10-05T09:00:00.000Z", pinned: false, section: null });
const host = (sessionId: string): RosterHost => ({ sessionId, sessionName: "scout chat", cwdDisplay: "~/code/webapp", model: null, requests: [], status: "idle" }) as unknown as RosterHost;
const message = (id: string, author: string, text: string): Message => ({ id, thread: "t-grill", author, at: 1, text });

function wakeWith(bots: Bot[], hosts: RosterHost[] = []) {
	let state: BoardState = { ...emptyBoard("Maxence"), threads: [{ id: "t-grill", channel: "c-general", title: "Wake rule", task: null, lease: null, createdAt: 0 }] };
	const woken: { bot: BotId | null; session: string | null; text: string }[] = [];
	const apply = (change: BoardChange) => {
		const applied = applyBoardChange(state, change);
		if ("error" in applied) throw new Error(applied.error);
		state = applied.ok;
	};
	const wake = new BoardWake({
		state: () => state,
		hosts: () => hosts,
		bots: () => bots,
		apply,
		wake: async (session, text) => void woken.push({ bot: null, session, text }),
		wakeBot: async (id, text) => void woken.push({ bot: id, session: null, text }),
		startSession: async () => "started",
		workspaces: () => [],
		active: () => true,
		now: () => 1,
	});
	const post = (msg: Message) => {
		apply({ op: "post", message: msg });
		wake.check();
	};
	return { post, woken, state: () => state };
}

describe("BoardWake and Bots", () => {
	test("a message that mentions a Bot wakes it through its conversation, even before it has one", () => {
		const { post, woken, state } = wakeWith([bot(null)]);
		post(message("new-1", "u-maxence", "@Scout can you look at this?"));
		expect(woken).toEqual([{ bot: scout, session: null, text: expect.stringContaining("@Scout can you look at this?") }]);
		expect(state().extraMembers.some(member => member.id === botMemberId(scout))).toBe(true);
	});

	test("a Bot's own message does not wake it", () => {
		const { post, woken } = wakeWith([bot("s-1")]);
		post(message("new-1", botMemberId(scout), "I am @Scout, and I am done."));
		expect(woken).toEqual([]);
	});

	test("a person replying in a thread the Bot posted in wakes it", () => {
		const { post, woken } = wakeWith([bot("s-1")]);
		post(message("new-1", botMemberId(scout), "Looking into it."));
		post(message("new-2", "u-maxence", "Thanks, any news?"));
		expect(woken.map(item => item.bot)).toEqual([scout]);
	});

	test("a Bot's live conversation is listed once, as the Bot", () => {
		const members = boardMembers(emptyBoard("Maxence"), [host("s-1"), host("s-2")], [bot("s-1")]);
		expect(members.filter(member => member.sessionId === "s-1").map(member => member.id)).toEqual([botMemberId(scout)]);
		expect(members.find(member => member.id === botMemberId(scout))?.presence).toBe("idle");
		expect(members.some(member => member.id === "s-s-2")).toBe(true);
	});

	test("what a Bot's conversation posts with the board tool is in the Bot's name", () => {
		const change = inBotsName({ op: "post", message: message("m1", "s-s-1", "Done.") }, [bot("s-1")]);
		expect(change.op === "post" && change.message.author).toBe(botMemberId(scout));
	});
});
