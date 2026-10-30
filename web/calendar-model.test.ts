import { afterAll, describe, expect, test } from "bun:test";
import type { Routine, RoutineRun, Schedule } from "../src/routines";
import type { GoogleAccount } from "../src/shared/accounts";
import type { BotId } from "../src/shared/bots";
import type { CalendarEvent, GoogleCalendar, LocalEvent } from "../src/shared/calendar";
import type { Ticket } from "../src/shared/tickets";
import type { UserTodo, UserTodoList } from "../src/user-todos-shared";
import { type CalendarEntry, calendarChoices, calendarEntries, keptChoice } from "./calendar-model";

// Weekly slots are local wall-clock times; Paris leaves DST on 2026-10-25, inside the month below.
const savedTz = process.env.TZ;
process.env.TZ = "Europe/Paris";
afterAll(() => {
	if (savedTz === undefined) delete process.env.TZ;
	else process.env.TZ = savedTz;
});

const at = (iso: string): number => Date.parse(iso);
const weekdays: Schedule = { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 9, minute: 0 } };
const OCTOBER = { year: 2026, month: 9 };
/** Wednesday 14 October 2026, noon. */
const NOW = at("2026-10-14T12:00:00+02:00");

const run = (iso: string, fields: Partial<RoutineRun> = {}): RoutineRun => ({ at: at(iso), outcome: { kind: "pending", queued: false }, errors: [], triggeredBy: [], ...fields });
/** A routine whose runs a schedule started, unless `fields` says otherwise. */
const routine = (fields: Partial<Routine>): Routine => ({
	id: "r1",
	botId: "scout" as BotId,
	name: "Notes",
	schedules: [weekdays],
	triggers: [],
	task: { kind: "prompt", prompt: "Summarize yesterday's commits." },
	enabled: true,
	createdAt: at("2026-09-01T08:00:00+02:00"),
	runs: [],
	scheduledAt: fields.runs?.[0]?.at ?? null,
	...fields,
});
const todo = (fields: Partial<UserTodo>): UserTodo => ({ id: "t1", text: "Todo", body: "", status: "todo", priority: 0, assignee: null, doneAt: null, due: null, createdAt: null, categoryId: null, workspace: null, children: [], links: [], addedBy: null, ...fields });
const list = (todos: UserTodo[], archive: UserTodo[] = []): UserTodoList => ({ categories: [], todos, archive });
const ticket = (fields: Partial<Ticket>): Ticket => ({
	id: "ENG-1",
	title: "Ship it",
	url: "https://linear.app/x/issue/ENG-1",
	status: "Todo",
	statusType: "unstarted",
	priority: 0,
	labels: [],
	project: null,
	team: "ENG",
	dueDate: null,
	createdAt: "2026-09-01T00:00:00Z",
	updatedAt: "2026-10-01T00:00:00Z",
	branch: "eng-1",
	parentId: null,
	...fields,
});

const october = (sources: Partial<Parameters<typeof calendarEntries>[0]>, now = NOW): CalendarEntry[] =>
	calendarEntries({ routines: [], todos: null, tickets: null, events: null, localEvents: null, ...sources }, OCTOBER.year, OCTOBER.month, now);
const days = (entries: CalendarEntry[], state?: string): string[] =>
	entries.filter(entry => entry.kind === "routine" && (state === undefined || entry.state === state)).map(({ day }) => day);

describe("routines", () => {
	test("past runs keep their result, and planned slots follow the schedule to the month's end, skipping weekends", () => {
		const entries = october({ routines: [routine({ runs: [run("2026-10-14T09:00:00+02:00"), run("2026-10-13T09:00:00+02:00", { errors: ["no slot"] })] })] });
		expect(entries.filter(entry => entry.kind === "routine" && entry.state !== "planned").map(entry => entry.kind === "routine" && [entry.day, entry.state])).toEqual([
			["2026-10-13", "failed"],
			["2026-10-14", "ran"],
		]);
		const planned = days(entries, "planned");
		expect(planned[0]).toBe("2026-10-15");
		expect(planned.at(-1)).toBe("2026-10-30");
		expect(planned).not.toContain("2026-10-17");
		expect(planned).toHaveLength(12);
	});

	test("9:00 stays 9:00 local after DST ends", () => {
		const entries = october({ routines: [routine({ runs: [run("2026-10-23T09:00:00+02:00")] })] }, at("2026-10-23T12:00:00+02:00"));
		const monday = entries.find(entry => entry.kind === "routine" && entry.day === "2026-10-26");
		expect(monday?.kind === "routine" && monday.at).toBe(at("2026-10-26T09:00:00+01:00"));
	});

	test("a slot that passed without a run shows once, now, and the next slots count from it", () => {
		const entries = october({ routines: [routine({ runs: [run("2026-10-09T09:00:00+02:00")] })] });
		const planned = entries.filter(entry => entry.kind === "routine" && entry.state === "planned");
		expect(planned[0]?.kind === "routine" && planned[0].at).toBe(NOW);
		expect(planned[1]?.day).toBe("2026-10-15");
	});

	test("a command that exited non-zero or was stopped failed", () => {
		const exited = run("2026-10-12T09:00:00+02:00", { outcome: { kind: "command", run: { phase: "exited", code: 1, output: "", startedAt: 0, endedAt: 1 } } });
		const stopped = run("2026-10-13T09:00:00+02:00", { outcome: { kind: "command", run: { phase: "stopped", reason: "time-limit", output: "", startedAt: 0, endedAt: 1 } } });
		const passed = run("2026-10-14T09:00:00+02:00", { outcome: { kind: "command", run: { phase: "exited", code: 0, output: "", startedAt: 0, endedAt: 1 } } });
		const entries = october({ routines: [routine({ enabled: false, runs: [passed, stopped, exited] })] });
		expect(entries.map(entry => entry.kind === "routine" && entry.state)).toEqual(["failed", "failed", "ran"]);
	});

	test("a paused routine keeps its past runs and plans nothing", () => {
		const entries = october({ routines: [routine({ enabled: false, runs: [run("2026-10-14T09:00:00+02:00")] })] });
		expect(days(entries)).toEqual(["2026-10-14"]);
	});

	test("an interval under a day shows once per day from today, instead of each run", () => {
		const every = routine({ schedules: [{ kind: "every", minutes: 30 }, weekdays], runs: [run("2026-10-14T11:30:00+02:00")] });
		const entries = october({ routines: [every] });
		expect(entries.every(entry => entry.kind === "routine-interval" && entry.minutes === 30)).toBe(true);
		expect(entries.map(({ day }) => day)).toEqual(Array.from({ length: 18 }, (_, i) => `2026-10-${String(14 + i)}`));
		expect(october({ routines: [{ ...every, enabled: false }] })).toEqual([]);
	});

	test("a month before now plans nothing", () => {
		expect(october({ routines: [routine({})] }, at("2026-11-20T12:00:00+01:00"))).toEqual([]);
	});

	test("a month after now plans from the last run through it", () => {
		const entries = calendarEntries({ routines: [routine({})], todos: null, tickets: null, events: null, localEvents: null }, 2026, 11, NOW);
		expect(days(entries, "planned")).toHaveLength(23);
	});
});

describe("todos and tickets", () => {
	test("todos and their own todos show on their due day within the month; checked ones are done, and the archive is left out", () => {
		const parent = todo({
			id: "p",
			due: "2026-10-01",
			categoryId: "work",
			children: [
				{ id: "c", text: "Child", body: "", status: "done", priority: 0, assignee: null, doneAt: "2026-10-02T10:00:00Z", due: "2026-10-31", createdAt: null },
				{ id: "late", text: "Late", body: "", status: "todo", priority: 0, assignee: null, doneAt: null, due: "2026-11-01", createdAt: null },
			],
		});
		const entries = october({ todos: list([parent, todo({ id: "none" })], [todo({ id: "archived", due: "2026-10-05" })]) });
		expect(entries).toEqual([
			{ kind: "todo", day: "2026-10-01", at: null, todoId: "p", categoryId: "work", text: "Todo", done: false },
			{ kind: "todo", day: "2026-10-31", at: null, todoId: "c", categoryId: "work", text: "Child", done: true },
		]);
	});

	test("tickets show on their due date, untimed before the day's routine runs", () => {
		const entries = october({ tickets: [ticket({ dueDate: "2026-10-14" }), ticket({ id: "ENG-2", dueDate: null })], routines: [routine({ enabled: false, runs: [run("2026-10-14T09:00:00+02:00")] })] });
		expect(entries.map(entry => entry.kind)).toEqual(["ticket", "routine"]);
	});
});

describe("Google events", () => {
	const event = (when: CalendarEvent["when"], eventId = "one", writable = true): CalendarEvent => ({
		account: "google-calendar", calendarId: "personal", eventId, writable, title: "Birthday", calendar: "Personal", color: "#4285f4", url: "https://calendar.google.com/calendar/event?eid=one", when,
	});

	test("an all-day event spanning the previous month and the next shows once on every day of October", () => {
		const entries = october({ events: [event({ allDay: true, firstDay: "2026-09-30", lastDay: "2026-11-02" })] });
		expect(entries.filter(entry => entry.kind === "event").map(entry => entry.day)).toEqual(
			Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`),
		);
	});

	test("a timed event crossing midnight shows on both days but ends before a midnight boundary", () => {
		const entries = october({
			events: [
				event({ allDay: false, start: at("2026-10-24T23:30:00+02:00"), end: at("2026-10-25T01:30:00+02:00") }),
				event({ allDay: false, start: at("2026-10-26T23:00:00+01:00"), end: at("2026-10-27T00:00:00+01:00") }, "two"),
			],
		});
		expect(entries.map(entry => [entry.day, entry.at])).toEqual([
			["2026-10-24", at("2026-10-24T23:30:00+02:00")],
			["2026-10-25", null],
			["2026-10-26", at("2026-10-26T23:00:00+01:00")],
		]);
	});

	test("an event of a calendar you may write to is deleted by its account, its calendar's id, and its own, and one of a calendar you may only read cannot be", () => {
		const day = { allDay: true, firstDay: "2026-10-09", lastDay: "2026-10-09" } as const;
		const entries = october({ events: [event(day), event(day, "team", false)] });
		expect(entries.map(entry => entry.kind === "event" && [entry.event.id, entry.event.source.ref])).toEqual([
			['["google-calendar","personal"]/one', { kind: "google", account: "google-calendar", calendarId: "personal", eventId: "one" }],
			['["google-calendar","personal"]/team', null],
		]);
	});
});

describe("events kept on this computer", () => {
	const local = (when: LocalEvent["when"], id = "e1"): LocalEvent => ({ id, title: "Dentist", when });

	test("an all-day event spanning the previous month and the next shows once on every day of October", () => {
		const entries = october({ localEvents: [local({ allDay: true, firstDay: "2026-09-28", lastDay: "2026-11-03" })] });
		expect(entries.map(entry => [entry.kind, entry.day, entry.at])).toEqual(Array.from({ length: 31 }, (_, i) => ["event", `2026-10-${String(i + 1).padStart(2, "0")}`, null]));
	});

	test("a timed event shows on its local day, at its start, beside a Google event of the same day, in slate as on this computer", () => {
		const google: CalendarEvent = { account: "google-calendar", calendarId: "personal", eventId: "one", writable: true, title: "Birthday", calendar: "Personal", color: "#4285f4", url: "https://calendar.google.com/calendar/event?eid=one", when: { allDay: true, firstDay: "2026-10-09", lastDay: "2026-10-09" } };
		const entries = october({ events: [google], localEvents: [local({ allDay: false, start: at("2026-10-08T23:30:00Z"), end: at("2026-10-09T00:15:00Z") })] });
		expect(entries).toEqual([
			{ kind: "event", day: "2026-10-09", at: null, event: { id: '["google-calendar","personal"]/one', title: "Birthday", when: { allDay: true, firstDay: "2026-10-09", lastDay: "2026-10-09" }, color: "#4285f4", place: "Personal", source: { kind: "google", url: "https://calendar.google.com/calendar/event?eid=one", ref: { kind: "google", account: "google-calendar", calendarId: "personal", eventId: "one" } } } },
			{ kind: "event", day: "2026-10-09", at: at("2026-10-09T01:30:00+02:00"), event: { id: "e1", title: "Dentist", when: { allDay: false, start: at("2026-10-08T23:30:00Z"), end: at("2026-10-09T00:15:00Z") }, color: "#64748b", place: "This computer", source: { kind: "local", ref: { kind: "local", id: "e1" } } } },
		]);
	});
});

describe("the new event's calendars", () => {
	const account = (name: string): GoogleAccount => ({ name, address: `${name}@example.com`, addressError: null, connection: { kind: "signed-out", server: { name, url: "https://calendarmcp.googleapis.com/mcp/v1", host: "calendarmcp.googleapis.com" } }, workspaces: [] });
	const calendar = (account: string, id: string, group: GoogleCalendar["group"] = "mine"): GoogleCalendar => ({ account, id, name: id, color: "#4285f4", group, writable: true, shown: true, error: null });
	const choices = calendarChoices([calendar("google-calendar", "team", "other"), calendar("google-calendar", "me"), calendar("google-calendar-2", "team")], [account("google-calendar"), account("google-calendar-2")]);
	const named = (choice: { label: string }) => choice.label;

	test("go account by account, yours first in each, each named with its account's address, then this computer", () => {
		expect(choices.map(named)).toEqual(["me · google-calendar@example.com", "team · google-calendar@example.com", "team · google-calendar-2@example.com", "This computer"]);
	});

	test("the kept choice is the one its value names, and the same calendar of two accounts stays apart", () => {
		expect(named(keptChoice(choices, choices[2]!.value))).toBe("team · google-calendar-2@example.com");
		expect(named(keptChoice(choices, "local"))).toBe("This computer");
	});

	test("a value kept from before accounts names its calendar in the first account offering it, and an unknown one the first choice", () => {
		expect(named(keptChoice(choices, "google:team"))).toBe("team · google-calendar@example.com");
		expect(named(keptChoice(choices, "google:gone"))).toBe("me · google-calendar@example.com");
	});
});
