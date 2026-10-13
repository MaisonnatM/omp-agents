import { expect, test } from "bun:test";
import { GoogleCalendarClient } from "./google-calendar";
import { ApiError, type SignedFetch } from "./signed-fetch";

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

/**
 * A client over `answers`, by the path and `pageToken` of each address, that leaves out the `hidden` calendars, with the
 * addresses it read, what it posted, and the addresses it deleted; a delete throws the error `answers` holds for `DELETE <path>`.
 */
function clientOf(
	answers: Record<string, unknown>,
	hidden: ReadonlySet<string> = new Set(),
): { client: GoogleCalendarClient; reads: string[]; posts: { url: string; body: unknown }[]; deletes: string[] } {
	const reads: string[] = [];
	const posts: { url: string; body: unknown }[] = [];
	const deletes: string[] = [];
	const fetch: SignedFetch = async (url, init) => {
		switch (init?.method) {
			case "POST":
				posts.push({ url, body: init.body });
				return { id: "created" };
			case "DELETE": {
				deletes.push(url);
				const failure = answers[`DELETE ${new URL(url).pathname}`];
				if (failure instanceof Error) throw failure;
				return null;
			}
			case undefined:
				break;
			default: {
				const unhandled: never = init;
				return unhandled;
			}
		}
		reads.push(url);
		const { pathname, searchParams } = new URL(url);
		const key = `${pathname}${searchParams.has("pageToken") ? `#${searchParams.get("pageToken")}` : ""}`;
		const answer = answers[key];
		if (answer instanceof Error) throw answer;
		if (answer === undefined) throw new Error(`unexpected read ${key}`);
		return answer;
	};
	return { client: new GoogleCalendarClient(fetch, () => hidden), reads, posts, deletes };
}

const LIST = "/calendar/v3/users/me/calendarList";
const WORK = "/calendar/v3/calendars/max%40example.com/events";
const TEAM = "/calendar/v3/calendars/team%40group.calendar.google.com/events";

test("the shown calendars' events keep each repeat, link to the event, end all-day events on their last day, and leave out what Google Calendar hides", async () => {
	const { client, reads } = clientOf({ [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: { items: [] } });
	expect(await client.events(...OCTOBER)).toEqual({
		events: [
			{ calendarId: "max@example.com", eventId: "standup_20261005T073000Z", writable: true, title: "Standup", calendar: "max@example.com", color: "#9fe1e7", url: "https://www.google.com/calendar/event?eid=standup1", when: { allDay: false, start: Date.parse("2026-10-05T07:30:00Z"), end: Date.parse("2026-10-05T08:00:00Z") } },
			{ calendarId: "max@example.com", eventId: "standup_20261026T083000Z", writable: true, title: "Standup", calendar: "max@example.com", color: "#9fe1e7", url: "https://www.google.com/calendar/event?eid=standup2", when: { allDay: false, start: Date.parse("2026-10-26T08:30:00Z"), end: Date.parse("2026-10-26T09:00:00Z") } },
			{ calendarId: "max@example.com", eventId: "offsite", writable: true, title: "Offsite", calendar: "max@example.com", color: "#9fe1e7", url: "https://www.google.com/calendar/event?eid=offsite", when: { allDay: true, firstDay: "2026-10-14", lastDay: "2026-10-15" } },
		],
	});
	const work = new URL(reads.find(url => url.includes("max%40example.com"))!);
	expect(Object.fromEntries(work.searchParams)).toMatchObject({ singleEvents: "true", timeMin: "2026-09-30T22:00:00.000Z", timeMax: "2026-10-31T23:00:00.000Z" });
	expect(reads.some(url => url.includes("hidden"))).toBe(false);
});

test("a long calendar list and event list are read to their last page", async () => {
	const { client } = clientOf({
		[LIST]: { items: [CALENDARS.items[0]], nextPageToken: "p2" },
		[`${LIST}#p2`]: { items: [CALENDARS.items[1]] },
		[WORK]: { items: [WORK_EVENTS.items[0]], nextPageToken: "e2" },
		[`${WORK}#e2`]: { items: [WORK_EVENTS.items[1]] },
		[TEAM]: { items: [] },
	});
	expect((await client.status()).calendars.map(calendar => calendar.name)).toEqual(["max@example.com", "Eng team"]);
	expect((await client.events(...OCTOBER)).events.map(event => event.eventId)).toEqual(["standup_20261005T073000Z", "standup_20261026T083000Z"]);
});

test("a calendar that cannot be read keeps its error for the settings while the others answer, and fails the read only when none can", async () => {
	const { client } = clientOf({ [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: new Error("Not Found") });
	expect((await client.events(...OCTOBER)).events).toHaveLength(3);
	expect((await client.status()).calendars.map(({ name, error }) => ({ name, error }))).toEqual([
		{ name: "max@example.com", error: null },
		{ name: "Eng team", error: "Not Found" },
	]);

	const none = clientOf({ [LIST]: CALENDARS, [WORK]: new Error("Forbidden"), [TEAM]: new Error("Not Found") }).client;
	await expect(none.events(...OCTOBER)).rejects.toThrow("Forbidden");
	const empty = clientOf({ [LIST]: { items: [CALENDARS.items[2]] } }).client;
	await expect(empty.events(...OCTOBER)).rejects.toThrow("No calendar is checked");
});

test("a calendar unchecked on the Calendar page is not read and its events are left out, and the list keeps it unshown in Google Calendar's group", async () => {
	const hidden = new Set(["max@example.com"]);
	const { client, reads } = clientOf({ [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: TEAM_EVENTS }, hidden);
	expect(await client.events(...OCTOBER)).toEqual({
		events: [
			{ calendarId: "team@group.calendar.google.com", eventId: "retro", writable: false, title: "Retro", calendar: "Eng team", color: "#b99aff", url: "https://www.google.com/calendar/event?eid=retro", when: { allDay: false, start: Date.parse("2026-10-09T13:00:00Z"), end: Date.parse("2026-10-09T14:00:00Z") } },
		],
	});
	expect(reads.some(url => url.includes("max%40example.com"))).toBe(false);
	expect((await client.status()).calendars).toEqual([
		{ id: "max@example.com", name: "max@example.com", color: "#9fe1e7", group: "mine", writable: true, shown: false, error: null },
		{ id: "team@group.calendar.google.com", name: "Eng team", color: "#b99aff", group: "other", writable: false, shown: true, error: null },
	]);

	hidden.delete("max@example.com");
	expect((await client.events(...OCTOBER)).events.map(event => `${event.calendarId}/${event.eventId}`)).toEqual([
		"max@example.com/standup_20261005T073000Z",
		"max@example.com/standup_20261026T083000Z",
		"max@example.com/offsite",
		"team@group.calendar.google.com/retro",
	]);
});

test("with every calendar unchecked on the Calendar page, the events are none and no calendar is read", async () => {
	const { client, reads } = clientOf({ [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: TEAM_EVENTS }, new Set(["max@example.com", "team@group.calendar.google.com"]));
	expect(await client.events(...OCTOBER)).toEqual({ events: [] });
	expect(reads.map(url => new URL(url).pathname)).toEqual([LIST]);
});

const FAMILY = { id: "family@group.calendar.google.com", summary: "Family", backgroundColor: "#16a765", selected: true, accessRole: "writer" };
const FAMILY_EVENTS = "/calendar/v3/calendars/family%40group.calendar.google.com/events";

test("a new event posts to its calendar, all day with Google's exclusive end or timed in ISO times, and the next read of that calendar asks Google again", async () => {
	const answers: Record<string, unknown> = { [LIST]: { items: [CALENDARS.items[0], FAMILY] }, [WORK]: { items: [] }, [FAMILY_EVENTS]: { items: [] } };
	const { client, posts } = clientOf(answers);
	expect((await client.status()).calendars.map(({ name, writable }) => ({ name, writable }))).toEqual([
		{ name: "max@example.com", writable: true },
		{ name: "Family", writable: true },
	]);
	expect((await client.events(...OCTOBER)).events).toEqual([]);

	await client.create("max@example.com", "Offsite", { allDay: true, firstDay: "2026-10-14", lastDay: "2026-10-15" });
	await client.create("family@group.calendar.google.com", "Dinner", { allDay: false, start: Date.parse("2026-10-09T17:00:00Z"), end: Date.parse("2026-10-09T19:30:00Z") });
	expect(posts).toEqual([
		{ url: `https://www.googleapis.com${WORK}`, body: { summary: "Offsite", start: { date: "2026-10-14" }, end: { date: "2026-10-16" } } },
		{ url: `https://www.googleapis.com${FAMILY_EVENTS}`, body: { summary: "Dinner", start: { dateTime: "2026-10-09T17:00:00.000Z" }, end: { dateTime: "2026-10-09T19:30:00.000Z" } } },
	]);

	answers[WORK] = { items: [WORK_EVENTS.items[5]] };
	expect((await client.events(...OCTOBER)).events.map(event => event.eventId)).toEqual(["offsite"]);
});

test("a new event in a calendar you may only read, or one not checked in your list, is refused before Google is asked", async () => {
	const { client, posts } = clientOf({ [LIST]: CALENDARS });
	const when = { allDay: true, firstDay: "2026-10-14", lastDay: "2026-10-14" } as const;
	await expect(client.create("team@group.calendar.google.com", "Retro", when)).rejects.toThrow("You may only read Eng team, so it takes no new events.");
	await expect(client.create("hidden@group.calendar.google.com", "Retro", when)).rejects.toThrow("That calendar is not checked in your Google Calendar's list.");
	expect(posts).toEqual([]);
});

test("deleting a repeat of an event in a calendar you may write to deletes only that repeat, and the next read of that calendar asks Google again", async () => {
	const answers: Record<string, unknown> = { [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: { items: [] } };
	const { client, deletes } = clientOf(answers);
	expect((await client.events(...OCTOBER)).events.map(event => event.eventId)).toEqual(["standup_20261005T073000Z", "standup_20261026T083000Z", "offsite"]);

	await client.delete("max@example.com", "standup_20261005T073000Z");
	expect(deletes).toEqual(["https://www.googleapis.com/calendar/v3/calendars/max%40example.com/events/standup_20261005T073000Z"]);

	answers[WORK] = { items: WORK_EVENTS.items.filter(item => item.id !== "standup_20261005T073000Z") };
	expect((await client.events(...OCTOBER)).events.map(event => event.eventId)).toEqual(["standup_20261026T083000Z", "offsite"]);
});

test("deleting an event of a calendar you may only read, or of one not checked in your list, is refused before Google is asked", async () => {
	const { client, deletes } = clientOf({ [LIST]: CALENDARS });
	await expect(client.delete("team@group.calendar.google.com", "retro")).rejects.toThrow("You may only read Eng team, so its events cannot be deleted here.");
	await expect(client.delete("hidden@group.calendar.google.com", "party")).rejects.toThrow("That calendar is not checked in your Google Calendar's list. Check it there to delete its events.");
	expect(deletes).toEqual([]);
});

test("deleting an event Google already deleted counts as deleted, and the next read of that calendar asks Google again", async () => {
	const answers: Record<string, unknown> = { [LIST]: CALENDARS, [WORK]: WORK_EVENTS, [TEAM]: { items: [] }, [`DELETE ${WORK}/offsite`]: new ApiError("Resource has been deleted", 410) };
	const { client } = clientOf(answers);
	expect((await client.events(...OCTOBER)).events.map(event => event.eventId)).toEqual(["standup_20261005T073000Z", "standup_20261026T083000Z", "offsite"]);

	await client.delete("max@example.com", "offsite");
	answers[WORK] = { items: WORK_EVENTS.items.filter(item => item.id !== "offsite") };
	expect((await client.events(...OCTOBER)).events.map(event => event.eventId)).toEqual(["standup_20261005T073000Z", "standup_20261026T083000Z"]);
});

test("a delete Google refuses for another reason fails with Google's message", async () => {
	const { client } = clientOf({ [LIST]: CALENDARS, [`DELETE ${WORK}/offsite`]: new ApiError("Forbidden", 403) });
	await expect(client.delete("max@example.com", "offsite")).rejects.toThrow("Forbidden");
});
