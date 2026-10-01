import { expect, test } from "bun:test";
import { completionTrigger } from "./completion-trigger";

test("slash suggestions require a token under the caret", () => {
	expect(completionTrigger("/skill:demo", 11)).toBe("slash");
	expect(completionTrigger("Please /skill:demo", 18)).toBe("slash");
	expect(completionTrigger("See /skill:demo later", 21)).toBeNull();
	expect(completionTrigger("https://example.com", 19)).toBeNull();
});

test("file mentions work after prose but not inside ordinary words", () => {
	expect(completionTrigger("Read @src/", 10)).toBe("mention");
	expect(completionTrigger("Write email@example.com", 23)).toBeNull();
	expect(completionTrigger("Read @\"file with space", 22)).toBe("mention");
});
