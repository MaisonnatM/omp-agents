import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expandFeed, GoogleCalendar, parseFeed } from "./google-calendar";

// The feed's times are Paris wall-clock times; Paris leaves summer time on 2026-10-25, inside the month below.
const savedTz = process.env.TZ;
beforeAll(() => {
	process.env.TZ = "Europe/Paris";
});
afterAll(() => {
	process.env.TZ = savedTz;
});

const dirs: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ADDRESS = "https://calendar.google.com/calendar/ical/max%40example.com/private-0123abcd/basic.ics";
const OTHER = "https://calendar.google.com/calendar/ical/team%40group.calendar.google.com/private-4567ef/basic.ics";

const FEED = `BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
X-WR-CALNAME:Work
BEGIN:VTIMEZONE
TZID:Europe/Paris
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=Europe/Paris:20200106T093000
DTEND;TZID=Europe/Paris:20200106T100000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Europe/Paris:20261012T093000
UID:standup@google.com
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Europe/Paris:20261020T110000
DTEND;TZID=Europe/Paris:20261020T113000
RECURRENCE-ID;TZID=Europe/Paris:20261019T093000
UID:standup@google.com
SUMMARY:Standup (moved)
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261024
DTEND;VALUE=DATE:20261027
UID:vacation@google.com
SUMMARY:Vacation
END:VEVENT
BEGIN:VEVENT
DTSTART:20261008T120000Z
DTEND:20261008T130000Z
UID:lunch@google.com
SUMMARY:Lunch
ATTENDEE;PARTSTAT=DECLINED;CN=max@example.com:mailto:max@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20261008T223000Z
DTEND:20261008T233000Z
UID:late@google.com
SUMMARY:Late call
END:VEVENT
BEGIN:VEVENT
DTSTART:20261009T120000Z
DTEND:20261009T130000Z
UID:canceled@google.com
STATUS:CANCELLED
SUMMARY:Canceled
END:VEVENT
BEGIN:VEVENT
DTSTART:20250101T120000Z
DTEND:20250101T130000Z
UID:old@google.com
SUMMARY:Last year
END:VEVENT
END:VCALENDAR
`;

const OCTOBER = [new Date("2026-10-01T00:00:00+02:00"), new Date("2026-11-01T00:00:00+01:00")] as const;
const work = { id: "work", name: "Work", color: "#039be5", owner: "max@example.com" };

test("a feed's month holds each repeat in its own time zone, with Google's moved and removed repeats, all-day ends, local day links, and no declined or canceled events", () => {
	expect(expandFeed(parseFeed(FEED), work, ...OCTOBER)).toEqual([
		{ id: "work/standup@google.com/2026-10-05T09:30:00", title: "Standup", calendar: "Work", color: "#039be5", url: "https://calendar.google.com/calendar/r/day/2026/10/5", when: { allDay: false, start: Date.parse("2026-10-05T07:30:00Z"), end: Date.parse("2026-10-05T08:00:00Z") } },
		{ id: "work/standup@google.com/2026-10-19T09:30:00", title: "Standup (moved)", calendar: "Work", color: "#039be5", url: "https://calendar.google.com/calendar/r/day/2026/10/20", when: { allDay: false, start: Date.parse("2026-10-20T09:00:00Z"), end: Date.parse("2026-10-20T09:30:00Z") } },
		{ id: "work/standup@google.com/2026-10-26T09:30:00", title: "Standup", calendar: "Work", color: "#039be5", url: "https://calendar.google.com/calendar/r/day/2026/10/26", when: { allDay: false, start: Date.parse("2026-10-26T08:30:00Z"), end: Date.parse("2026-10-26T09:00:00Z") } },
		{ id: "work/vacation@google.com", title: "Vacation", calendar: "Work", color: "#039be5", url: "https://calendar.google.com/calendar/r/day/2026/10/24", when: { allDay: true, firstDay: "2026-10-24", lastDay: "2026-10-26" } },
		{ id: "work/late@google.com", title: "Late call", calendar: "Work", color: "#039be5", url: "https://calendar.google.com/calendar/r/day/2026/10/9", when: { allDay: false, start: Date.parse("2026-10-08T22:30:00Z"), end: Date.parse("2026-10-08T23:30:00Z") } },
	]);
});

test("someone else's calendar keeps the events its owner declined", () => {
	const titles = expandFeed(parseFeed(FEED), { ...work, owner: null }, ...OCTOBER).map(event => event.title);
	expect(titles).toContain("Lunch");
});

test("an answer that is not a calendar is refused", () => {
	expect(() => parseFeed("<html>Sign in</html>")).toThrow("something other than a calendar");
	expect(() => parseFeed("BEGIN:VEVENT\nUID:a\nEND:VEVENT\n")).toThrow("something other than a calendar");
});

test("calendars are added once they read, keep their address on the server, replace an older file at once, and a failing one leaves the others' events", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-calendar-"));
	dirs.push(dir);
	const path = join(dir, "config", "google.json");
	mkdirSync(dirname(path));
	writeFileSync(path, JSON.stringify({ clientId: "123.apps.googleusercontent.com", clientSecret: "old-secret", refreshToken: "old-token" }));
	const answers: Record<string, () => Response> = {
		[ADDRESS]: () => new Response(FEED),
		[OTHER]: () => new Response("Not Found", { status: 404 }),
	};
	globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => answers[String(input)]!(), { preconnect: originalFetch.preconnect });

	const google = new GoogleCalendar(path);
	expect(google.status()).toEqual({ calendars: [] });
	expect(readFileSync(path, "utf8")).not.toContain("old-secret");
	await expect(google.add(OTHER)).rejects.toThrow("Google answered 404");
	const added = await google.add(ADDRESS);
	expect(added.calendars.map(({ name, color, error }) => ({ name, color, error }))).toEqual([{ name: "Work", color: "#039be5", error: null }]);
	expect((await google.add(ADDRESS)).calendars).toHaveLength(1);
	expect(JSON.stringify(added)).not.toContain("private-0123abcd");
	expect(statSync(path).mode & 0o777).toBe(0o600);

	answers[OTHER] = () => new Response(FEED.replace("X-WR-CALNAME:Work", "X-WR-CALNAME:Team"));
	await google.add(OTHER);
	answers[OTHER] = () => new Response("Gone", { status: 410 });
	const events = await google.events(...OCTOBER, true);
	expect(new Set(events.events.map(event => event.calendar))).toEqual(new Set(["Work"]));
	const [work, team] = google.status().calendars;
	expect([work!.color, team!.color]).toEqual(["#039be5", "#33b679"]);
	expect(team!.error).toBe("Google answered 410 for this calendar's address");

	const reloaded = new GoogleCalendar(path);
	expect(reloaded.status().calendars.map(calendar => calendar.name)).toEqual(["Work", "Team"]);
	expect(reloaded.remove(work!.id).calendars.map(calendar => calendar.name)).toEqual(["Team"]);
	expect(new GoogleCalendar(path).status().calendars.map(calendar => calendar.name)).toEqual(["Team"]);
});
