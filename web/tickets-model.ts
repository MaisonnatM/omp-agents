/** The tickets page's status groups and the status picker's order. In Review leads; the rest follow Linear's My issues order. */
import { TICKET_STATUS_TYPES, type Ticket, type TicketPriority, type TicketStatus } from "../src/shared";
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

export interface TicketGroup extends TicketStatus {
	/** By priority, then most recently updated first. */
	tickets: Ticket[];
}

/**
 * What a status looks and sorts as: its state type, except In Review, which Linear makes a started state but this
 * page leads with and marks on its own so it does not look like In Progress.
 */
export type StatusKind = "review" | TicketStatus["statusType"];

const STATUS_KINDS: readonly StatusKind[] = ["review", ...TICKET_STATUS_TYPES];

export const statusKind = ({ status, statusType }: TicketStatus): StatusKind => (status.trim().toLowerCase() === "in review" ? "review" : statusType);

/** In Review first, then Linear's state-type order, then name: the order of the groups and of the status picker. */
export const statusOrder = (a: TicketStatus, b: TicketStatus): number =>
	STATUS_KINDS.indexOf(statusKind(a)) - STATUS_KINDS.indexOf(statusKind(b)) || a.status.localeCompare(b.status);

/** The tickets grouped by workflow state, in `statusOrder`. */
export function ticketGroups(tickets: Ticket[]): TicketGroup[] {
	const groups = new Map<string, TicketGroup>();
	const sorted = tickets.toSorted((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.updatedAt.localeCompare(a.updatedAt));
	for (const ticket of sorted) {
		const group = groups.get(ticket.status);
		if (group) group.tickets.push(ticket);
		else groups.set(ticket.status, { status: ticket.status, statusType: ticket.statusType, tickets: [ticket] });
	}
	return [...groups.values()].sort(statusOrder);
}

/** A status group of the tickets page, which a sidebar link scrolls to. */
export const ticketSection = (status: string): SectionTarget => ({ id: sectionId("tickets", status), folds: [status] });
