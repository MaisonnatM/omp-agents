import { describe, expect, test } from "bun:test";
import { emptyBoard, isMention, mentions, parseCommand } from "./board";

describe("the mention and command grammar", () => {
	const member = (id: string, name: string) => ({ ...emptyBoard("Maxence").extraMembers[0]!, id, name });
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
