/**
 * The bar above the Tickets page's list: a tab per kind of workflow state; **Filter**, a submenu per field it filters
 * by; **Display**, its grouping; and under them a chip per filter that leaves something out.
 */
import { IconBox, IconCalendar4, IconCalendarClock4, IconCircleDashed, IconSpeedHigh, IconTag, IconUserGroup } from "central-icons";
import type { Ticket } from "../../../src/shared/tickets";
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
	type TicketDisplay,
	type TicketFilter,
	teamOptions,
	VIEW_PRESETS,
	withoutFilters,
} from "../../tickets-filter";
import { DisplayButton, dayField, type FilterField, GroupingSubmenu, ListFilterBar, setField, ViewTabs } from "../list-filter-bar";

/** Each field of **Filter**, in menu order, counted over the issues the tab keeps; **Team** only while the issues come from several teams. */
function filterFields(tickets: readonly Ticket[], filter: TicketFilter, onFilter: (filter: TicketFilter) => void): FilterField[] {
	const set = (change: Partial<TicketFilter>): void => onFilter({ ...filter, ...change });
	const shown = inView(tickets, filter.view);
	return [
		setField({ id: "status", label: "Status", icon: IconCircleDashed, control: "tickets.filter.status", noun: "statuses", options: statusOptions(shown, filter.statuses), checked: filter.statuses, onChecked: statuses => set({ statuses }) }),
		setField({ id: "priority", label: "Priority", icon: IconSpeedHigh, control: "tickets.filter.priority", noun: "priorities", options: priorityOptions(shown), checked: filter.priorities, onChecked: priorities => set({ priorities }) }),
		setField({ id: "label", label: "Label", icon: IconTag, control: "tickets.filter.label", noun: "labels", options: labelOptions(shown, filter.labels), checked: filter.labels, onChecked: labels => set({ labels }) }),
		setField({ id: "project", label: "Project", icon: IconBox, control: "tickets.filter.project", noun: "projects", options: projectOptions(shown, filter.projects), checked: filter.projects, onChecked: projects => set({ projects }) }),
		...(offersTeams(tickets, filter)
			? [setField({ id: "team", label: "Team", icon: IconUserGroup, control: "tickets.filter.team", noun: "teams", options: teamOptions(shown, filter.teams), checked: filter.teams, onChecked: teams => set({ teams }) })]
			: []),
		dayField({ id: "created", label: "Created", icon: IconCalendar4, control: "tickets.filter.created", value: filter.created, onValue: created => set({ created }) }),
		dayField({ id: "updated", label: "Updated", icon: IconCalendarClock4, control: "tickets.filter.updated", value: filter.updated, onValue: updated => set({ updated }) }),
	];
}

interface TicketViewBarProps {
	tickets: readonly Ticket[];
	filter: TicketFilter;
	onFilter: (filter: TicketFilter) => void;
	display: TicketDisplay;
	onDisplay: (display: TicketDisplay) => void;
}

/** The tabs, **Filter** and **Display**, its grouping, at the end of their row, and under them a chip per filter that leaves something out. */
export function TicketViewBar({ tickets, filter, onFilter, display, onDisplay }: TicketViewBarProps) {
	return (
		<ListFilterBar
			tabs={<ViewTabs views={TICKET_VIEWS} labelOf={view => VIEW_PRESETS[view].label} picked={filter.view} control="tickets.view" onPick={view => onFilter({ ...filter, view })} />}
			fields={filterFields(tickets, filter, onFilter)}
			filtering={filters(filter)}
			controls={{ filter: "tickets.filter", clear: "tickets.filter.clear" }}
			onClearAll={() => onFilter(withoutFilters(filter))}
			display={
				<DisplayButton label="Display" control="tickets.display" active={display.grouping !== DEFAULT_DISPLAY.grouping}>
					<GroupingSubmenu groupings={GROUPINGS} labels={GROUPING_LABELS} value={display.grouping} control="tickets.display.grouping" onValue={grouping => onDisplay({ ...display, grouping })} />
				</DisplayButton>
			}
			// The list's own gap is 4px, so 4px more sets it 8px under the bar, as on Todo and Notifications.
			className="px-1 pb-1"
		/>
	);
}
