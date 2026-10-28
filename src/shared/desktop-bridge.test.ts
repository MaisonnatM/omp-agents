import { describe, expect, test } from "bun:test";
import { appAddress, isLoopbackUrl, isSessionAlert } from "./desktop-bridge";

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

describe("appAddress", () => {
	const ports = { session: [24817, 24818], other: [8000] };
	const callback = "http://localhost:3000/v1/auth/callback?code=c&state=s";
	const shown = ["http://localhost:24818/", "http://localhost:24817/login", "https://auth.workos.com/sso"];

	test("a sign-in that comes back to the app's usual port lands on the session's server it last showed, query kept", () => {
		expect(appAddress(callback, "https://auth.workos.com/sso", shown, ports)).toBe("http://localhost:24817/v1/auth/callback?code=c&state=s");
		expect(appAddress("http://localhost:3000/orgs", "http://localhost:24818/login", shown, ports)).toBe("http://localhost:24817/orgs");
	});

	test("a sign-in through the app's API reaches the API, whose redirect to the app's usual port then lands on the session's server", () => {
		expect(appAddress("http://localhost:8000/v1/auth/workos/callback?code=c", "https://auth.workos.com/sso", shown, ports)).toBeNull();
		expect(appAddress("http://localhost:3000/orgs", "https://auth.workos.com/sso", shown, ports)).toBe("http://localhost:24817/orgs");
	});

	test("leaves addresses the session serves, pages off this computer, pages it does not serve, and a guest that showed none of its servers", () => {
		expect(appAddress("http://localhost:24818/api", "http://localhost:24817/", shown, ports)).toBeNull();
		expect(appAddress("https://accounts.google.com/", "http://localhost:24817/", shown, ports)).toBeNull();
		expect(appAddress("http://localhost:3000/next", "http://localhost:8000/docs", shown, ports)).toBeNull();
		expect(appAddress(callback, "https://auth.workos.com/sso", ["https://auth.workos.com/sso"], ports)).toBeNull();
	});
});
