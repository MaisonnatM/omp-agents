import { describe, expect, test } from "bun:test";
import { isLoopbackUrl, isSessionAlert } from "./desktop-bridge";

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

test("the Preview loads only http and https addresses on this computer, on any port", () => {
	expect(["http://localhost:5173/", "https://localhost/", "http://127.0.0.1:3000/app?x=1", "http://[::1]:8080/"].map(isLoopbackUrl)).toEqual([true, true, true, true]);
	expect(["http://example.com/", "http://localhost.example.com/", "http://127.0.0.2/", "file:///etc/passwd", "ws://localhost:5173/", "javascript:alert(1)", "localhost:5173"].map(isLoopbackUrl)).toEqual([false, false, false, false, false, false, false]);
});
