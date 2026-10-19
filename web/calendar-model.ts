/**
 * What the Calendar page shows on each day of a month: Google events and events kept on this computer, routine runs,
 * past and planned, and todos and tickets on the day they are due. Also the calendars a new event may go in.
 */
import { nextDueAt, type Routine, type RoutineRun } from "../src/routines";
import type { GoogleAccount } from "../src/shared/accounts";
import { type CalendarEvent, calendarKey, type EventWhen, type GoogleCalendar, type GoogleEventRef, type LocalEvent, type LocalEventRef, type NewEventCalendar } from "../src/shared/calendar";
import type { Ticket, TicketStatusType } from "../src/shared/tickets";
import type { UserTodoList } from "../src/user-todos-shared";
import { daysBetween, localDay } from "./days";

/** The one color of the events kept on this computer, a neutral slate. */
const LOCAL_EVENT_COLOR = "#64748b";

/** An event as the page shows it, from one of your Google calendars or kept on this computer. */
export interface ShownEvent {
	/** Unique among the shown events: a Google event's account, calendar id, and its own, slash-separated, or a kept event's id. */
	id: string;
	title: string;
	when: EventWhen;
	/** Its calendar's color, `#rrggbb`. */
	color: string;
	/** Where it lives: its Google calendar's name, or `This computer`. */
	place: string;
	/**
	 * Where it lives: a Google event's page in Google Calendar, or this computer, with the `ref` that deletes it; `null`
	 * for an event of a Google calendar you may only read.
	 */
	source: { kind: "google"; url: string; ref: GoogleEventRef | null } | { kind: "local"; ref: LocalEventRef };
}

/** One thing on one day; `day` is the local day, `YYYY-MM-DD`, and `at` its time, `null` for one without. */
export type CalendarEntry =
	/** A run that happened, or a slot the schedule will run. */
	| { kind: "routine"; day: string; at: number; routineId: string; name: string; state: "ran" | "failed" | "planned" }
	/** A routine that runs more than once a day, shown once per day instead of once per run. */
	| { kind: "routine-interval"; day: string; at: null; routineId: string; name: string; minutes: number }
	| { kind: "todo"; day: string; at: null; todoId: string; categoryId: string | null; text: string; done: boolean }
	| { kind: "ticket"; day: string; at: null; identifier: string; title: string; status: string; statusType: TicketStatusType }
	/** One day of an event, timed on its first day; an event across days shows on each. */
	| { kind: "event"; day: string; at: number | null; event: ShownEvent };

export interface CalendarSources {
	routines: Routine[];
	/** `null` until the server sends it. */
	todos: UserTodoList | null;
	/** `null` while Linear is not connected or not read yet. */
	tickets: Ticket[] | null;
	/** `null` while Google Calendar is not connected or not read yet. */
	events: CalendarEvent[] | null;
	/** `null` until the server sends them. */
	localEvents: LocalEvent[] | null;
}

const DAY_MINUTES = 1440;

function runState(run: RoutineRun): "ran" | "failed" {
	if (run.errors.length > 0) return "failed";
	if (run.outcome.kind !== "command" || run.outcome.run.phase === "running") return "ran";
	const command = run.outcome.run;
	return command.phase === "exited" && command.code === 0 ? "ran" : "failed";
}

/**
 * `routine`'s runs and slots from `from` up to `to`. A slot that passed without a run runs at the next minute's check,
 * so it shows at `now`; each later slot counts from the one before, as the schedule counts from the last run.
 */
function routineEntries(routine: Routine, from: number, to: number, now: number): CalendarEntry[] {
	const { id: routineId, name } = routine;
	const intervals = routine.schedules.flatMap(schedule => (schedule.kind === "every" && schedule.minutes < DAY_MINUTES ? [schedule.minutes] : []));
	if (intervals.length > 0) {
		if (!routine.enabled) return [];
		const minutes = Math.min(...intervals);
		return daysBetween(localDay(Math.max(from, now)), localDay(to - 1)).map(day => ({ kind: "routine-interval", day, at: null, routineId, name, minutes }));
	}
	const entries: CalendarEntry[] = routine.runs
		.filter(run => run.at >= from && run.at < to)
		.map(run => ({ kind: "routine", day: localDay(run.at), at: run.at, routineId, name, state: runState(run) }));
	if (!routine.enabled) return entries;
	for (let after = routine.runs[0]?.at ?? routine.createdAt; ; ) {
		const at = Math.max(nextDueAt(routine.schedules, after), now);
		if (at >= to) break;
		if (at >= from) entries.push({ kind: "routine", day: localDay(at), at, routineId, name, state: "planned" });
		after = at;
	}
	return entries;
}

/** The days of an event that happens `when`, from `first` through `last`, the month's first and last days, a timed event's time on its first day. */
function eventDays(when: EventWhen, first: string, last: string): { day: string; at: number | null }[] {
	const start = when.allDay ? when.firstDay : localDay(when.start);
	const end = when.allDay ? when.lastDay : localDay(when.end - 1);
	return daysBetween(start < first ? first : start, end > last ? last : end).map(day => ({ day, at: when.allDay || day !== start ? null : when.start }));
}

/** Everything the month of `year` and `month` (0 for January) holds, by day, then by time with the untimed first. */
export function calendarEntries({ routines, todos, tickets, events, localEvents }: CalendarSources, year: number, month: number, now: number): CalendarEntry[] {
	const from = new Date(year, month, 1).getTime();
	const to = new Date(year, month + 1, 1).getTime();
	const [first, end] = [localDay(from), localDay(to)];
	const last = localDay(to - 1);
	const inMonth = (day: string | null): day is string => day !== null && day >= first && day < end;
	const shown: ShownEvent[] = [
		...(events ?? []).map(({ account, calendarId, eventId, writable, title, when, color, calendar, url }): ShownEvent => ({
			id: `${calendarKey(account, calendarId)}/${eventId}`,
			title,
			when,
			color,
			place: calendar,
			source: { kind: "google", url, ref: writable ? { kind: "google", account, calendarId, eventId } : null },
		})),
		...(localEvents ?? []).map(({ id, title, when }): ShownEvent => ({ id, title, when, color: LOCAL_EVENT_COLOR, place: "This computer", source: { kind: "local", ref: { kind: "local", id } } })),
	];
	const entries: CalendarEntry[] = [
		...routines.flatMap(routine => routineEntries(routine, from, to, now)),
		...shown.flatMap(event => eventDays(event.when, first, last).map((slot): CalendarEntry => ({ kind: "event", ...slot, event }))),
	];
	for (const todo of todos?.todos ?? []) {
		for (const item of [todo, ...todo.children]) {
			if (inMonth(item.due)) entries.push({ kind: "todo", day: item.due, at: null, todoId: item.id, categoryId: todo.categoryId, text: item.text, done: item.doneAt !== null });
		}
	}
	for (const ticket of tickets ?? []) {
		if (inMonth(ticket.dueDate)) entries.push({ kind: "ticket", day: ticket.dueDate, at: null, identifier: ticket.id, title: ticket.title, status: ticket.status, statusType: ticket.statusType });
	}
	return entries.sort((a, b) => (a.day === b.day ? (a.at ?? 0) - (b.at ?? 0) : a.day < b.day ? -1 : 1));
}

/** A calendar the new event dialog's picker offers, by the value that names it. */
export interface CalendarChoice {
	value: string;
	label: string;
	calendar: NewEventCalendar;
}

const LOCAL_CHOICE: CalendarChoice = { value: "local", label: "This computer", calendar: { kind: "local" } };

/**
 * The picker's choices: the shown Google calendars you may write to, account by account and yours first in each, then
 * this computer. With several accounts, each calendar's label names its account's address.
 */
export function calendarChoices(calendars: GoogleCalendar[], accounts: GoogleAccount[]): CalendarChoice[] {
	const writable = calendars.filter(calendar => calendar.shown && calendar.writable);
	const google = accounts.flatMap(account => {
		const own = writable.filter(calendar => calendar.account === account.name);
		const suffix = accounts.length > 1 ? ` · ${account.address ?? account.name}` : "";
		return [...own.filter(calendar => calendar.group === "mine"), ...own.filter(calendar => calendar.group === "other")].map(
			({ id, name }): CalendarChoice => ({ value: calendarKey(account.name, id), label: `${name}${suffix}`, calendar: { kind: "google", account: account.name, calendarId: id } }),
		);
	});
	return [...google, LOCAL_CHOICE];
}

/** How a value kept from before accounts starts: `google:<calendar id>`. */
const BEFORE_ACCOUNTS = "google:";

/**
 * The choice the kept value `kept` names, else the first. A value from before accounts names the calendar of its id in
 * the first account that offers it.
 */
export function keptChoice(choices: readonly CalendarChoice[], kept: string | null): CalendarChoice {
	const before = kept?.startsWith(BEFORE_ACCOUNTS) ? kept.slice(BEFORE_ACCOUNTS.length) : null;
	return choices.find(choice => choice.value === kept) ?? choices.find(({ calendar }) => calendar.kind === "google" && calendar.calendarId === before) ?? choices[0]!;
}
