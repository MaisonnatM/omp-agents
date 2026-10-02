/** The tickets page's status groups, in Linear's My issues order. */
import type { Ticket, TicketPriority, TicketStatusType } from "../src/shared";

/** Where each state type's groups sit on the page, as Linear lists them. */
const STATUS_TYPE_RANK: Record<TicketStatusType, number> = {
	triage: 0,
	started: 1,
	unstarted: 2,
	backlog: 3,
	completed: 4,
	canceled: 5,
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
	0: "No priority",
	1: "Urgent",
	2: "High",
	3: "Medium",
	4: "Low",
};

/** Urgent first, then high, medium, and low; no priority after all of them. */
const priorityRank = (priority: TicketPriority): number => (priority === 0 ? 5 : priority);

export interface TicketGroup {
	/** The workflow state's name, which names the group. */
	status: string;
	statusType: TicketStatusType;
	/** By priority, then most recently updated first. */
	tickets: Ticket[];
}

/** The tickets grouped by workflow state, groups ordered by state type then name. */
export function ticketGroups(tickets: Ticket[]): TicketGroup[] {
	const groups = new Map<string, TicketGroup>();
	const sorted = tickets.toSorted((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.updatedAt.localeCompare(a.updatedAt));
	for (const ticket of sorted) {
		const group = groups.get(ticket.status);
		if (group) group.tickets.push(ticket);
		else groups.set(ticket.status, { status: ticket.status, statusType: ticket.statusType, tickets: [ticket] });
	}
	return [...groups.values()].sort((a, b) => STATUS_TYPE_RANK[a.statusType] - STATUS_TYPE_RANK[b.statusType] || a.status.localeCompare(b.status));
}

/** A status group of the tickets page, which a sidebar link scrolls to. Each click makes a new one, so choosing a group again scrolls back to it. */
export interface TicketsTarget {
	status: string;
}

/** The id of a group on the tickets page, which a sidebar link scrolls to. It holds no spaces, since `aria-controls` lists ids separated by spaces. */
export const ticketGroupId = (status: string): string => `tickets-${status.toLowerCase().replaceAll(" ", "-")}`;
