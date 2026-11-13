import { IconArrowLeftRight, IconPlusLarge, IconTrashCan } from "central-icons";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import type { Routine } from "../../../src/routines";
import type { Bot } from "../../../src/shared/bots";
import type { EventRef, LocalEvent, LocalEventSpace } from "../../../src/shared/calendar";
import { otherSpace, type Space, type Spaces, spaceIs } from "../../../src/shared/workspaces";
import type { UserTodoList } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip } from "@/components/ui/tooltip";
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
import { putJson } from "../../api";
import { type Action, useAction } from "../../use-action";
import { type CalendarEntry, calendarEntries, routinesOf, todosIn } from "../../calendar-model";
import { eventLink, type NoticeLink } from "../../notice-model";
import { dateOfDay, localDay } from "../../../src/shared/days";
import { SPACE_LABELS } from "../../labels";
import { calendarEventsStore, localEventsStore, monthSpan, ticketsStore, useGoogleCalendars } from "../../reads";
import { hashForBotRoutine, hashForOpenTodo, hashForTickets } from "../../routing";
import { scheduleWords, timeWords } from "../../routines-model";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { useMinute } from "../../use-minute";
import { useCalendarRoutines } from "../../use-calendar-display";
import { PageFrame } from "../list-page";
import { offerUndo } from "../toaster";
import { NewEventDialog } from "./new-event";

const WEEKDAYS = daysForLocale("en-US", 1);
/** The entries a day cell shows before its **+N more**. */
const CELL_ENTRIES = 3;

/** The entry's dot, by what it is and how it went; an event's dot takes its color instead. */
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

/** Where the entry links; `null` for an event you kept on this computer, which has no page of its own. */
function entryLink(entry: CalendarEntry): NoticeLink | null {
	switch (entry.kind) {
		case "routine":
		case "routine-interval":
			return { href: hashForBotRoutine(entry.botId, { kind: "open", id: entry.routineId }), external: false };
		case "todo":
			return { href: hashForOpenTodo(entry.todoId, entry.categoryId), external: false };
		case "ticket":
			return { href: hashForTickets(entry.identifier), external: false };
		case "event": {
			const { source } = entry.event;
			return source.kind === "google" ? eventLink(null, source.url) : eventLink(source.sessionId, null);
		}
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
		case "event": {
			const { place, when, source } = entry.event;
			return when.allDay ? `${place}, all day` : source.kind === "google" ? `${place}, Google Calendar` : place;
		}
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

interface EntryLinkProps {
	entry: CalendarEntry;
	className: string;
	style?: CSSProperties;
	children: ReactNode;
}

/** An entry as a link to what it shows, a Google event in a new tab and a reminder an agent added in its session; an event you kept on this computer links nowhere. */
function EntryLink({ entry, className, style, children }: EntryLinkProps) {
	const link = entryLink(entry);
	if (link === null) {
		return (
			<div className={className} style={style}>
				{children}
			</div>
		);
	}
	return (
		<a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} className={className} style={style}>
			{children}
		</a>
	);
}

/** The entry's dot: by what it is and how it went, or an event's color. */
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

/** One line of a day cell: an all-day event as a band in its color, anything else as a dot and its text; a phone's cell shows dots instead. */
function CellEntry({ entry }: { entry: CalendarEntry }) {
	if (entry.kind === "event" && entry.event.when.allDay) {
		return (
			<EntryLink
				entry={entry}
				className="flex h-5 items-center rounded-sm bg-[color-mix(in_oklab,var(--event)_16%,transparent)] px-1.5 text-[11px] font-medium text-foreground hover:bg-[color-mix(in_oklab,var(--event)_26%,transparent)] max-phone:hidden"
				style={{ "--event": entry.event.color } as CSSProperties}
			>
				<span className="truncate">{entry.event.title}</span>
			</EntryLink>
		);
	}
	return (
		<EntryLink entry={entry} className="flex h-5 items-center gap-1.5 rounded-sm px-1 text-[11px] hover:bg-hover max-phone:hidden">
			<EntryDot entry={entry} />
			<EntryText entry={entry} />
		</EntryLink>
	);
}

/** Deletes the event `eventRef` names, named `title` in what it says when it cannot; one delete runs at a time. */
type EventDelete = Action<[eventRef: EventRef, title: string]>;

const sameEvent = (a: EventRef, b: EventRef): boolean =>
	a.kind === "local" ? b.kind === "local" && a.id === b.id : b.kind === "google" && a.account === b.account && a.calendarId === b.calendarId && a.eventId === b.eventId;

/** The button that deletes the event `eventRef` names, busy while it is the one deleting and off while another is. */
function DeleteEvent({ eventRef, title, remove }: { eventRef: EventRef; title: string; remove: EventDelete }) {
	const deleting = remove.state.kind === "pending" && sameEvent(remove.state.args[0], eventRef);
	return (
		<Tooltip content="Delete this event" side="left">
			<Button
				variant="ghost"
				size="icon-compact"
				className="mt-0.5 shrink-0"
				aria-label={`Delete ${title}`}
				loading={deleting}
				disabled={remove.pending && !deleting}
				onClick={() => remove.run(eventRef, title)}
			>
				<IconTrashCan />
			</Button>
		</Tooltip>
	);
}

/** Moves the event kept on this computer that `id` names, named `title` in what it says, to space `target`. */
type EventMove = Action<[id: string, title: string, target: Space]>;

/** The button that moves an event kept on this computer to space `to`, busy while it is the one moving. */
function MoveEvent({ id, title, to, move }: { id: string; title: string; to: Space; move: EventMove }) {
	const moving = move.state.kind === "pending" && move.state.args[0] === id;
	return (
		<Tooltip content={`Move to ${SPACE_LABELS[to]}`} side="left">
			<Button variant="ghost" size="icon-compact" className="mt-0.5 shrink-0" aria-label={`Move ${title} to ${SPACE_LABELS[to]}`} loading={moving} disabled={move.pending && !moving} onClick={() => move.run(id, title, to)}>
				<IconArrowLeftRight />
			</Button>
		</Tooltip>
	);
}

/** What a day's list does to its events: delete one, and move one kept on this computer to space `to`. */
interface EventActions {
	remove: EventDelete;
	move: EventMove;
	to: Space;
}

/**
 * A day's entries, each with what it is, as the day's list and a day's hover card show them; with `actions`, an event
 * kept on this computer or of a Google calendar you may write to has a delete button, and one kept on this computer a
 * button that moves it to the other space.
 */
function DayEntries({ entries, actions }: { entries: CalendarEntry[]; actions?: EventActions }) {
	return (
		<ul className="space-y-px">
			{entries.map(entry => (
				<li key={entryKey(entry)} className="flex items-start gap-1">
					<EntryLink entry={entry} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
						<EntryDot entry={entry} className="mt-[7px] size-2" />
						<span className="min-w-0 flex-1">
							<EntryText entry={entry} className="block text-sm" />
							<span className="block truncate text-xs text-muted-foreground">{entryDetail(entry)}</span>
						</span>
					</EntryLink>
					{actions && entry.kind === "event" && entry.event.source.kind === "local" && <MoveEvent id={entry.event.source.ref.id} title={entry.event.title} to={actions.to} move={actions.move} />}
					{actions && entry.kind === "event" && entry.event.source.ref && <DeleteEvent eventRef={entry.event.source.ref} title={entry.event.title} remove={actions.remove} />}
				</li>
			))}
		</ul>
	);
}

/** `1 item`, `3 items`: how many entries a day holds. */
const itemsWords = (count: number): string => (count === 1 ? "1 item" : `${count} items`);

/** The day's name, `Tuesday, October 6`, and how many entries it holds. */
function DayHeading({ day, count, className }: { day: Date; count: number; className?: string }) {
	return (
		<div className={cn("flex items-baseline justify-between gap-3", className)}>
			<h2 className="text-sm font-semibold">{day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h2>
			{count > 0 && <span className="text-xs text-muted-foreground tabular-nums">{itemsWords(count)}</span>}
		</div>
	);
}

/** The chosen day's entries beside the month. */
function DayList({ day, entries, actions }: { day: Date | null; entries: CalendarEntry[]; actions: EventActions }) {
	if (day === null) return <p className="px-2 text-sm text-muted-foreground">Choose a day to list everything on it.</p>;
	return (
		<section aria-label={day.toDateString()} className="space-y-2 lg:sticky lg:top-0 lg:self-start">
			<DayHeading day={day} count={entries.length} className="px-2" />
			{entries.length === 0 ? <p className="px-2 text-sm text-muted-foreground">Nothing on this day.</p> : <DayEntries entries={entries} actions={actions} />}
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

/** One day of the month: its number, its first entries and **+N more**, or on a phone their dots, and, while hovered, a card with all of them. */
function DayCell({ date, entries, today, selected, onSelect, className }: DayCellProps) {
	const cell = (
		<div
			onClick={() => onSelect(date)}
			className={cn("flex min-w-0 cursor-pointer flex-col gap-px p-1.5 transition-colors duration-150", selected ? "bg-accent" : "hover:bg-hover", className)}
		>
			<button
				type="button"
				aria-label={entries.length === 0 ? date.toDateString() : `${date.toDateString()}, ${itemsWords(entries.length)}`}
				aria-pressed={selected}
				aria-current={today ? "date" : undefined}
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
				<span className="self-start rounded-sm px-1 text-[11px] text-muted-foreground hover:bg-hover hover:text-foreground max-phone:hidden">
					+{entries.length - CELL_ENTRIES} more
				</span>
			)}
			{entries.length > 0 && (
				<span aria-hidden className="flex flex-wrap items-center gap-0.5 px-0.5 text-2xs leading-none text-muted-foreground tabular-nums phone:hidden">
					{entries.slice(0, CELL_ENTRIES).map(entry => (
						<EntryDot key={entryKey(entry)} entry={entry} />
					))}
					{entries.length > CELL_ENTRIES && `+${entries.length - CELL_ENTRIES}`}
				</span>
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
	/** Every Bot's routines; the page shows those of `bots`. */
	routines: Routine[];
	/** The Bots of the space on screen, `null` until they load. */
	bots: Bot[] | null;
	/** `null` until the server sends it; the page shows the todos of the space on screen. */
	todos: UserTodoList | null;
	/** The dashboard can read Linear, so tickets with a due date show. */
	ticketsShown: boolean;
	/** The space on screen, whose Google Calendar accounts, events kept on this computer, routine runs, and due todos the page shows, and which a new event kept here goes in. */
	space: Space;
	/** Which space each workspace is in, which places each todo. */
	spaces: Spaces;
}

/** A month of the Google events, events kept on this computer, routine runs, and due todos of `space`, and Linear tickets, with one day's list beside it. */
export function CalendarPage({ routines: allRoutines, bots, todos: allTodos, ticketsShown, space, spaces }: CalendarPageProps) {
	const routines = useMemo(() => routinesOf(allRoutines, bots), [allRoutines, bots]);
	const todos = useMemo(() => todosIn(allTodos, space, spaces), [allTodos, space, spaces]);
	const now = useMinute();
	const [showRoutines] = useCalendarRoutines();
	const [month, setMonth] = useCalendarMonth();
	const [year, setYear] = useCalendarYear();
	const [selected, setSelected] = useState<Date | null>(() => new Date(now));
	/** The day the new-event dialog opened on, while it is open. */
	const [newEventDay, setNewEventDay] = useState<string | null>(null);
	const tickets = ticketsStore.usePolling(null, ticketsShown).read?.data.tickets ?? null;
	const { connected, accounts } = useGoogleCalendars(space);
	const span = monthSpan(year, month);
	const eventsRead = calendarEventsStore.usePolling(span, connected);
	const read = eventsRead.read?.data.events;
	const events = useMemo(() => {
		const shown = new Set(accounts.map(account => account.name));
		return connected && read ? read.filter(event => shown.has(event.account)) : null;
	}, [connected, read, accounts]);
	const localRead = localEventsStore.usePolling();
	const allLocal = localRead.read?.data.events;
	const localEvents = useMemo(() => allLocal?.filter(spaceIs(space)) ?? null, [allLocal, space]);
	const byDay = useMemo(() => {
		const days = new Map<string, CalendarEntry[]>();
		for (const entry of calendarEntries({ routines: showRoutines ? routines : [], todos, tickets: ticketsShown ? tickets : null, events, localEvents }, year, month, now)) {
			const day = days.get(entry.day);
			if (day) day.push(entry);
			else days.set(entry.day, [entry]);
		}
		return days;
	}, [routines, showRoutines, todos, tickets, ticketsShown, events, localEvents, year, month, now]);
	const days = useMemo(() => gridDays(year, month), [year, month]);
	const shownDay = selected !== null && selected.getFullYear() === year && selected.getMonth() === month ? localDay(selected) : null;
	const today = new Date(now);
	const todayKey = localDay(today);

	const show = (date: Date): void => {
		setMonth(date.getMonth() as CalendarState["month"]);
		setYear(date.getFullYear());
		setSelected(date);
	};
	const openNewEvent = (): void => setNewEventDay(current => current ?? shownDay ?? todayKey);
	// Claims C even while the dialog is open, so the page's key never falls through to the App's Create ticket.
	useShortcuts({ calendarNewEvent: openNewEvent });
	/** Deletes the event `eventRef` names, then shows the day without it: an event kept on this computer at once, and a Google event once its month is read again. */
	const remove = useAction(async (eventRef: EventRef, _title: string) => {
		await putJson<object>("/api/calendar/events/delete", eventRef);
		switch (eventRef.kind) {
			case "local":
				localEventsStore.update(answer => ({ events: answer.events.filter(event => event.id !== eventRef.id) }));
				break;
			case "google":
				await calendarEventsStore.refresh(span);
				break;
			default: {
				const unhandled: never = eventRef;
				return unhandled;
			}
		}
	}, null);
	const to = otherSpace(space);
	/** Moves the event kept on this computer that `id` names to space `target`, which leaves it off the other space's page at once, with **Undo** to move it back. */
	const move = useAction(async (id: string, title: string, target: Space): Promise<void> => {
		await putJson<object>("/api/calendar/events/space", { id, space: target } satisfies LocalEventSpace);
		localEventsStore.update(answer => ({ events: answer.events.map(event => (event.id === id ? { ...event, space: target } : event)) }));
		offerUndo("event-move", `Moved “${title}” to ${SPACE_LABELS[target]}`, () => move.run(id, title, otherSpace(target)));
	}, null);
	/** Shows a new event, which starts on `day`: one kept on this computer at once, and one added to Google Calendar once its month is read again. */
	const created = (day: string, kept: LocalEvent | null): void => {
		const date = dateOfDay(day);
		if (kept) localEventsStore.update(answer => ({ events: [...answer.events, kept] }));
		else void calendarEventsStore.refresh(monthSpan(date.getFullYear(), date.getMonth()));
		setNewEventDay(null);
		show(date);
	};

	const failures: string[] = [];
	if (connected && eventsRead.error) failures.push(`Cannot read Google Calendar: ${eventsRead.error}`);
	if (localRead.error) failures.push(`Cannot read the events on this computer: ${localRead.error}`);
	if (remove.state.kind === "failed") failures.push(`Cannot delete ${remove.state.args[1]}: ${remove.state.error}`);
	if (move.state.kind === "failed") failures.push(`Cannot move ${move.state.args[1]} to ${SPACE_LABELS[move.state.args[2]]}: ${move.state.error}`);
	return (
		<PageFrame title="Calendar" meta={[showRoutines && "Routine runs", connected && "Google events", "events on this computer", "due todos", ticketsShown && "Linear tickets"].filter(Boolean).join(", ")}>
			{failures.map(failure => (
				<p key={failure} role="alert" className="px-6 pt-4 text-sm text-red-600 dark:text-red-400">
					{failure}
				</p>
			))}
			<div className="grid gap-6 px-6 py-6 max-phone:grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_19rem]">
				<CalendarProvider className="overflow-hidden rounded-xl border border-border bg-background">
					<CalendarDate className="max-phone:flex-wrap max-phone:gap-y-1">
						<CalendarDatePicker className="gap-0">
							<CalendarMonthPicker />
							<CalendarYearPicker start={today.getFullYear() - 1} end={today.getFullYear() + 2} />
						</CalendarDatePicker>
						<div className="flex items-center gap-1 max-phone:ms-auto">
							<Tooltip content="Add an event to Google Calendar or this computer" shortcut={shortcutLabels("calendarNewEvent")} side="bottom">
								<Button variant="tertiary" leadingIcon={IconPlusLarge} onClick={openNewEvent} className="max-phone:size-11 max-phone:px-0">
									<span className="max-phone:sr-only">New event</span>
								</Button>
							</Tooltip>
							<Button variant="tertiary" onClick={() => show(today)} className="max-phone:h-11">
								Today
							</Button>
							<CalendarDatePagination className="gap-0 max-phone:[&_button]:size-11" />
						</div>
					</CalendarDate>
					<div className="grid grid-cols-7 border-y border-border">
						{WEEKDAYS.map(weekday => (
							<div key={weekday} className="px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase max-phone:px-0 max-phone:text-center">
								{weekday}
							</div>
						))}
					</div>
					<div className="grid auto-rows-[minmax(7.5rem,auto)] grid-cols-7 max-phone:auto-rows-[minmax(3.5rem,auto)]">
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
				<DayList day={shownDay === null ? null : selected} entries={shownDay === null ? [] : (byDay.get(shownDay) ?? [])} actions={{ remove, move, to }} />
			</div>
			{newEventDay !== null && <NewEventDialog day={newEventDay} space={space} onClose={() => setNewEventDay(null)} onCreated={created} />}
		</PageFrame>
	);
}
