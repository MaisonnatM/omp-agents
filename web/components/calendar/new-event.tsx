import { useState } from "react";
import { errorText } from "../../../src/json";
import { type EventWhen, type GoogleCalendar, type LocalEvent, MAX_EVENT_TITLE, type NewEvent, type NewEventAnswer, type NewEventCalendar } from "../../../src/shared/calendar";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { putJson } from "../../api";
import { dateOfDay, localDay, minutesOfTimeInput, timeInputValue } from "../../days";
import { useGoogleCalendars } from "../../reads";
import { chordLabel } from "../../shortcuts";
import { ERROR_TEXT, FormDialog, FormDialogHeader, isSubmitChord, type Submit } from "../form-dialog";

/** The calendar the last new event went in, as its {@link CalendarChoice} `value`. */
const LAST_CALENDAR_KEY = "omp-agents.new-event-calendar";

const FIELD = "h-7 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const LAST_MINUTE = 23 * 60 + 59;

/** A calendar the picker offers, by the `<option>` value that names it. */
interface CalendarChoice {
	value: string;
	label: string;
	calendar: NewEventCalendar;
}

const LOCAL_CHOICE: CalendarChoice = { value: "local", label: "This computer", calendar: { kind: "local" } };

/** The picker's choices: the shown Google calendars you may write to, yours first, then this computer. */
function calendarChoices(calendars: GoogleCalendar[]): CalendarChoice[] {
	const writable = calendars.filter(calendar => calendar.shown && calendar.writable);
	const mineFirst = [...writable.filter(calendar => calendar.group === "mine"), ...writable.filter(calendar => calendar.group === "other")];
	return [...mineFirst.map(({ id, name }): CalendarChoice => ({ value: `google:${id}`, label: name, calendar: { kind: "google", calendarId: id } })), LOCAL_CHOICE];
}

/** Epoch ms of `minutes` after the local midnight that starts `day`. */
function atMinutes(day: string, minutes: number): number {
	const date = dateOfDay(day);
	date.setMinutes(minutes);
	return date.getTime();
}

/** A new event's start on `day`: the next whole hour when `day` is today, else 9:00; in minutes after midnight. */
const defaultStart = (day: string, now: Date): number => (day === localDay(now) ? Math.min(now.getHours() + 1, 23) * 60 : 9 * 60);

interface Times {
	/** The first day of an all-day event, or a timed event's day; `""` while cleared. */
	day: string;
	lastDay: string;
	/** `HH:MM`, or `""` while cleared. */
	start: string;
	end: string;
}

/** When the form's fields say the event happens, or what is wrong with them. */
function eventWhen(allDay: boolean, { day, lastDay, start, end }: Times): EventWhen | { error: string } {
	if (day === "") return { error: allDay ? "Pick the first day." : "Pick the day." };
	if (allDay) {
		if (lastDay === "") return { error: "Pick the last day." };
		return lastDay < day ? { error: "The last day comes before the first." } : { allDay: true, firstDay: day, lastDay };
	}
	const [from, to] = [minutesOfTimeInput(start), minutesOfTimeInput(end)];
	if (from === null || to === null) return { error: "Pick a start and an end time." };
	return to <= from ? { error: "The event ends before it starts." } : { allDay: false, start: atMinutes(day, from), end: atMinutes(day, to) };
}

interface NewEventDialogProps {
	/** The day the event starts on, `YYYY-MM-DD`, until another is picked. */
	day: string;
	onClose: () => void;
	/** The event was added: its first day, and the event as kept on this computer, or `null` for one added to a Google calendar. */
	onCreated: (day: string, kept: LocalEvent | null) => void;
}

/**
 * The Calendar page's new-event dialog: a title, all day or a start and end time, and the calendar it goes in, a Google
 * calendar you may write to or this computer, the last one used first.
 */
export function NewEventDialog({ day: initialDay, onClose, onCreated }: NewEventDialogProps) {
	const { calendars } = useGoogleCalendars();
	const [title, setTitle] = useState("");
	const [allDay, setAllDay] = useState(false);
	const [times, setTimes] = useState<Times>(() => {
		const start = defaultStart(initialDay, new Date());
		return { day: initialDay, lastDay: initialDay, start: timeInputValue(start), end: timeInputValue(Math.min(start + 60, LAST_MINUTE)) };
	});
	const [picked, setPicked] = useState<string | null>(() => localStorage.getItem(LAST_CALENDAR_KEY));
	const [submit, setSubmit] = useState<Submit>({ kind: "writing" });

	const choices = calendarChoices(calendars ?? []);
	const choice = choices.find(candidate => candidate.value === picked) ?? choices[0]!;
	const when = eventWhen(allDay, times);
	const creating = submit.kind === "creating";
	const ready = title.trim() !== "" && !("error" in when) && !creating;

	const setDay = (day: string): void => setTimes(current => ({ ...current, day, lastDay: day !== "" && current.lastDay < day ? day : current.lastDay }));
	/** Moves the start, and the end with it, so the event keeps its length. */
	const setStart = (start: string): void =>
		setTimes(current => {
			const [from, was, to] = [minutesOfTimeInput(start), minutesOfTimeInput(current.start), minutesOfTimeInput(current.end)];
			const end = from === null || was === null || to === null ? current.end : timeInputValue(Math.min(Math.max(to + from - was, 0), LAST_MINUTE));
			return { ...current, start, end };
		});

	const create = async (): Promise<void> => {
		if (!ready || "error" in when) return;
		setSubmit({ kind: "creating" });
		let kept: LocalEvent | null;
		try {
			({ kept } = await putJson<NewEventAnswer>("/api/calendar/events/new", { title: title.trim(), when, calendar: choice.calendar } satisfies NewEvent));
		} catch (err) {
			setSubmit({ kind: "failed", error: errorText(err) });
			return;
		}
		localStorage.setItem(LAST_CALENDAR_KEY, choice.value);
		onCreated(times.day, kept);
	};

	return (
		<FormDialog busy={creating} onClose={onClose} className="top-[15%] w-[min(32rem,calc(100vw-2rem))]">
			<form
				className="flex min-h-0 flex-1 flex-col"
				onSubmit={event => {
					event.preventDefault();
					void create();
				}}
				onKeyDown={event => {
					if (!isSubmitChord(event)) return;
					event.preventDefault();
					void create();
				}}
			>
				<FormDialogHeader title="New event" busy={creating} />
				<div className="flex flex-col gap-3 px-5 pt-3 pb-4">
					<input
						autoFocus
						aria-label="Title"
						placeholder="Event title"
						maxLength={MAX_EVENT_TITLE}
						value={title}
						readOnly={creating}
						onChange={event => setTitle(event.target.value)}
						className="bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground/70 read-only:opacity-60"
					/>
					<label className="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={allDay} disabled={creating} onChange={event => setAllDay(event.target.checked)} className="size-4 accent-current" />
						All day
					</label>
					{allDay ? (
						<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							<label className="flex items-center gap-2">
								From
								<input type="date" aria-label="First day" value={times.day} disabled={creating} onChange={event => setDay(event.target.value)} className={FIELD} />
							</label>
							<label className="flex items-center gap-2">
								to
								<input
									type="date"
									aria-label="Last day"
									value={times.lastDay}
									min={times.day || undefined}
									disabled={creating}
									onChange={event => {
										const lastDay = event.target.value;
										setTimes(current => ({ ...current, lastDay }));
									}}
									className={FIELD}
								/>
							</label>
						</div>
					) : (
						<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							<input type="date" aria-label="Day" value={times.day} disabled={creating} onChange={event => setDay(event.target.value)} className={FIELD} />
							<input type="time" aria-label="Start time" value={times.start} disabled={creating} onChange={event => setStart(event.target.value)} className={`${FIELD} tabular-nums`} />
							to
							<input
								type="time"
								aria-label="End time"
								value={times.end}
								disabled={creating}
								onChange={event => {
									const end = event.target.value;
									setTimes(current => ({ ...current, end }));
								}}
								className={`${FIELD} tabular-nums`}
							/>
						</div>
					)}
					{"error" in when && (
						<p role="alert" className={ERROR_TEXT}>
							{when.error}
						</p>
					)}
					<label className="flex items-center gap-2 text-sm text-muted-foreground">
						Calendar
						<select value={choice.value} disabled={creating} onChange={event => setPicked(event.target.value)} className={FIELD}>
							{choices.map(({ value, label }) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					{submit.kind === "failed" && (
						<p role="alert" className={ERROR_TEXT}>
							{submit.error}
						</p>
					)}
				</div>
				<div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
					<Tooltip content="Create event" shortcut={[chordLabel({ key: "Enter", mod: true })]} side="top" disabled={!ready}>
						<Button type="submit" size="compact" className="rounded-full" loading={creating} disabled={!ready}>
							Create event
						</Button>
					</Tooltip>
				</div>
			</form>
		</FormDialog>
	);
}
