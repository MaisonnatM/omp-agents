import { describe, expect, test } from "bun:test";
import { mergeSessionLinks, sessionLinksBlock } from "./session-links";

const ORIGIN = "http://127.0.0.1:4317";
const block = sessionLinksBlock(ORIGIN, [
	{ sessionId: "01a0f6a5-181e-4c2b", link: "submitted" },
	{ sessionId: "7c51f77b-2a1b", link: "worked" },
]);
const SUMMARY = "<!-- CURSOR_SUMMARY -->\n> [!NOTE]\n> Adds a thing.\n<!-- /CURSOR_SUMMARY -->";

describe("sessionLinksBlock", () => {
	test("links each session by id under the dashboard's address and says it opens only on this machine", () => {
		expect(block).toBe(
			[
				"<!-- omp-sessions -->",
				"**omp sessions.** These links open only on the machine that runs the omp-agents dashboard at http://127.0.0.1:4317.",
				"",
				"- [Session 01a0f6a5](http://127.0.0.1:4317/#session/01a0f6a5-181e-4c2b) submitted this pull request.",
				"- [Session 7c51f77b](http://127.0.0.1:4317/#session/7c51f77b-2a1b) worked on this pull request.",
				"<!-- /omp-sessions -->",
			].join("\n"),
		);
	});
});

describe("mergeSessionLinks", () => {
	test("appends the block to a description without one, and an empty description becomes the block", () => {
		expect(mergeSessionLinks("Fixes the thing.\n\n", block)).toBe(`Fixes the thing.\n\n${block}\n`);
		expect(mergeSessionLinks("", block)).toBe(`${block}\n`);
	});

	test("puts the block before Cursor's summary", () => {
		expect(mergeSessionLinks(`Fixes the thing.\n\n${SUMMARY}`, block)).toBe(`Fixes the thing.\n\n${block}\n\n${SUMMARY}`);
		expect(mergeSessionLinks(SUMMARY, block)).toBe(`${block}\n\n${SUMMARY}`);
	});

	test("a rerun replaces the block in place, so the same sessions leave the description as it was", () => {
		const once = mergeSessionLinks(`Fixes the thing.\n\n${SUMMARY}`, block);
		expect(mergeSessionLinks(once, block)).toBe(once);
		const fewer = sessionLinksBlock(ORIGIN, [{ sessionId: "abc", link: "worked" }]);
		expect(mergeSessionLinks(`Intro\n\n${block}\n\nOutro`, fewer)).toBe(`Intro\n\n${fewer}\n\nOutro`);
	});

	test("a stray start marker keeps the text after it, and $ in the text is not a replacement pattern", () => {
		const stray = `Costs $1 <!-- omp-sessions --> kept\n\n${block}`;
		const dollar = sessionLinksBlock(ORIGIN, [{ sessionId: "$&$1", link: "worked" }]);
		expect(mergeSessionLinks(stray, dollar)).toBe(`Costs $1 <!-- omp-sessions --> kept\n\n${dollar}`);
	});
});
