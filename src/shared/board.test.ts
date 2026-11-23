import { describe, expect, test } from "bun:test";
import { applyBoardChange, type BoardChange, type BoardState, emptyBoard, parseBoardChange } from "./board";

const channel = { id: "c-dev", name: "dev", about: "" };
const thread = { id: "t-1", channel: "c-dev", title: "Fix login", task: null, lease: null, createdAt: 1 };

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
		const state = apply(emptyBoard("Maxence"), { op: "channel", channel }, { op: "thread", thread }, { op: "post", message: { id: "m-1", thread: "t-1", author: "u-maxence", at: 2, text: "hi" } });
		expect(state.channels.map(item => item.name)).toEqual(["general", "dev"]);
		expect(state.threads.map(item => item.title)).toEqual(["Fix login"]);
		expect(state.messages.map(item => item.text)).toEqual(["hi"]);
	});

	test("a second channel with a taken name is refused", () => {
		expect(applyBoardChange(emptyBoard("Maxence"), { op: "channel", channel: { ...channel, id: "c-other", name: "general" } })).toEqual({ error: "#general already exists." });
	});

	test("a thread in a channel that does not exist is refused", () => {
		expect(applyBoardChange(emptyBoard("Maxence"), { op: "thread", thread })).toEqual({ error: "No channel c-dev." });
	});
});
