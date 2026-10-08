import { expect, test } from "bun:test";
import { GoogleCalendarReader, type GoogleGet } from "./google-calendar";

const OCTOBER = [new Date("2026-10-01T00:00:00+02:00"), new Date("2026-11-01T00:00:00+01:00")] as const;

const CALENDARS = {
	items: [
		{ id: "max@example.com", summary: "max@example.com", backgroundColor: "#9fe1e7", selected: true, primary: true, accessRole: "owner" },
		{ id: "team@group.calendar.google.com", summary: "Team", summaryOverride: "Eng team", backgroundColor: "#b99aff", selected: true, accessRole: "reader" },
		{ id: "hidden@group.calendar.google.com", summary: "Hidden", backgroundColor: "#16a765" },
	],
};

/** Events as Google's `events.list` answers them with `singleEvents=true`: each repeat apart, moved ones at their new time. */
const WORK_EVENTS = {
	items: [
		{
			id: "standup_20261005T073000Z",
			status: "confirmed",
			summary: "Standup",
			htmlLink: "https://www.google.com/calendar/event?eid=standup1",
			start: { dateTime: "2026-10-05T09:30:00+02:00", timeZone: "Europe/Paris" },
			end: { dateTime: "2026-10-05T10:00:00+02:00", timeZone: "Europe/Paris" },
		},
		{
			id: "standup_20261026T083000Z",
			status: "confirmed",
			summary: "Standup",
			htmlLink: "https://www.google.com/calendar/event?eid=standup2",
			start: { dateTime: "2026-10-26T09:30:00+01:00", timeZone: "Europe/Paris" },
			end: { dateTime: "2026-10-26T10:00:00+01:00", timeZone: "Europe/Paris" },
		},
		{ id: "canceled_20261012T073000Z", status: "cancelled", start: { dateTime: "2026-10-12T09:30:00+02:00" }, end: { dateTime: "2026-10-12T10:00:00+02:00" } },
		{
			id: "lunch",
			status: "confirmed",
			summary: "Lunch",
			start: { dateTime: "2026-10-07T12:30:00+02:00" },
			end: { dateTime: "2026-10-07T13:30:00+02:00" },
			attendees: [
				{ email: "boss@example.com", responseStatus: "accepted" },
				{ email: "max@example.com", self: true, responseStatus: "declined" },
			],
		},
		{ id: "office", status: "confirmed", eventType: "workingLocation", summary: "Office", start: { date: "2026-10-08" }, end: { date: "2026-10-09" } },
		{ id: "offsite", status: "confirmed", summary: "Offsite", htmlLink: "https://www.google.com/calendar/event?eid=offsite", start: { date: "2026-10-14" }, end: { date: "2026-10-16" } },
		{ id: "reminder", status: "confirmed", start: { dateTime: "2026-10-20T09:00:00+02:00" }, end: { dateTime: "2026-10-20T09:00:00+02:00" } },
	],
};

const TEAM_EVENTS = {
	items: [{ id: "retro", status: "confirmed", summary: "Retro", htmlLink: "https://www.google.com/calendar/event?eid=retro", start: { dateTime: "2026-10-09T15:00:00+02:00" }, end: { dateTime: "2026-10-09T16:00:00+02:00" } }],
};

/** A reader over `answers`, by the path and `pageToken` of each address, that leaves out the `hidden` calendars, with the addresses it read. */
function readerOf(answers: Record<string, unknown>, hidden: ReadonlySet<string> = new Set()): { reader: GoogleCalendarReader; reads: string[] } {
	const reads: string[] = [];
	const get: GoogleGet = async url => {
		reads.push(url);
		const { pathname, searchParams } = new URL(url);
		const key = `${pathname}${searchParams.has("pageToken") ? `#${searchParams.get("pageToken")}` : ""}`;
		const answer = answers[key];
		if (answer instanceof Error) throw answer;
		if (answer === undefined) throw new Error(`unexpected read ${key}`);
		return answer;
	};
	return { reader: new GoogleCalendarReader(get, () => hidden), reads };
}

const LIST = "/calendar/v3/users/me/calendarList";
const WORK = "/calendar/v3/calendars/max%40example.com/events";
const TEAM = "/calendar/v3/calendars/team%40group.calendar.google.com/events";

test("the shown calendars' events keep each repeat, link to the event, end all-day events on their last day, and leave out what Google Calendar hides", async () => {
	const { reader, reads } = readerOf({ [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: { items: [] } });
	expect(await reader.events(...OCTOBER)).toEqual({
		events: [
			{ id: "max@example.com/standup_20261005T073000Z", title: "Standup", calendar: "max@example.com", color: "#9fe1e7", url: "https://www.google.com/calendar/event?eid=standup1", when: { allDay: false, start: Date.parse("2026-10-05T07:30:00Z"), end: Date.parse("2026-10-05T08:00:00Z") } },
			{ id: "max@example.com/standup_20261026T083000Z", title: "Standup", calendar: "max@example.com", color: "#9fe1e7", url: "https://www.google.com/calendar/event?eid=standup2", when: { allDay: false, start: Date.parse("2026-10-26T08:30:00Z"), end: Date.parse("2026-10-26T09:00:00Z") } },
			{ id: "max@example.com/offsite", title: "Offsite", calendar: "max@example.com", color: "#9fe1e7", url: "https://www.google.com/calendar/event?eid=offsite", when: { allDay: true, firstDay: "2026-10-14", lastDay: "2026-10-15" } },
		],
	});
	const work = new URL(reads.find(url => url.includes("max%40example.com"))!);
	expect(Object.fromEntries(work.searchParams)).toMatchObject({ singleEvents: "true", timeMin: "2026-09-30T22:00:00.000Z", timeMax: "2026-10-31T23:00:00.000Z" });
	expect(reads.some(url => url.includes("hidden"))).toBe(false);
});

test("a long calendar list and event list are read to their last page", async () => {
	const { reader } = readerOf({
		[LIST]: { items: [CALENDARS.items[0]], nextPageToken: "p2" },
		[`${LIST}#p2`]: { items: [CALENDARS.items[1]] },
		[WORK]: { items: [WORK_EVENTS.items[0]], nextPageToken: "e2" },
		[`${WORK}#e2`]: { items: [WORK_EVENTS.items[1]] },
		[TEAM]: { items: [] },
	});
	expect((await reader.status()).calendars.map(calendar => calendar.name)).toEqual(["max@example.com", "Eng team"]);
	expect((await reader.events(...OCTOBER)).events.map(event => event.id)).toEqual(["max@example.com/standup_20261005T073000Z", "max@example.com/standup_20261026T083000Z"]);
});

test("a calendar that cannot be read keeps its error for the settings while the others answer, and fails the read only when none can", async () => {
	const { reader } = readerOf({ [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: new Error("Not Found") });
	expect((await reader.events(...OCTOBER)).events).toHaveLength(3);
	expect((await reader.status()).calendars.map(({ name, error }) => ({ name, error }))).toEqual([
		{ name: "max@example.com", error: null },
		{ name: "Eng team", error: "Not Found" },
	]);

	const none = readerOf({ [LIST]: CALENDARS, [WORK]: new Error("Forbidden"), [TEAM]: new Error("Not Found") }).reader;
	await expect(none.events(...OCTOBER)).rejects.toThrow("Forbidden");
	const empty = readerOf({ [LIST]: { items: [CALENDARS.items[2]] } }).reader;
	await expect(empty.events(...OCTOBER)).rejects.toThrow("No calendar is checked");
});

test("a calendar unchecked on the Calendar page is not read and its events are left out, and the list keeps it unshown in Google Calendar's group", async () => {
	const hidden = new Set(["max@example.com"]);
	const { reader, reads } = readerOf({ [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: TEAM_EVENTS }, hidden);
	expect(await reader.events(...OCTOBER)).toEqual({
		events: [
			{ id: "team@group.calendar.google.com/retro", title: "Retro", calendar: "Eng team", color: "#b99aff", url: "https://www.google.com/calendar/event?eid=retro", when: { allDay: false, start: Date.parse("2026-10-09T13:00:00Z"), end: Date.parse("2026-10-09T14:00:00Z") } },
		],
	});
	expect(reads.some(url => url.includes("max%40example.com"))).toBe(false);
	expect((await reader.status()).calendars).toEqual([
		{ id: "max@example.com", name: "max@example.com", color: "#9fe1e7", group: "mine", shown: false, error: null },
		{ id: "team@group.calendar.google.com", name: "Eng team", color: "#b99aff", group: "other", shown: true, error: null },
	]);

	hidden.delete("max@example.com");
	expect((await reader.events(...OCTOBER)).events.map(event => event.id)).toEqual([
		"max@example.com/standup_20261005T073000Z",
		"max@example.com/standup_20261026T083000Z",
		"max@example.com/offsite",
		"team@group.calendar.google.com/retro",
	]);
});

test("with every calendar unchecked on the Calendar page, the events are none and no calendar is read", async () => {
	const { reader, reads } = readerOf({ [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: TEAM_EVENTS }, new Set(["max@example.com", "team@group.calendar.google.com"]));
	expect(await reader.events(...OCTOBER)).toEqual({ events: [] });
	expect(reads.map(url => new URL(url).pathname)).toEqual([LIST]);
});
