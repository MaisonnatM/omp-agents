import { describe, expect, test } from "bun:test";
import { applyBoardChange, type BoardChange, type BoardState, emptyBoard, isMention, mentions, parseBoardChange, parseCommand } from "./board";

const channel = { id: "c-dev", name: "dev", about: "", sync: null, restricted: false };
const thread = { id: "t-1", channel: "c-dev", title: "Fix login", task: null, lease: null, labels: [], blockedBy: [], createdAt: 1 };

function apply(state: BoardState, ...changes: BoardChange[]): BoardState {
	return changes.reduce((acc, change) => {
		const parsed = parseBoardChange(JSON.parse(JSON.stringify(change)));
		if (!parsed) throw new Error(`refused to parse ${change.op}`);
		const applied = applyBoardChange(acc, parsed);
		if ("error" in applied) throw new Error(applied.error);
		return applied.ok;
	}, state);
}

describe("creating on an empty board", () => {
	test("a new channel takes a new thread, which takes a post", () => {
		const state = apply(emptyBoard(), { op: "channel", channel }, { op: "thread", thread }, { op: "post", message: { id: "m-1", thread: "t-1", author: "u-maxence", at: 2, text: "hi" } });
		expect(state.channels.map(item => item.name)).toEqual(["general", "dev"]);
		expect(state.threads.map(item => item.title)).toEqual(["Fix login"]);
		expect(state.messages.map(item => item.text)).toEqual(["hi"]);
	});

	test("a second channel with a taken name is refused", () => {
		expect(applyBoardChange(emptyBoard(), { op: "channel", channel: { ...channel, id: "c-other", name: "general" } })).toEqual({ error: "#general already exists." });
	});

	test("a thread in a channel that does not exist is refused", () => {
		expect(applyBoardChange(emptyBoard(), { op: "thread", thread })).toEqual({ error: "No channel c-dev." });
	});
});

describe("the mention and command grammar", () => {
	const member = (id: string, name: string) => ({ ...emptyBoard().extraMembers[0]!, id, name });
	const max = member("u-max", "Max");
	const power = member("s-1", "Max Power");

	test("a mention ends at a space, punctuation, or the end, in any case", () => {
		expect(isMention("thanks @max, done", max)).toBe(true);
		expect(isMention("@Maxence look", max)).toBe(false);
		expect(isMention("mail@Max", max)).toBe(false);
	});

	test("the longest name wins, and each mention keeps where it sits", () => {
		expect(mentions("ask @Max Power and @max.", [max, power]).map(({ member, start, end }) => [member.id, start, end])).toEqual([
			["s-1", 4, 14],
			["u-max", 19, 23],
		]);
	});

	test("a command is a known name at the start, before a space or the end", () => {
		expect(parseCommand("/schedule @Max in 10m")).toMatchObject({ command: { name: "schedule" }, arg: "@Max in 10m" });
		expect(parseCommand("/done")).toMatchObject({ command: { name: "done" }, arg: "" });
		expect(parseCommand("/review: now")).toBeNull();
		expect(parseCommand("/nope")).toBeNull();
		expect(parseCommand("see /review")).toBeNull();
	});
});
