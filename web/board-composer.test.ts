import { expect, test } from "bun:test";
import type { Member } from "../src/shared/board";
import { boardMenu, boardTokens, boardTrigger } from "./board-composer";
import type { Tokenize } from "./prompt-tokens";

const member = (id: string, name: string): Member => ({ id, name, kind: "agent", presence: "idle", look: { shape: "circle", hue: 25 } });
const members = [member("u-max", "Max"), member("s-1", "Max Power"), member("s-2", "api2")];
const chips = (text: string, options?: Parameters<Tokenize>[1]) => boardTokens(members)(text, options).map(({ kind, label, target }) => ({ kind, label, target }));

test("a mention before punctuation is still a chip, and the longest name wins", () => {
	expect(chips("thanks @max, and @Max Power.")).toEqual([
		{ kind: "person", label: "@max", target: "u-max" },
		{ kind: "person", label: "@Max Power", target: "s-1" },
	]);
	expect(chips("@Maxence and mail@Max")).toEqual([]);
});

test("a command is a chip only where the message starts, and not while the caret ends it", () => {
	expect(chips("/review @api2")).toEqual([
		{ kind: "command", label: "review", target: "review" },
		{ kind: "person", label: "@api2", target: "s-2" },
	]);
	expect(chips("go /review")).toEqual([]);
	expect(chips("/rev", { open: 4 })).toEqual([]);
});

test("@ typed mid-sentence opens the member list at the caret and inserts there", () => {
	const text = "hi @ap and more";
	const trigger = boardTrigger(text, 6);
	expect(trigger).toEqual({ kind: "@", start: 3, end: 6, query: "ap" });
	const [option] = boardMenu(text, trigger!, members);
	expect(option?.edit).toEqual({ text: "hi @api2 and more", cursor: 9 });
});

test("/ opens the command list only at the start of the message", () => {
	expect(boardTrigger("/re", 3)).toEqual({ kind: "/", start: 0, end: 3, query: "re" });
	expect(boardTrigger("go /re", 6)).toBeNull();
	expect(boardMenu("/re", boardTrigger("/re", 3)!, members).map(option => option.label)).toEqual(["/review"]);
});
