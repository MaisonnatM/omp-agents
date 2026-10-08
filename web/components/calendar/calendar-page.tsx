import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import type { Routine } from "../../../src/routines";
import { callable } from "../../../src/shared/accounts";
import type { UserTodoList } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
	CalendarDate,
	CalendarDatePagination,
	CalendarDatePicker,
	CalendarMonthPicker,
	CalendarProvider,
	type CalendarState,
	CalendarYearPicker,
	daysForLocale,
	useCalendarMonth,
	useCalendarYear,
} from "@/components/kibo-ui/calendar";
import { cn } from "@/lib/utils";
import { type CalendarEntry, calendarEntries } from "../../calendar-model";
import { localDay } from "../../days";
import { calendarEventsStore, integrationsStore, monthSpan, ticketsStore } from "../../reads";
import { hashForRoutines, hashForTickets, hashForTodo } from "../../routing";
import { scheduleWords, timeWords } from "../../routines-model";
import { useMinute } from "../../use-minute";
import { PageFrame } from "../list-page";

const WEEKDAYS = daysForLocale("en-US", 1);
/** The entries a day cell shows before its **+N more**. */
const CELL_ENTRIES = 3;

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

/** What the entry is called: a routine's name, a todo's text, `ENG-12 Ship it`, or an event's title. */
function entryName(entry: CalendarEntry): string {
	switch (entry.kind) {
		case "routine":
		case "routine-interval":
			return entry.name;
		case "todo":
			return entry.text;
		case "ticket":
			return `${entry.identifier} ${entry.title}`;
		case "event":
			return entry.event.title;
	}
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

/** An entry as a link to what it shows; a Google event opens in a new tab. */
function EntryLink({ entry, className, style, children }: { entry: CalendarEntry; className: string; style?: CSSProperties; children: ReactNode }) {
	const external = entry.kind === "event";
	return (
		<a href={entryHref(entry)} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className={className} style={style}>
			{children}
		</a>
	);
}

/** The entry's dot: by what it is and how it went, or a Google event's calendar color. */
function EntryDot({ entry, className }: { entry: CalendarEntry; className?: string }) {
	return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dotClass(entry), className)} style={entry.kind === "event" ? { backgroundColor: entry.event.color } : undefined} />;
}

/** The entry's time, `9:00`, and its name, muted for a run still to come and struck through once closed. */
function EntryText({ entry, className }: { entry: CalendarEntry; className?: string }) {
	const at = entry.at === null ? null : new Date(entry.at);
	return (
		<span className={cn("min-w-0 truncate", isClosed(entry) ? "text-muted-foreground line-through" : entry.kind === "routine" && entry.state === "planned" ? "text-muted-foreground" : "text-foreground", className)}>
			{at && <span className="mr-1 text-muted-foreground tabular-nums">{timeWords({ hour: at.getHours(), minute: at.getMinutes() })}</span>}
			{entryName(entry)}
		</span>
	);
}

/** One line of a day cell: an all-day Google event as a band in its calendar's color, anything else as a dot and its text. */
function CellEntry({ entry }: { entry: CalendarEntry }) {
	if (entry.kind === "event" && entry.event.when.allDay) {
		return (
			<EntryLink
				entry={entry}
				className="flex h-5 items-center rounded-sm bg-[color-mix(in_oklab,var(--event)_16%,transparent)] px-1.5 text-[11px] font-medium text-foreground hover:bg-[color-mix(in_oklab,var(--event)_26%,transparent)]"
				style={{ "--event": entry.event.color } as CSSProperties}
			>
				<span className="truncate">{entry.event.title}</span>
			</EntryLink>
		);
	}
	return (
		<EntryLink entry={entry} className="flex h-5 items-center gap-1.5 rounded-sm px-1 text-[11px] hover:bg-hover">
			<EntryDot entry={entry} />
			<EntryText entry={entry} />
		</EntryLink>
	);
}

/** A day's entries, each with what it is, as the day's list and a day's hover card show them. */
function DayEntries({ entries }: { entries: CalendarEntry[] }) {
	return (
		<ul className="space-y-px">
			{entries.map(entry => (
				<li key={entryKey(entry)}>
					<EntryLink entry={entry} className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
						<EntryDot entry={entry} className="mt-[7px] size-2" />
						<span className="min-w-0 flex-1">
							<EntryText entry={entry} className="block text-sm" />
							<span className="block truncate text-xs text-muted-foreground">{entryDetail(entry)}</span>
						</span>
					</EntryLink>
				</li>
			))}
		</ul>
	);
}

/** The day's name, `Tuesday, October 6`, and how many entries it holds. */
function DayHeading({ day, count, className }: { day: Date; count: number; className?: string }) {
	return (
		<div className={cn("flex items-baseline justify-between gap-3", className)}>
			<h2 className="text-sm font-semibold">{day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h2>
			{count > 0 && <span className="text-xs text-muted-foreground tabular-nums">{count === 1 ? "1 item" : `${count} items`}</span>}
		</div>
	);
}

/** The chosen day's entries beside the month. */
function DayList({ day, entries }: { day: Date | null; entries: CalendarEntry[] }) {
	if (day === null) return <p className="px-2 text-sm text-muted-foreground">Choose a day to list everything on it.</p>;
	return (
		<section aria-label={day.toDateString()} className="space-y-2 lg:sticky lg:top-0 lg:self-start">
			<DayHeading day={day} count={entries.length} className="px-2" />
			{entries.length === 0 ? <p className="px-2 text-sm text-muted-foreground">Nothing on this day.</p> : <DayEntries entries={entries} />}
		</section>
	);
}

interface DayCellProps {
	date: Date;
	entries: CalendarEntry[];
	today: boolean;
	selected: boolean;
	onSelect: (date: Date) => void;
	className: string;
}

/** One day of the month: its number, its first entries and **+N more**, and, while hovered, a card with all of them. */
function DayCell({ date, entries, today, selected, onSelect, className }: DayCellProps) {
	const cell = (
		<div className={cn("flex min-w-0 flex-col gap-px p-1.5 transition-colors duration-150", selected ? "bg-accent" : "hover:bg-hover", className)}>
			<button
				type="button"
				aria-label={date.toDateString()}
				aria-pressed={selected}
				aria-current={today ? "date" : undefined}
				onClick={() => onSelect(date)}
				className={cn(
					"mb-0.5 flex size-6 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
					today ? "bg-foreground font-semibold text-background" : selected ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
				)}
			>
				{date.getDate()}
			</button>
			{entries.slice(0, CELL_ENTRIES).map(entry => (
				<CellEntry key={entryKey(entry)} entry={entry} />
			))}
			{entries.length > CELL_ENTRIES && (
				<button type="button" onClick={() => onSelect(date)} className="self-start rounded-sm px-1 text-[11px] text-muted-foreground hover:bg-hover hover:text-foreground">
					+{entries.length - CELL_ENTRIES} more
				</button>
			)}
		</div>
	);
	if (entries.length === 0) return cell;
	return (
		<HoverCard openDelay={350} closeDelay={100}>
			<HoverCardTrigger asChild>{cell}</HoverCardTrigger>
			<HoverCardContent side="right" align="start" sideOffset={6} collisionPadding={12} className="w-80 p-0">
				<DayHeading day={date} count={entries.length} className="px-3.5 pt-3 pb-1.5" />
				<div className="max-h-80 overflow-y-auto px-1.5 pb-1.5">
					<DayEntries entries={entries} />
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}

/** The days of the month's weeks, Monday first, the neighboring months' days filling its first and last weeks. */
function gridDays(year: number, month: number): Date[] {
	const lead = (new Date(year, month, 1).getDay() + 6) % 7;
	const weeks = Math.ceil((lead + new Date(year, month + 1, 0).getDate()) / 7);
	return Array.from({ length: weeks * 7 }, (_, index) => new Date(year, month, 1 - lead + index));
}

interface CalendarPageProps {
	routines: Routine[];
	/** `null` until the server sends it. */
	todos: UserTodoList | null;
	/** The dashboard can read Linear, so tickets with a due date show. */
	ticketsShown: boolean;
}

/** A month of Google events, routine runs, and due todos and Linear tickets, with one day's list beside it. */
export function CalendarPage({ routines, todos, ticketsShown }: CalendarPageProps) {
	const now = useMinute();
	const [month, setMonth] = useCalendarMonth();
	const [year, setYear] = useCalendarYear();
	const [selected, setSelected] = useState<Date | null>(() => new Date(now));
	const tickets = ticketsStore.usePolling(null, ticketsShown).read?.data.tickets ?? null;
	const googleConnection = integrationsStore.usePolling().read?.data.integrations["google-calendar"].connection;
	const connected = googleConnection !== undefined && callable(googleConnection);
	const eventsRead = calendarEventsStore.usePolling(monthSpan(year, month), connected);
	const events = connected ? (eventsRead.read?.data.events ?? null) : null;
	const byDay = useMemo(() => {
		const days = new Map<string, CalendarEntry[]>();
		for (const entry of calendarEntries({ routines, todos, tickets: ticketsShown ? tickets : null, events }, year, month, now)) {
			const day = days.get(entry.day);
			if (day) day.push(entry);
			else days.set(entry.day, [entry]);
		}
		return days;
	}, [routines, todos, tickets, ticketsShown, events, year, month, now]);
	const days = useMemo(() => gridDays(year, month), [year, month]);
	const shownDay = selected !== null && selected.getFullYear() === year && selected.getMonth() === month ? localDay(selected) : null;
	const today = new Date(now);
	const todayKey = localDay(today);
	return (
		<PageFrame title="Calendar" meta={["Routine runs", connected && "Google events", "due todos", ticketsShown && "Linear tickets"].filter(Boolean).join(", ")}>
			{connected && eventsRead.error && <p role="alert" className="px-6 pt-4 text-sm text-red-600 dark:text-red-400">Cannot read Google Calendar: {eventsRead.error}</p>}
			<div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
				<CalendarProvider className="overflow-hidden rounded-xl border border-border bg-background">
					<CalendarDate>
						<CalendarDatePicker className="gap-0">
							<CalendarMonthPicker />
							<CalendarYearPicker start={today.getFullYear() - 1} end={today.getFullYear() + 2} />
						</CalendarDatePicker>
						<div className="flex items-center gap-1">
							<Button
								variant="tertiary"
								onClick={() => {
									setMonth(today.getMonth() as CalendarState["month"]);
									setYear(today.getFullYear());
									setSelected(today);
								}}
							>
								Today
							</Button>
							<CalendarDatePagination className="gap-0" />
						</div>
					</CalendarDate>
					<div className="grid grid-cols-7 border-y border-border">
						{WEEKDAYS.map(weekday => (
							<div key={weekday} className="px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
								{weekday}
							</div>
						))}
					</div>
					<div className="grid auto-rows-[minmax(7.5rem,auto)] grid-cols-7">
						{days.map((date, index) => {
							const day = localDay(date);
							const edges = cn(index % 7 !== 6 && "border-r", index < days.length - 7 && "border-b", "border-border");
							return date.getMonth() === month ? (
								<DayCell key={day} date={date} entries={byDay.get(day) ?? []} today={day === todayKey} selected={day === shownDay} onSelect={setSelected} className={edges} />
							) : (
								<div key={day} aria-hidden className={cn("bg-muted/40 p-1.5", edges)}>
									<span className="flex size-6 items-center justify-center text-xs text-muted-foreground/50 tabular-nums">{date.getDate()}</span>
								</div>
							);
						})}
					</div>
				</CalendarProvider>
				<DayList day={shownDay === null ? null : selected} entries={shownDay === null ? [] : (byDay.get(shownDay) ?? [])} />
			</div>
		</PageFrame>
	);
}
