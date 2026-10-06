import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GoogleCalendar, toCalendarEvent } from "./google-calendar";

const dirs: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const client = { clientId: "123.apps.googleusercontent.com", clientSecret: "secret-from-google" };
const calendar = { id: "personal", name: "Personal", color: "#4285f4" };

const pathFor = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "omp-calendar-"));
	dirs.push(dir);
	return join(dir, "config", "google.json");
};

test("Google's exclusive all-day end is the preceding day and a timed event keeps its instants", () => {
	expect(toCalendarEvent({ id: "a", summary: "Vacation", start: { date: "2026-10-24" }, end: { date: "2026-10-27" } }, calendar)).toEqual({
		id: "personal/a", title: "Vacation", calendar: "Personal", color: "#4285f4", url: "https://calendar.google.com/",
		when: { allDay: true, firstDay: "2026-10-24", lastDay: "2026-10-26" },
	});
	expect(toCalendarEvent({ id: "b", summary: "Night shift", start: { dateTime: "2026-10-24T23:00:00+02:00" }, end: { dateTime: "2026-10-25T01:00:00+02:00" } }, calendar)?.when).toEqual({
		allDay: false, start: Date.parse("2026-10-24T23:00:00+02:00"), end: Date.parse("2026-10-25T01:00:00+02:00"),
	});
});

test("canceled, declined, and working-location entries do not appear", () => {
	const item = { id: "a", start: { date: "2026-10-24" }, end: { date: "2026-10-25" } };
	expect(toCalendarEvent({ ...item, status: "cancelled" }, calendar)).toBeNull();
	expect(toCalendarEvent({ ...item, attendees: [{ self: true, responseStatus: "declined" }] }, calendar)).toBeNull();
	expect(toCalendarEvent({ ...item, eventType: "workingLocation" }, calendar)).toBeNull();
	expect(toCalendarEvent({ ...item, htmlLink: "javascript:alert(1)" }, calendar)?.url).toBe("https://calendar.google.com/");
});

test("loopback sign-in verifies state, stores a private refresh token, and reads only selected calendars", async () => {
	const path = pathFor();
	const google = new GoogleCalendar(path);
	expect(google.saveClient(client)).toEqual({ clientId: client.clientId, connected: false, signIn: null });
	expect(statSync(path).mode & 0o777).toBe(0o600);
	expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
	const calls: URL[] = [];
	globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		if (url.hostname === "127.0.0.1") return originalFetch(input, init);
		calls.push(url);
		if (url.pathname === "/token") {
			const grant = new URLSearchParams(init?.body as string);
			if (grant.get("grant_type") === "authorization_code") return Response.json({ access_token: "temporary", refresh_token: "private-refresh-token", expires_in: 3600 });
			return Response.json({ access_token: "access-token", expires_in: 3600 });
		}
		if (url.pathname === "/calendar/v3/users/me/calendarList") return Response.json({ items: [
			{ id: "personal", summary: "Personal", selected: true, backgroundColor: "#4285f4" },
			{ id: "hidden", summary: "Hidden", selected: false },
		] });
		if (url.pathname === "/calendar/v3/calendars/personal/events") {
			expect(init?.headers).toEqual({ authorization: "Bearer access-token" });
			expect(url.searchParams.get("singleEvents")).toBe("true");
			return Response.json({ items: [{ id: "meeting", summary: "Planning", htmlLink: "https://calendar.google.com/calendar/event?eid=m", start: { date: "2026-10-06" }, end: { date: "2026-10-07" } }] });
		}
		throw new Error(`Unexpected Google API call ${url}`);
	}, { preconnect: originalFetch.preconnect });
	const waiting = await google.startSignIn();
	if (waiting.signIn?.phase !== "waiting") throw new Error("Expected a waiting sign-in");
	const auth = new URL(waiting.signIn.url);
	expect(auth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.readonly");
	expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
	const redirect = auth.searchParams.get("redirect_uri")!;
	expect((await fetch(`${redirect}?code=wrong&state=wrong`)).status).toBe(400);
	expect(google.status().signIn?.phase).toBe("waiting");
	expect((await fetch(`${redirect}?code=one-time-code&state=${auth.searchParams.get("state")}`)).status).toBe(200);
	for (let i = 0; i < 50 && !google.status().connected; i++) await Promise.resolve();
	expect(google.status()).toEqual({ clientId: client.clientId, connected: true, signIn: null });
	expect(readFileSync(path, "utf8")).toContain("private-refresh-token");
	expect(new GoogleCalendar(path).status().connected).toBe(true);
	const events = await google.events(new Date("2026-10-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
	expect(events.events.map(event => [event.id, event.title, event.when])).toEqual([
		["personal/meeting", "Planning", { allDay: true, firstDay: "2026-10-06", lastDay: "2026-10-06" }],
	]);
	expect(calls.some(url => url.pathname.includes("/hidden/events"))).toBe(false);
	expect(google.saveClient({ ...client, clientSecret: "replacement" }).connected).toBe(false);
	expect(readFileSync(path, "utf8")).not.toContain("private-refresh-token");
});
