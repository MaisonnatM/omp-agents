import { expect, test } from "bun:test";
import { completionTrigger } from "./completion-trigger";

test("$ opens commands and skills under the caret, and / no longer does", () => {
	expect(completionTrigger("$", 1)).toEqual({ kind: "command", start: 0 });
	expect(completionTrigger("$skill:demo", 11)).toEqual({ kind: "command", start: 0 });
	expect(completionTrigger("Please $skill:demo", 18)).toEqual({ kind: "command", start: 7 });
	expect(completionTrigger("See $skill:demo later", 21)).toBeNull();
	expect(completionTrigger("It costs $5", 11)).toBeNull();
	expect(completionTrigger("echo a$b", 8)).toBeNull();
	expect(completionTrigger("/skill:demo", 11)).toBeNull();
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
