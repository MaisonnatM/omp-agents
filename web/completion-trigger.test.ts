import { expect, test } from "bun:test";
import { completionTrigger } from "./completion-trigger";

test("$ opens skills under the caret at a line start or after a space, but not a price", () => {
	expect(completionTrigger("$", 1)).toEqual({ kind: "skill", start: 0 });
	expect(completionTrigger("$poteto", 7)).toEqual({ kind: "skill", start: 0 });
	expect(completionTrigger("Please $poteto", 14)).toEqual({ kind: "skill", start: 7 });
	expect(completionTrigger("See $poteto later", 17)).toBeNull();
	expect(completionTrigger("It costs $5", 11)).toBeNull();
	expect(completionTrigger("echo a$b", 8)).toBeNull();
});

test("/ opens commands only at the start of the prompt, and not for a path", () => {
	expect(completionTrigger("/", 1)).toEqual({ kind: "command" });
	expect(completionTrigger("  /sh", 5)).toEqual({ kind: "command" });
	expect(completionTrigger("/ship now", 9)).toBeNull();
	expect(completionTrigger("Please /ship", 12)).toBeNull();
	expect(completionTrigger("Fix it\n/ship", 12)).toBeNull();
	expect(completionTrigger("/tmp/a", 6)).toBeNull();
});

test("mentions work after prose but not inside ordinary words", () => {
	expect(completionTrigger("Read @src/", 10)).toEqual({ kind: "mention", token: { start: 5, end: 10, prefix: null, body: "src/" } });
	expect(completionTrigger("Write email@example.com", 23)).toBeNull();
	expect(completionTrigger('Read @"file with space', 22)).toEqual({ kind: "mention", token: { start: 5, end: 22, prefix: null, body: '"file with space' } });
});

test("a word and a colon after the @ is the mention's prefix", () => {
	expect(completionTrigger("Fix @ticket:foo", 15)).toEqual({ kind: "mention", token: { start: 4, end: 15, prefix: "ticket", body: "foo" } });
	expect(completionTrigger('Fix @ticket:"login page', 23)).toEqual({ kind: "mention", token: { start: 4, end: 23, prefix: "ticket", body: '"login page' } });
	expect(completionTrigger("Fix @ticket:", 12)).toEqual({ kind: "mention", token: { start: 4, end: 12, prefix: "ticket", body: "" } });
	expect(completionTrigger("Read @src/a:b", 13)).toEqual({ kind: "mention", token: { start: 5, end: 13, prefix: null, body: "src/a:b" } });
});
