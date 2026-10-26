/** The sidebar's Calendar tab: the calendar, the Google calendars it can show by account, and every routine (`CalendarNav`). */
import { Check } from "lucide-react";
import { useState } from "react";
import type { Routine } from "../../../src/routines";
import { type CalendarShownInput, calendarKey, type GoogleCalendar, type GoogleStatus } from "../../../src/shared/calendar";
import { useCalendarMonth, useCalendarYear } from "@/components/kibo-ui/calendar";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { errorText } from "../../../src/json";
import { putJson } from "../../api";
import { activityControl } from "../../activity";
import { calendarEventsStore, googleStore, monthSpan, useGoogleCalendars } from "../../reads";
import { hashForCalendar, hashForRoutines } from "../../routing";
import { useCalendarRoutines } from "../../use-calendar-display";

/** The page under the Calendar tab that is open: the calendar, or the Routines page on a routine or, `null`, the list; `null` for another page. */
export type CalendarTabPage = { kind: "calendar" } | { kind: "routines"; target: string | null } | null;

/** Google Calendar's own groups of its calendar list, in its sidebar's order. */
const CALENDAR_GROUPS = [
	{ group: "mine", label: "My calendars" },
	{ group: "other", label: "Other calendars" },
] as const satisfies readonly { group: GoogleCalendar["group"]; label: string }[];

/**
 * The calendars checked in the Google Calendar lists of the accounts `workspace` shows, each account under its address
 * when there are several, in Google Calendar's **My calendars** and **Other calendars**, each a checkbox in its color
 * that shows or hides its events on the Calendar page; nothing while the dashboard cannot call Google Calendar.
 */
function GoogleCalendarGroups({ workspace }: { workspace: string | null }) {
	const { calendars, accounts } = useGoogleCalendars(workspace);
	const [month] = useCalendarMonth();
	const [year] = useCalendarYear();
	const [failure, setFailure] = useState<string | null>(null);
	const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
	if (!calendars) return null;

	const settle = (key: string): void =>
		setPending(current => {
			const next = new Map(current);
			next.delete(key);
			return next;
		});
	const toggle = async (calendar: GoogleCalendar): Promise<void> => {
		const { account, id, name, shown } = calendar;
		const key = calendarKey(account, id);
		setFailure(null);
		setPending(current => new Map(current).set(key, !shown));
		try {
			const answer = await putJson<GoogleStatus>("/api/google/calendars", { account, id, shown: !shown } satisfies CalendarShownInput);
			const saved = answer.calendars.find(listed => calendarKey(listed.account, listed.id) === key);
			googleStore.update(status => ({
				...status,
				calendars: status.calendars.flatMap(listed => (calendarKey(listed.account, listed.id) !== key ? [listed] : saved ? [{ ...listed, shown: saved.shown }] : [])),
			}));
		} catch (err) {
			setFailure(`Cannot ${shown ? "hide" : "show"} ${name}: ${errorText(err)}`);
			settle(key);
			return;
		}
		await Promise.all([googleStore.refresh(), calendarEventsStore.refresh(monthSpan(year, month))]);
		settle(key);
	};

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
								{listed.map(calendar => {
									const key = calendarKey(calendar.account, calendar.id);
									const busy = pending.has(key);
									const shown = pending.get(key) ?? calendar.shown;
									return (
										<SidebarMenuItem key={key} aria-busy={busy || undefined}>
											<SidebarMenuButton
												role="checkbox"
												aria-checked={shown}
												aria-disabled={busy || undefined}
												title={calendar.name}
												onClick={() => {
													if (!busy) void toggle({ ...calendar, shown });
												}}
											>
												<span
													aria-hidden
													className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-2"
													style={{ borderColor: calendar.color, backgroundColor: shown ? calendar.color : undefined }}
												>
													{shown && <Check className="size-2.5 text-white" strokeWidth={3.5} />}
												</span>
												<span className="truncate">{calendar.name}</span>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroup>
					);
				});
			})}
			{failure && (
				<p role="alert" className="px-3 text-xs text-red-600 dark:text-red-400">
					{failure}
				</p>
			)}
		</>
	);
}

/**
 * The Calendar tab of the sidebar: the calendar, the Google calendars of the accounts `workspace` shows, then every
 * routine, then each one by name, a paused one muted.
 */
export function CalendarNav({ routines, current, workspace }: { routines: Routine[]; current: CalendarTabPage; workspace: string | null }) {
	const [showRoutines, setShowRoutines] = useCalendarRoutines();
	const link = (href: string, active: boolean, name: string, muted = false) => (
		<SidebarMenuButton asChild isActive={active}>
			<a href={href} aria-current={active ? "page" : undefined}>
				<span className={muted ? "truncate text-muted-foreground" : "truncate"}>{name}</span>
			</a>
		</SidebarMenuButton>
	);
	const routine = current?.kind === "routines" ? current.target : undefined;
	return (
		<>
			<SidebarGroup>
				<SidebarMenu aria-label="Calendar">
					<SidebarMenuItem>{link(hashForCalendar(), current?.kind === "calendar", "Calendar")}</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroup>
			<GoogleCalendarGroups workspace={workspace} />
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
					<SidebarMenuItem>{link(hashForRoutines(null), routine === null, "All")}</SidebarMenuItem>
					{routines.map(({ id, name, enabled }) => (
						<SidebarMenuItem key={id}>{link(hashForRoutines(id), routine === id, name, !enabled)}</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroup>
		</>
	);
}
