import { describe, expect, test } from "bun:test";
import { isSessionAlert } from "./desktop-bridge";

describe("isSessionAlert", () => {
	const alert = { hash: "#session/s", title: "Session", body: "Which branch?" };

	test("takes an alert with no sound, as a page built before sounds sends, or with a known sound", () => {
		expect(isSessionAlert(alert)).toBe(true);
		expect(isSessionAlert({ ...alert, sound: "Glass" })).toBe(true);
		expect(isSessionAlert({ ...alert, sound: "off" })).toBe(true);
	});

	test("refuses a sound it does not list, so the shell never builds a path from the page's text", () => {
		expect(isSessionAlert({ ...alert, sound: "../../../tmp/x" })).toBe(false);
		expect(isSessionAlert({ ...alert, sound: "glass" })).toBe(false);
		expect(isSessionAlert({ ...alert, sound: null })).toBe(false);
	});
});
