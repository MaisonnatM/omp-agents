/** The tickets page's status groups. In Review leads; the rest follow Linear's My issues order. */
import { TICKET_STATUS_TYPES, type Ticket, type TicketPriority, type TicketStatusType } from "../src/shared";
import { type SectionTarget, sectionId } from "./section";

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

/** Linear's In Review state. It leads the tickets page, ahead of every other workflow state. */
export const inReview = (status: string): boolean => status.trim().toLowerCase() === "in review";

/** The tickets grouped by workflow state. In Review first, then Linear's state-type order, then name. */
export function ticketGroups(tickets: Ticket[]): TicketGroup[] {
	const groups = new Map<string, TicketGroup>();
	const sorted = tickets.toSorted((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.updatedAt.localeCompare(a.updatedAt));
	for (const ticket of sorted) {
		const group = groups.get(ticket.status);
		if (group) group.tickets.push(ticket);
		else groups.set(ticket.status, { status: ticket.status, statusType: ticket.statusType, tickets: [ticket] });
	}
	return [...groups.values()].sort(
		(a, b) => Number(inReview(b.status)) - Number(inReview(a.status)) || TICKET_STATUS_TYPES.indexOf(a.statusType) - TICKET_STATUS_TYPES.indexOf(b.statusType) || a.status.localeCompare(b.status),
	);
}

/** A status group of the tickets page, which a sidebar link scrolls to. */
export const ticketSection = (status: string): SectionTarget => ({ id: sectionId("tickets", status), folds: [status] });
