import { describe, expect, test } from "bun:test";
import { MAX_DISCUSSION_QUOTE, MAX_DISCUSSION_SOURCE } from "../src/shared/discussions";
import { type AskedTurn, conclusion, type Discussion, discussionRequest, quoteOf, withEvent } from "./discussions";

const turn = (id: number, status: AskedTurn["status"], answer: string): AskedTurn => ({ id, question: `Question ${id}`, answer, model: "anthropic/claude-haiku-4-5", status, error: null });
const discussion = (turns: AskedTurn[]): Discussion => ({ source: "session “Fix login”", quote: "ttl: 0", sendToSession: null, opened: 0, turns });

describe("quoteOf", () => {
	test("trims the selection and cuts it to the longest passage the server takes", () => {
		expect(quoteOf("  ttl: 0\n")).toBe("ttl: 0");
		expect(quoteOf("x".repeat(MAX_DISCUSSION_QUOTE + 5)).length).toBe(MAX_DISCUSSION_QUOTE);
	});
});

describe("discussionRequest", () => {
	test("carries back only the answers the model finished", () => {
		const open = discussion([turn(0, "done", "Cached for zero seconds."), turn(1, "stopped", "Half an"), turn(2, "failed", ""), turn(3, "done", "  ")]);
		expect(discussionRequest(open, "  Is that a bug?\n")).toEqual({
			source: "session “Fix login”",
			quote: "ttl: 0",
			turns: [{ question: "Question 0", answer: "Cached for zero seconds." }],
			question: "Is that a bug?",
		});
	});

	test("cuts a long source to what the server takes", () => {
		const long = { ...discussion([]), source: `pull request acme/api#7 “Cache”, file ${"a/".repeat(400)}` };
		expect(discussionRequest(long, "Why?").source.length).toBe(MAX_DISCUSSION_SOURCE);
	});
});

describe("withEvent", () => {
	test("fills the asked turn in as its events arrive", () => {
		const events = [
			{ kind: "model", model: "openai/gpt-5-mini" },
			{ kind: "text", text: "Nothing " },
			{ kind: "text", text: "is cached." },
			{ kind: "end", error: null },
		] as const;
		const answered = events.reduce((open, event) => withEvent(open, 4, event), discussion([{ ...turn(4, "streaming", ""), model: null }]));
		expect(answered.turns).toEqual([{ id: 4, question: "Question 4", answer: "Nothing is cached.", model: "openai/gpt-5-mini", status: "done", error: null }]);
		expect(conclusion(answered)?.answer).toBe("Nothing is cached.");
	});

	test("an end with an error fails the turn", () => {
		const failed = withEvent(discussion([turn(1, "streaming", "")]), 1, { kind: "end", error: "omp has no key for openai/gpt-5-mini." });
		expect(failed.turns[0]).toMatchObject({ status: "failed", error: "omp has no key for openai/gpt-5-mini." });
		expect(conclusion(failed)).toBeNull();
	});

	test("a stopped turn keeps what it had, and a question it no longer holds changes nothing", () => {
		const stopped = discussion([turn(2, "stopped", "Half an")]);
		expect(withEvent(stopped, 2, { kind: "text", text: "swer" })).toBe(stopped);
		expect(withEvent(stopped, 9, { kind: "end", error: null })).toBe(stopped);
	});
});
