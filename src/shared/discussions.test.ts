import { describe, expect, test } from "bun:test";
import { discussionPrompt, sessionMessage } from "./discussions";

describe("discussionPrompt", () => {
	test("a first question sends the passage, its source, and the question", () => {
		expect(discussionPrompt({ source: "session “Fix login”", quote: "const ttl = 0;", turns: [], question: "Why zero?" })).toBe(
			"The user selected this passage from session “Fix login”:\n\n<passage>\nconst ttl = 0;\n</passage>\n\nQuestion: Why zero?",
		);
	});

	test("a follow-up carries the earlier questions and answers before the new question", () => {
		const prompt = discussionPrompt({
			source: "pull request acme/api#7 “Cache tokens”, file src/cache.ts",
			quote: "ttl: 0",
			turns: [
				{ question: "What does ttl do?", answer: "It sets how long a token stays cached." },
				{ question: "And zero?", answer: "Nothing is cached." },
			],
			question: "Is that a bug?",
		});
		expect(prompt).toBe(
			"The user selected this passage from pull request acme/api#7 “Cache tokens”, file src/cache.ts:\n\n" +
				"<passage>\nttl: 0\n</passage>\n\n" +
				"Earlier in this discussion:\n\n" +
				"Question: What does ttl do?\n\nAnswer: It sets how long a token stays cached.\n\n" +
				"Question: And zero?\n\nAnswer: Nothing is cached.\n\n" +
				"Question: Is that a bug?",
		);
	});
});

describe("sessionMessage", () => {
	test("quotes every line of the passage, blank ones too, then the conclusion", () => {
		expect(sessionMessage("\nfirst line\n\nsecond line\n", "  Rename it to `ttlMs`.\n")).toBe(
			"About this passage:\n\n> first line\n>\n> second line\n\nA side discussion concluded:\n\nRename it to `ttlMs`.",
		);
	});
});
