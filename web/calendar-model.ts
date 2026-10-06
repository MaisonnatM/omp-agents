/** What the Calendar page shows on each day of a month: Google events, routine runs, past and planned, and todos and tickets on the day they are due. */
import { nextDueAt, type Routine, type RoutineRun } from "../src/routines";
import type { CalendarEvent } from "../src/shared/accounts";
import type { Ticket, TicketStatusType } from "../src/shared/tickets";
import type { UserTodoList } from "../src/user-todos-shared";
import { daysBetween, localDay } from "./days";

/** One thing on one day; `day` is the local day, `YYYY-MM-DD`, and `at` its time, `null` for one without. */
export type CalendarEntry =
	/** A run that happened, or a slot the schedule will run. */
	| { kind: "routine"; day: string; at: number; routineId: string; name: string; state: "ran" | "failed" | "planned" }
	/** A routine that runs more than once a day, shown once per day instead of once per run. */
	| { kind: "routine-interval"; day: string; at: null; routineId: string; name: string; minutes: number }
	| { kind: "todo"; day: string; at: null; todoId: string; categoryId: string | null; text: string; done: boolean }
	| { kind: "ticket"; day: string; at: null; identifier: string; title: string; status: string; statusType: TicketStatusType }
	/** One day of a Google event, timed on its first day; an event across days shows on each. */
	| { kind: "event"; day: string; at: number | null; event: CalendarEvent };

export interface CalendarSources {
	routines: Routine[];
	/** `null` until the server sends it. */
	todos: UserTodoList | null;
	/** `null` while Linear is not connected or not read yet. */
	tickets: Ticket[] | null;
	/** `null` while Google Calendar is not connected or not read yet. */
	events: CalendarEvent[] | null;
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

/** The days of `event` from `first` through `last`, the month's first and last days. */
function eventEntries(event: CalendarEvent, first: string, last: string): CalendarEntry[] {
	const { when } = event;
	const start = when.allDay ? when.firstDay : localDay(when.start);
	const end = when.allDay ? when.lastDay : localDay(when.end - 1);
	return daysBetween(start < first ? first : start, end > last ? last : end).map(day => ({ kind: "event", day, at: when.allDay || day !== start ? null : when.start, event }));
}

/** Everything the month of `year` and `month` (0 for January) holds, by day, then by time with the untimed first. */
export function calendarEntries({ routines, todos, tickets, events }: CalendarSources, year: number, month: number, now: number): CalendarEntry[] {
	const from = new Date(year, month, 1).getTime();
	const to = new Date(year, month + 1, 1).getTime();
	const [first, end] = [localDay(from), localDay(to)];
	const inMonth = (day: string | null): day is string => day !== null && day >= first && day < end;
	const entries = [...routines.flatMap(routine => routineEntries(routine, from, to, now)), ...(events ?? []).flatMap(event => eventEntries(event, first, localDay(to - 1)))];
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
