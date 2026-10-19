import { describe, expect, test } from "bun:test";
import { UnreadTurns } from "./unread-turns";

const reply = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const ended = (text: string, isTerminal?: boolean) => ({ type: "agent_end", messages: [{ role: "user", content: "Fix it." }, reply(text)], ...(isTerminal === undefined ? {} : { isTerminal }) });

describe("UnreadTurns", () => {
	test("a turn that ends is unread with its reply's first line, without its suggested prompts", () => {
		const turns = new UnreadTurns(() => 1000);
		expect(turns.observe("i1", ended("\n  Fixed the **flaky** test.  \nDetails follow.\n\nSuggestions:\n1. Ship it"))).toBe(true);
		expect(turns.of("i1")).toEqual({ at: 1000, reply: "Fixed the **flaky** test." });
		expect(turns.of("i2")).toBeNull();
	});

	test("a turn that ends on no text is unread without a reply", () => {
		const turns = new UnreadTurns(() => 5);
		turns.observe("i1", { type: "agent_end", messages: [{ role: "assistant", content: [{ type: "toolCall", id: "c" }] }] });
		expect(turns.of("i1")).toEqual({ at: 5, reply: null });
	});

	test("an end that hands over to a queued follow-up, and other events, leave it as it was", () => {
		const turns = new UnreadTurns(() => 1);
		expect(turns.observe("i1", ended("Next.", false))).toBe(false);
		expect(turns.observe("i1", { type: "message_end", message: reply("Halfway.") })).toBe(false);
		expect(turns.observe("i1", "agent_end")).toBe(false);
		expect(turns.of("i1")).toBeNull();
	});

	test("the next turn's start, or a look at the session, reads it, once", () => {
		const turns = new UnreadTurns(() => 1);
		turns.observe("i1", ended("Done."));
		expect(turns.observe("i1", { type: "agent_start" })).toBe(true);
		expect(turns.of("i1")).toBeNull();
		expect(turns.observe("i1", { type: "agent_start" })).toBe(false);

		turns.observe("i1", ended("Done again."));
		expect(turns.clear("i1")).toBe(true);
		expect(turns.clear("i1")).toBe(false);
		expect(turns.of("i1")).toBeNull();
	});
});
