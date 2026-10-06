import { type ReactNode, useMemo, useState } from "react";
import type { Routine } from "../../../src/routines";
import type { UserTodoList } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import {
	CalendarBody,
	CalendarDate,
	CalendarDatePagination,
	CalendarDatePicker,
	CalendarHeader,
	CalendarMonthPicker,
	CalendarProvider,
	type CalendarState,
	CalendarYearPicker,
	type Feature,
	useCalendarMonth,
	useCalendarYear,
} from "@/components/kibo-ui/calendar";
import { cn } from "@/lib/utils";
import { type CalendarEntry, calendarEntries } from "../../calendar-model";
import { localDay } from "../../days";
import { calendarEventsStore, googleStore, ticketsStore } from "../../reads";
import { hashForRoutines, hashForTickets, hashForTodo } from "../../routing";
import { scheduleWords, timeWords } from "../../routines-model";
import { useMinute } from "../../use-minute";
import { PageFrame } from "../list-page";

/** The entry's dot, by what it is and how it went. */
function dotClass(entry: CalendarEntry): string {
	switch (entry.kind) {
		case "routine":
			return entry.state === "ran" ? "bg-emerald-500" : entry.state === "failed" ? "bg-red-500" : "border border-muted-foreground";
		case "routine-interval":
			return "border border-muted-foreground";
		case "todo":
			return "bg-violet-500";
		case "ticket":
			return "bg-amber-500";
		case "event":
			return "";
	}
}

/** A checked todo, or a ticket Linear counts as done or canceled, which reads muted and struck through. */
const isClosed = (entry: CalendarEntry): boolean =>
	(entry.kind === "todo" && entry.done) || (entry.kind === "ticket" && (entry.statusType === "completed" || entry.statusType === "canceled"));

function entryHref(entry: CalendarEntry): string {
	switch (entry.kind) {
		case "routine":
		case "routine-interval":
			return hashForRoutines(entry.routineId);
		case "todo":
			return hashForTodo(entry.categoryId === null ? { kind: "all" } : { kind: "category", id: entry.categoryId });
		case "ticket":
			return hashForTickets(entry.identifier);
		case "event":
			return entry.event.url;
	}
}

/** What the entry is called, after its time when it has one: `9:00 Notes`, a todo's text, `ENG-12 Ship it`. */
function entryLabel(entry: CalendarEntry): string {
	const name =
		entry.kind === "routine" || entry.kind === "routine-interval"
			? entry.name
			: entry.kind === "todo"
				? entry.text
				: entry.kind === "ticket"
					? `${entry.identifier} ${entry.title}`
					: entry.event.title;
	if (entry.at === null) return name;
	const date = new Date(entry.at);
	return `${timeWords({ hour: date.getHours(), minute: date.getMinutes() })} ${name}`;
}

/** What the day's list says under the label: how a run went, how often a routine runs, or where the item comes from. */
function entryDetail(entry: CalendarEntry): string {
	switch (entry.kind) {
		case "routine":
			return entry.state === "ran" ? "Routine ran" : entry.state === "failed" ? "Routine failed" : "Routine planned";
		case "routine-interval":
			return `Routine, ${scheduleWords({ kind: "every", minutes: entry.minutes }).toLowerCase()}`;
		case "todo":
			return entry.done ? "Todo, done" : "Todo due";
		case "ticket":
			return `Linear ticket due, ${entry.status}`;
		case "event":
			return `${entry.event.calendar}, ${entry.event.when.allDay ? "all day" : "Google Calendar"}`;
	}
}

function entryKey(entry: CalendarEntry): string {
	switch (entry.kind) {
		case "routine":
			return `routine:${entry.routineId}:${entry.at}`;
		case "routine-interval":
			return `interval:${entry.routineId}:${entry.day}`;
		case "todo":
			return `todo:${entry.todoId}`;
		case "ticket":
			return `ticket:${entry.identifier}`;
		case "event":
			return `event:${entry.event.id}:${entry.day}`;
	}
}

/** An entry as a link to what it shows, its dot, then `children`: the label in a day cell, the label and detail in the day's list. A Google event opens in a new tab, in its calendar's color. */
function EntryLink({ entry, className, dotClassName, children }: { entry: CalendarEntry; className: string; dotClassName?: string; children: ReactNode }) {
	const event = entry.kind === "event" ? entry.event : null;
	return (
		<a
			href={entryHref(entry)}
			target={event ? "_blank" : undefined}
			rel={event ? "noreferrer" : undefined}
			title={`${entryLabel(entry)}\n${entryDetail(entry)}`}
			className={cn("flex min-w-0 gap-1.5 hover:bg-accent", className)}
		>
			<span aria-hidden className={cn("size-2 shrink-0 rounded-full", dotClass(entry), dotClassName)} style={event ? { backgroundColor: event.color } : undefined} />
			{children}
		</a>
	);
}

/** The chosen day's entries, each with what it is, beside the month. */
function DayList({ day, entries }: { day: Date | null; entries: CalendarEntry[] }) {
	if (day === null) return <p className="text-sm text-muted-foreground">Choose a day to list everything on it.</p>;
	return (
		<section aria-label={day.toDateString()} className="space-y-3">
			<h2 className="text-sm font-medium">{day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h2>
			{entries.length === 0 ? (
				<p className="text-sm text-muted-foreground">Nothing on this day.</p>
			) : (
				<ul className="space-y-1">
					{entries.map(entry => (
						<li key={entryKey(entry)}>
							<EntryLink entry={entry} className="items-start gap-2 rounded-md px-2 py-1.5" dotClassName="mt-1.5">
								<span className="min-w-0">
									<span className={cn("block truncate text-sm", isClosed(entry) && "text-muted-foreground line-through")}>{entryLabel(entry)}</span>
									<span className="block text-xs text-muted-foreground">{entryDetail(entry)}</span>
								</span>
							</EntryLink>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

interface CalendarPageProps {
	routines: Routine[];
	/** `null` until the server sends it. */
	todos: UserTodoList | null;
	/** omp is signed in to Linear, so tickets with a due date show. */
	ticketsShown: boolean;
}

/** A month of Google events, routine runs, and due todos and Linear tickets, with one day's list beside it. */
export function CalendarPage({ routines, todos, ticketsShown }: CalendarPageProps) {
	const now = useMinute();
	const [month, setMonth] = useCalendarMonth();
	const [year, setYear] = useCalendarYear();
	const [selected, setSelected] = useState<Date | null>(() => new Date(now));
	const tickets = ticketsStore.usePolling(null, ticketsShown).read?.data.tickets ?? null;
	const connected = googleStore.usePolling().read?.data.connected ?? false;
	const span = new URLSearchParams({ from: new Date(year, month, 1).toISOString(), to: new Date(year, month + 1, 1).toISOString() }).toString();
	const eventsRead = calendarEventsStore.usePolling(span, connected);
	const events = connected ? (eventsRead.read?.data.events ?? null) : null;
	const entries = useMemo(
		() => calendarEntries({ routines, todos, tickets: ticketsShown ? tickets : null, events }, year, month, now),
		[routines, todos, tickets, ticketsShown, events, year, month, now],
	);
	const features = useMemo(
		(): Feature[] =>
			entries.map(entry => {
				const at = new Date(entry.at ?? `${entry.day}T00:00`);
				return { id: entryKey(entry), name: entryLabel(entry), startAt: at, endAt: at, status: { id: entry.kind, name: entry.kind, color: "" } };
			}),
		[entries],
	);
	const byKey = useMemo(() => new Map(entries.map(entry => [entryKey(entry), entry])), [entries]);
	const shownDay = selected !== null && selected.getFullYear() === year && selected.getMonth() === month ? selected : null;
	const today = new Date(now);
	return (
		<PageFrame
			title="Calendar"
			meta={["Routine runs", connected && "Google events", "due todos", ticketsShown && "Linear tickets"].filter(Boolean).join(", ")}
			actions={
				<Button
					variant="secondary"
					size="compact"
					onClick={() => {
						setMonth(today.getMonth() as CalendarState["month"]);
						setYear(today.getFullYear());
						setSelected(today);
					}}
				>
					Today
				</Button>
			}
		>
			{connected && eventsRead.error && <p role="alert" className="px-6 pt-4 text-sm text-red-600 dark:text-red-400">Cannot read Google Calendar: {eventsRead.error}</p>}
			<div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
				<CalendarProvider startDay={1} className="rounded-lg border border-border">
					<CalendarDate>
						<CalendarDatePicker>
							<CalendarMonthPicker />
							<CalendarYearPicker start={today.getFullYear() - 1} end={today.getFullYear() + 2} />
						</CalendarDatePicker>
						<CalendarDatePagination />
					</CalendarDate>
					<CalendarHeader />
					<CalendarBody features={features} selectedDay={shownDay} onSelectDay={setSelected}>
						{({ feature }) => {
							const entry = byKey.get(feature.id);
							return (
								entry && (
									<EntryLink key={feature.id} entry={entry} className={cn("items-center rounded px-1 py-0.5 text-foreground", isClosed(entry) && "text-muted-foreground line-through")}>
										<span className="truncate">{entryLabel(entry)}</span>
									</EntryLink>
								)
							);
						}}
					</CalendarBody>
				</CalendarProvider>
				<DayList day={shownDay} entries={shownDay ? entries.filter(entry => entry.day === localDay(shownDay)) : []} />
			</div>
		</PageFrame>
	);
}
