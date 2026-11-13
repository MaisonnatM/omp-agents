/** The sidebar's Calendar tab: the calendar, the Google calendars it can show by account, and whether it shows routine runs (`CalendarNav`). */
import { IconCheckmark1 } from "central-icons";
import { type CalendarShownInput, calendarKey, type GoogleCalendar, type GoogleStatus } from "../../../src/shared/calendar";
import type { Space } from "../../../src/shared/workspaces";
import { useCalendarMonth, useCalendarYear } from "@/components/kibo-ui/calendar";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { putJson } from "../../api";
import { activityControl } from "../../activity";
import { calendarEventsStore, googleStore, monthSpan, useGoogleCalendars } from "../../reads";
import { hashForCalendar } from "../../routing";
import { useAction } from "../../use-action";
import { useCalendarRoutines } from "../../use-calendar-display";

/** Google Calendar's own groups of its calendar list, in its sidebar's order. */
const CALENDAR_GROUPS = [
	{ group: "mine", label: "My calendars" },
	{ group: "other", label: "Other calendars" },
] as const satisfies readonly { group: GoogleCalendar["group"]; label: string }[];

/**
 * The calendars checked in the Google Calendar lists of the accounts `space` shows, each account under its address
 * when there are several, in Google Calendar's **My calendars** and **Other calendars**, each a checkbox in its color
 * that shows or hides its events on the Calendar page; nothing while the dashboard cannot call Google Calendar.
 */
function GoogleCalendarGroups({ space }: { space: Space }) {
	const { calendars, accounts } = useGoogleCalendars(space);
	if (!calendars) return null;

	return (
		<>
			{accounts.flatMap(account => {
				const own = calendars.filter(calendar => calendar.account === account.name);
				const owner = accounts.length > 1 ? (account.address ?? account.name) : null;
				return CALENDAR_GROUPS.map(({ group, label }) => {
					const listed = own.filter(calendar => calendar.group === group);
					const heading = owner === null ? label : `${label} · ${owner}`;
					return listed.length === 0 ? null : (
						<SidebarGroup key={`${account.name}/${group}`}>
							<SidebarGroupLabel title={heading}>
								<span className="truncate">{heading}</span>
							</SidebarGroupLabel>
							<SidebarMenu aria-label={heading}>
								{listed.map(calendar => (
									<CalendarItem key={calendarKey(calendar.account, calendar.id)} calendar={calendar} />
								))}
							</SidebarMenu>
						</SidebarGroup>
					);
				});
			})}
		</>
	);
}

/** One calendar's checkbox, showing the state it was asked for until Google Calendar answers, and why it could not change below it. */
function CalendarItem({ calendar }: { calendar: GoogleCalendar }) {
	const [month] = useCalendarMonth();
	const [year] = useCalendarYear();
	const { account, id, name } = calendar;
	const toggle = useAction(async (shown: boolean) => {
		const key = calendarKey(account, id);
		const answer = await putJson<GoogleStatus>("/api/google/calendars", { account, id, shown } satisfies CalendarShownInput);
		const saved = answer.calendars.find(listed => calendarKey(listed.account, listed.id) === key);
		googleStore.update(status => ({
			...status,
			calendars: status.calendars.flatMap(listed => (calendarKey(listed.account, listed.id) !== key ? [listed] : saved ? [{ ...listed, shown: saved.shown }] : [])),
		}));
		await Promise.all([googleStore.refresh(), calendarEventsStore.refresh(monthSpan(year, month))]);
	}, null);
	const shown = toggle.state.kind === "pending" ? toggle.state.args[0] : calendar.shown;
	return (
		<SidebarMenuItem aria-busy={toggle.pending || undefined}>
			<SidebarMenuButton
				role="checkbox"
				aria-checked={shown}
				aria-disabled={toggle.pending || undefined}
				title={name}
				onClick={() => toggle.run(!shown)}
			>
				<span
					aria-hidden
					className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-2"
					style={{ borderColor: calendar.color, backgroundColor: shown ? calendar.color : undefined }}
				>
					{shown && <IconCheckmark1 className="size-2.5 text-white" />}
				</span>
				<span className="truncate">{name}</span>
			</SidebarMenuButton>
			{toggle.state.kind === "failed" && (
				<p role="alert" className="px-3 text-xs text-red-600 dark:text-red-400">
					Cannot {toggle.state.args[0] ? "show" : "hide"} {name}: {toggle.state.error}
				</p>
			)}
		</SidebarMenuItem>
	);
}

/**
 * The Calendar tab of the sidebar: the calendar, active while `open`, the Google calendars of the accounts `space`
 * shows, then whether the calendar shows routine runs.
 */
export function CalendarNav({ open, space }: { open: boolean; space: Space }) {
	const [showRoutines, setShowRoutines] = useCalendarRoutines();
	return (
		<>
			<SidebarGroup>
				<SidebarMenu aria-label="Calendar">
					<SidebarMenuItem>
						<SidebarMenuButton asChild isActive={open}>
							<a href={hashForCalendar()} aria-current={open ? "page" : undefined}>
								<span className="truncate">Calendar</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroup>
			<GoogleCalendarGroups space={space} />
			<SidebarGroup>
				<SidebarGroupLabel>Routines</SidebarGroupLabel>
				<SidebarMenu aria-label="Routines">
					<SidebarMenuItem>
						<SidebarMenuButton asChild>
							<label>
								<input
									type="checkbox"
									checked={showRoutines}
									onChange={event => setShowRoutines(event.target.checked)}
									className="size-3.5 shrink-0 accent-primary"
									{...activityControl("calendar.routines.toggle")}
								/>
								<span>Show routines</span>
							</label>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroup>
		</>
	);
}
