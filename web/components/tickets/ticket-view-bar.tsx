/**
 * The bar above the Tickets page's list: a tab per kind of workflow state; **Filter**, a submenu per field it filters
 * by; **Display**, its grouping; and under them a chip per filter that leaves something out.
 */
import { IconBox, IconCalendar4, IconCalendarClock4, IconCircleDashed, IconSpeedHigh, IconTag, IconUserGroup } from "central-icons";
import { useState } from "react";
import type { Ticket } from "../../../src/shared/tickets";
import { MenuRadioGroup, MenuRadioItem, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger } from "@/components/ui/menu";
import { activityControl } from "../../activity";
import { withToggled } from "../../list-filter";
import {
	DEFAULT_DISPLAY,
	filters,
	GROUPING_LABELS,
	GROUPINGS,
	inView,
	labelOptions,
	offersTeams,
	priorityOptions,
	projectOptions,
	statusOptions,
	TICKET_VIEWS,
	type TicketFilter,
	type TicketGrouping,
	teamOptions,
	VIEW_PRESETS,
	withoutFilters,
} from "../../tickets-filter";
import { useTicketsDisplay, useTicketsFilter } from "../../tickets-state";
import { DisplayButton, dayField, FilterChips, type FilterField, FilterMenu, setField, ViewTabs } from "../list-filter-bar";

/** Each field of **Filter**, in menu order, counted over the issues the tab keeps; **Team** only while the issues come from several teams. */
function filterFields(tickets: readonly Ticket[], filter: TicketFilter, setFilter: (filter: TicketFilter) => void): FilterField[] {
	const set = (change: Partial<TicketFilter>): void => setFilter({ ...filter, ...change });
	const shown = inView(tickets, filter.view);
	return [
		setField({
			id: "status",
			label: "Status",
			icon: IconCircleDashed,
			control: "tickets.filter.status",
			noun: "statuses",
			options: statusOptions(shown, filter.statuses),
			checked: filter.statuses,
			active: filter.statuses.size > 0,
			onToggle: status => set({ statuses: withToggled(filter.statuses, status) }),
			clear: () => set({ statuses: new Set() }),
		}),
		setField({
			id: "priority",
			label: "Priority",
			icon: IconSpeedHigh,
			control: "tickets.filter.priority",
			noun: "priorities",
			options: priorityOptions(shown),
			checked: filter.priorities,
			active: filter.priorities.size > 0,
			onToggle: priority => set({ priorities: withToggled(filter.priorities, priority) }),
			clear: () => set({ priorities: new Set() }),
		}),
		setField({
			id: "label",
			label: "Label",
			icon: IconTag,
			control: "tickets.filter.label",
			noun: "labels",
			options: labelOptions(shown, filter.labels),
			checked: filter.labels,
			active: filter.labels.size > 0,
			onToggle: label => set({ labels: withToggled(filter.labels, label) }),
			clear: () => set({ labels: new Set() }),
		}),
		setField({
			id: "project",
			label: "Project",
			icon: IconBox,
			control: "tickets.filter.project",
			noun: "projects",
			options: projectOptions(shown, filter.projects),
			checked: filter.projects,
			active: filter.projects.size > 0,
			onToggle: project => set({ projects: withToggled(filter.projects, project) }),
			clear: () => set({ projects: new Set() }),
		}),
		...(offersTeams(tickets, filter)
			? [
					setField({
						id: "team",
						label: "Team",
						icon: IconUserGroup,
						control: "tickets.filter.team",
						noun: "teams",
						options: teamOptions(shown, filter.teams),
						checked: filter.teams,
						active: filter.teams.size > 0,
						onToggle: team => set({ teams: withToggled(filter.teams, team) }),
						clear: () => set({ teams: new Set() }),
					}),
				]
			: []),
		dayField({ id: "created", label: "Created", icon: IconCalendar4, control: "tickets.filter.created", value: filter.created, onValue: created => set({ created }) }),
		dayField({ id: "updated", label: "Updated", icon: IconCalendarClock4, control: "tickets.filter.updated", value: filter.updated, onValue: updated => set({ updated }) }),
	];
}

/** **Display**: the grouping. */
function DisplayMenu() {
	const [display, setDisplay] = useTicketsDisplay();
	const [open, setOpen] = useState(false);
	return (
		<DisplayButton label="Display" control="tickets.display" active={display.grouping !== DEFAULT_DISPLAY.grouping} open={open} onOpenChange={setOpen}>
			<MenuSubmenu>
				<MenuSubmenuTrigger value={GROUPING_LABELS[display.grouping]}>Grouping</MenuSubmenuTrigger>
				<MenuSubmenuContent className="w-48">
					<MenuRadioGroup value={display.grouping} onValueChange={(grouping: TicketGrouping) => setDisplay({ ...display, grouping })}>
						{GROUPINGS.map(grouping => (
							<MenuRadioItem {...activityControl("tickets.display.grouping")} key={grouping} value={grouping} closeOnClick>
								{GROUPING_LABELS[grouping]}
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
				</MenuSubmenuContent>
			</MenuSubmenu>
		</DisplayButton>
	);
}

/** The tabs, **Filter** and **Display** at the end of their row, and under them a chip per filter that leaves something out. */
export function TicketViewBar({ tickets }: { tickets: readonly Ticket[] }) {
	const [filter, setFilter] = useTicketsFilter();
	const fields = filterFields(tickets, filter, setFilter);
	return (
		<div className="space-y-2 px-1">
			<div className="flex items-center gap-2">
				<ViewTabs views={TICKET_VIEWS} labelOf={view => VIEW_PRESETS[view].label} picked={filter.view} control="tickets.view" onPick={view => setFilter({ ...filter, view })} />
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					<FilterMenu fields={fields} active={filters(filter)} control="tickets.filter" />
					<DisplayMenu />
				</div>
			</div>
			<FilterChips fields={fields} clearControl="tickets.filter.clear" onClearAll={() => setFilter(withoutFilters(filter))} />
		</div>
	);
}
