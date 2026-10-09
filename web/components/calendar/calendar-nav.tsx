import { Check } from "lucide-react";
import { useState } from "react";
import type { Routine } from "../../../src/routines";
import { type CalendarShownInput, callable, type GoogleCalendar, type GoogleStatus } from "../../../src/shared/accounts";
import { useCalendarMonth, useCalendarYear } from "@/components/kibo-ui/calendar";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { errorText, putJson } from "../../api";
import { calendarEventsStore, googleStore, integrationsStore, monthSpan } from "../../reads";
import { hashForCalendar, hashForRoutines } from "../../routing";

/** The page under the Calendar tab that is open: the calendar, or the Routines page on a routine or, `null`, the list; `null` for another page. */
export type CalendarTabPage = { kind: "calendar" } | { kind: "routines"; target: string | null } | null;

/** Google Calendar's own groups of its calendar list, in its sidebar's order. */
const CALENDAR_GROUPS = [
	{ group: "mine", label: "My calendars" },
	{ group: "other", label: "Other calendars" },
] as const satisfies readonly { group: GoogleCalendar["group"]; label: string }[];

/**
 * The calendars checked in Google Calendar's list, in its **My calendars** and **Other calendars**, each a checkbox in
 * its color that shows or hides its events on the Calendar page; nothing while the dashboard cannot call Google Calendar.
 */
function GoogleCalendarGroups() {
	const connection = integrationsStore.usePolling().read?.data.integrations["google-calendar"].connection;
	const connected = connection !== undefined && callable(connection);
	const calendars = googleStore.usePolling(null, connected).read?.data.calendars;
	const [month] = useCalendarMonth();
	const [year] = useCalendarYear();
	const [failure, setFailure] = useState<string | null>(null);
	const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
	if (!connected || !calendars) return null;

	const settle = (id: string): void =>
		setPending(current => {
			const next = new Map(current);
			next.delete(id);
			return next;
		});
	const toggle = async ({ id, name, shown }: GoogleCalendar): Promise<void> => {
		setFailure(null);
		setPending(current => new Map(current).set(id, !shown));
		try {
			const answer = await putJson<GoogleStatus>("/api/google/calendars", { id, shown: !shown } satisfies CalendarShownInput);
			const saved = answer.calendars.find(calendar => calendar.id === id);
			googleStore.update(status => ({
				...status,
				calendars: status.calendars.flatMap(calendar => calendar.id !== id ? [calendar] : saved ? [{ ...calendar, shown: saved.shown }] : []),
			}));
		} catch (err) {
			setFailure(`Cannot ${shown ? "hide" : "show"} ${name}: ${errorText(err)}`);
			settle(id);
			return;
		}
		await Promise.all([googleStore.refresh(), calendarEventsStore.refresh(monthSpan(year, month))]);
		settle(id);
	};

	return (
		<>
			{CALENDAR_GROUPS.map(({ group, label }) => {
				const listed = calendars.filter(calendar => calendar.group === group);
				return listed.length === 0 ? null : (
					<SidebarGroup key={group}>
						<SidebarGroupLabel>{label}</SidebarGroupLabel>
						<SidebarMenu aria-label={label}>
							{listed.map(calendar => {
								const busy = pending.has(calendar.id);
								const shown = pending.get(calendar.id) ?? calendar.shown;
								return (
									<SidebarMenuItem key={calendar.id} aria-busy={busy || undefined}>
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
 * The Calendar tab of the sidebar: the calendar, the Google calendars it can show, then every routine, then each one
 * by name, a paused one muted.
 */
export function CalendarNav({ routines, current }: { routines: Routine[]; current: CalendarTabPage }) {
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
			<GoogleCalendarGroups />
			<SidebarGroup>
				<SidebarGroupLabel>Routines</SidebarGroupLabel>
				<SidebarMenu aria-label="Routines">
					<SidebarMenuItem>{link(hashForRoutines(null), routine === null, "All")}</SidebarMenuItem>
					{routines.map(({ id, name, enabled }) => (
						<SidebarMenuItem key={id}>{link(hashForRoutines(id), routine === id, name, !enabled)}</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroup>
		</>
	);
}
