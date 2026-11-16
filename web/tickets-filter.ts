/** What the Tickets page's list keeps and how it groups them: its tabs, **Filter**, search, and **Display**. */
import { isObject, isTexts, oneOf, parseJson } from "../src/json";
import { everyWord } from "../src/shared/every-word";
import type { Ticket, TicketPriority, TicketStatus, TicketStatusType } from "../src/shared/tickets";
import { countBy, countedOptions, type DayRange, type FilterOption, type GroupingDisplay, groupingDisplay, isDayRange, withinLast } from "./list-filter";
import { isPriorityKey, PRIORITY_LABEL, PRIORITY_ORDER, type PriorityKey, statusOrder, type TicketEntry, ticketGroups, ticketOrder } from "./tickets-model";

/** The tabs above the list, in order: every issue, then those of one kind of workflow state. */
export const TICKET_VIEWS = ["all", "active", "todo", "backlog"] as const;

export type TicketView = (typeof TICKET_VIEWS)[number];

/**
 * Each tab's name, the state type it keeps, `null` for every issue, and what the list says while it keeps none of
 * your issues. In Review is a started state, so **Active** keeps it.
 */
export const VIEW_PRESETS: Record<TicketView, { label: string; statusType: TicketStatusType | null; empty: string }> = {
	all: { label: "All", statusType: null, empty: "No issues are assigned to you." },
	active: { label: "Active", statusType: "started", empty: "No active issues are assigned to you." },
	todo: { label: "Todo", statusType: "unstarted", empty: "No issues in Todo are assigned to you." },
	backlog: { label: "Backlog", statusType: "backlog", empty: "No issues in Backlog are assigned to you." },
};

const isView = oneOf(TICKET_VIEWS);

/**
 * What the list keeps: the tab, and what **Filter** picked, which the tab ANDs with; an empty set keeps every status,
 * priority, label, project, or team, and `null` any date.
 */
export interface TicketFilter {
	view: TicketView;
	/** By status name. */
	statuses: ReadonlySet<string>;
	priorities: ReadonlySet<PriorityKey>;
	/** By label name: an issue wearing any of them. */
	labels: ReadonlySet<string>;
	/** By project name. */
	projects: ReadonlySet<string>;
	/** By team name. */
	teams: ReadonlySet<string>;
	created: DayRange | null;
	updated: DayRange | null;
}

export const NO_FILTER: TicketFilter = { view: "all", statuses: new Set(), priorities: new Set(), labels: new Set(), projects: new Set(), teams: new Set(), created: null, updated: null };

/** Whether **Filter** leaves anything out; the tab does not count, since it shows as the pressed tab rather than a chip. */
export const filters = ({ statuses, priorities, labels, projects, teams, created, updated }: TicketFilter): boolean =>
	statuses.size > 0 || priorities.size > 0 || labels.size > 0 || projects.size > 0 || teams.size > 0 || created !== null || updated !== null;

/** `filter` with nothing **Filter** picked, on the same tab. */
export const withoutFilters = (filter: TicketFilter): TicketFilter => ({ ...NO_FILTER, view: filter.view });

/** The stored filter, with {@link NO_FILTER}'s value for each part that is missing or unreadable. */
export function decodeFilter(raw: string | null): TicketFilter {
	const stored = parseJson(raw ?? "null");
	if (!isObject(stored)) return NO_FILTER;
	const { view, statuses, priorities, labels, projects, teams, created, updated } = stored;
	const texts = (value: unknown): ReadonlySet<string> => new Set(isTexts(value) ? value : []);
	return {
		view: isView(view) ? view : NO_FILTER.view,
		statuses: texts(statuses),
		priorities: new Set(isTexts(priorities) ? priorities.filter(isPriorityKey) : []),
		labels: texts(labels),
		projects: texts(projects),
		teams: texts(teams),
		created: isDayRange(created) ? created : null,
		updated: isDayRange(updated) ? updated : null,
	};
}

export const encodeFilter = ({ view, statuses, priorities, labels, projects, teams, created, updated }: TicketFilter): string =>
	JSON.stringify({ view, statuses: [...statuses], priorities: [...priorities], labels: [...labels], projects: [...projects], teams: [...teams], created, updated });

/** The tickets tab `view` keeps. */
export const inView = (tickets: readonly Ticket[], view: TicketView): readonly Ticket[] => {
	const { statusType } = VIEW_PRESETS[view];
	return statusType === null ? tickets : tickets.filter(ticket => ticket.statusType === statusType);
};

/** The statuses **Filter** offers, those of `tickets` in the groups' order with how many issues each holds, then each name of `checked` none holds, with none. */
export function statusOptions(tickets: readonly Ticket[], checked: ReadonlySet<string>): FilterOption[] {
	const byName = new Map<string, { status: TicketStatus; count: number }>();
	for (const { status, statusType } of tickets) {
		const seen = byName.get(status);
		if (seen) seen.count += 1;
		else byName.set(status, { status: { status, statusType }, count: 1 });
	}
	const listed = [...byName.values()].toSorted((a, b) => statusOrder(a.status, b.status)).map(({ status: { status }, count }) => ({ key: status, label: status, count }));
	return [...listed, ...[...checked].filter(name => !byName.has(name)).map(name => ({ key: name, label: name, count: 0 }))];
}

/** Every priority, urgent first and no priority last, with how many of `tickets` hold each. */
export function priorityOptions(tickets: readonly Ticket[]): FilterOption<PriorityKey>[] {
	const counts = countBy(tickets, ({ priority }) => [`${priority}`]);
	return PRIORITY_ORDER.map((priority): FilterOption<PriorityKey> => ({ key: `${priority}`, label: PRIORITY_LABEL[priority], count: counts.get(`${priority}`) ?? 0 }));
}

/** The labels **Filter** offers, of `tickets`, most worn first, then by name, and each of `checked` none wears. */
export const labelOptions = (tickets: readonly Ticket[], checked: ReadonlySet<string>): FilterOption[] => countedOptions(countBy(tickets, ({ labels }) => labels.map(({ name }) => name)), checked);

/** The projects **Filter** offers, of `tickets`, most first, then by name, and each of `checked` none is in. */
export const projectOptions = (tickets: readonly Ticket[], checked: ReadonlySet<string>): FilterOption[] => countedOptions(countBy(tickets, ({ project }) => (project === null ? [] : [project])), checked);

/** The teams **Filter** offers, of `tickets`, most first, then by name, and each of `checked` none is in. */
export const teamOptions = (tickets: readonly Ticket[], checked: ReadonlySet<string>): FilterOption[] => countedOptions(countBy(tickets, ({ team }) => [team]), checked);

/** Whether **Filter** offers **Team**: while `tickets` come from more than one team, or a team is still checked. */
export const offersTeams = (tickets: readonly Ticket[], filter: TicketFilter): boolean => filter.teams.size > 0 || new Set(tickets.map(({ team }) => team)).size > 1;

/**
 * The tickets the tab and **Filter** keep, whose identifier, title, labels, project, or team holds every word of
 * `query`, at `now` in ms. Each issue passes on its own, so a sub-issue whose parent the filter leaves out lists as a
 * row of its own.
 */
export function filteredTickets(tickets: readonly Ticket[], filter: TicketFilter, query: string, now: number): Ticket[] {
	const { statuses, priorities, labels, projects, teams, created, updated } = filter;
	const matches = everyWord(query);
	return inView(tickets, filter.view).filter(
		ticket =>
			(statuses.size === 0 || statuses.has(ticket.status)) &&
			(priorities.size === 0 || priorities.has(`${ticket.priority}`)) &&
			(labels.size === 0 || ticket.labels.some(({ name }) => labels.has(name))) &&
			(projects.size === 0 || (ticket.project !== null && projects.has(ticket.project))) &&
			(teams.size === 0 || teams.has(ticket.team)) &&
			withinLast(Date.parse(ticket.createdAt), created, now) &&
			withinLast(Date.parse(ticket.updatedAt), updated, now) &&
			matches([ticket.id, ticket.title, ...ticket.labels.map(({ name }) => name), ticket.project ?? "", ticket.team].join(" ")),
	);
}

/** The list's headings, in menu order: a status with its sub-issues nested, a priority, a project, or one list. */
export const GROUPINGS = ["status", "priority", "project", "none"] as const;

export type TicketGrouping = (typeof GROUPINGS)[number];

export const GROUPING_LABELS: Record<TicketGrouping, string> = { status: "Status", priority: "Priority", project: "Project", none: "No grouping" };

/** What **Display** sets: the grouping. */
export type TicketDisplay = GroupingDisplay<TicketGrouping>;

export const { DEFAULT_DISPLAY, decodeDisplay, encodeDisplay } = groupingDisplay(GROUPINGS, "status");

/** A group's heading: its title, and the status's or the priority's glyph it shows, or a project's. */
export type TicketHeading = { title: string } & ({ by: "status"; status: TicketStatus } | { by: "priority"; priority: TicketPriority } | { by: "project" });

/** A heading of the list and its rows; under no grouping the one group has no heading. */
export interface TicketListGroup {
	/** Under its grouping, which the browser keeps the folds by. */
	foldKey: string;
	heading: TicketHeading | null;
	entries: TicketEntry[];
	/** The rows the group shows, nested ones included. */
	count: number;
}

/** The title of the project heading of issues in none. */
const NO_PROJECT = "No project";

/**
 * A heading's fold key under `grouping`, which the browser keeps in localStorage: under the grouping by status the
 * status's name, as before there were groupings, else the grouping, `:`, and the heading's key, so a status named as
 * another grouping's heading is the only one to share its fold.
 */
export const groupFoldKey = (grouping: TicketGrouping, key: string): string => (grouping === "status" ? key : `${grouping}:${key}`);

/** `tickets` as flat rows, in {@link ticketOrder}. */
const flat = (tickets: readonly Ticket[]): TicketEntry[] => tickets.toSorted(ticketOrder).map(ticket => ({ ticket, subIssues: [] }));

/**
 * The list of `tickets` under `grouping`. By status, the groups of {@link ticketGroups}, sub-issues nested under their
 * listed parents; by priority, urgent first and no priority last; by project, by name, the issues in none last; under no
 * grouping, one group without a heading. Outside status, every issue is a row of its own, in {@link ticketOrder}, and a
 * grouping leaves out the headings with no issue.
 */
export function groupedTickets(grouping: TicketGrouping, tickets: readonly Ticket[]): TicketListGroup[] {
	switch (grouping) {
		case "status":
			return ticketGroups(tickets).map(({ status, statusType, entries, count }) => ({ foldKey: groupFoldKey("status", status), heading: { title: status, by: "status", status: { status, statusType } }, entries, count }));
		case "priority":
			return PRIORITY_ORDER.flatMap(priority => {
				const entries = flat(tickets.filter(ticket => ticket.priority === priority));
				return entries.length === 0 ? [] : [{ foldKey: groupFoldKey("priority", `${priority}`), heading: { title: PRIORITY_LABEL[priority], by: "priority", priority }, entries, count: entries.length }];
			});
		case "project": {
			const names = [...new Set(tickets.flatMap(({ project }) => (project === null ? [] : [project])))].toSorted((a, b) => a.localeCompare(b));
			const groups = names.map(name => ({ name: name as string | null, tickets: tickets.filter(({ project }) => project === name) }));
			const none = tickets.filter(({ project }) => project === null);
			if (none.length > 0) groups.push({ name: null, tickets: none });
			// The issues in no project fold by an empty key, which no project's name is.
			return groups.map(({ name, tickets: those }) => ({ foldKey: groupFoldKey("project", name ?? ""), heading: { title: name ?? NO_PROJECT, by: "project" }, entries: flat(those), count: those.length }));
		}
		case "none":
			return tickets.length === 0 ? [] : [{ foldKey: groupFoldKey("none", ""), heading: null, entries: flat(tickets), count: tickets.length }];
	}
}

/** The rows `groups` shows, in its order, sub-issues under their parents, folded groups' too: what the open issue's previous and next step through. */
export const listedRows = (groups: readonly TicketListGroup[]): Ticket[] => groups.flatMap(group => group.entries.flatMap(({ ticket, subIssues }) => [ticket, ...subIssues]));
