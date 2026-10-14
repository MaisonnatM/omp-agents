/** The tickets page's status groups and the status picker's order. In Review leads; the rest follow Linear's My issues order. */
import { TICKET_STATUS_TYPES, type Ticket, type TicketPriority, type TicketRelative, type TicketStatus } from "../src/shared/tickets";
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

/** A top-level row of the page and the listed issues under it, which it nests. */
export interface TicketEntry {
	ticket: Ticket;
	/** Every listed descendant, in {@link subIssueOrder}. */
	subIssues: Ticket[];
}

export interface TicketGroup extends TicketStatus {
	/** By priority, then most recently updated first. */
	entries: TicketEntry[];
	/** The rows the group shows, nested ones included. */
	count: number;
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

/** The number in an issue's identifier: `2368` for `ENG-2368`. */
const issueNumber = (id: string): number => Number(id.slice(id.lastIndexOf("-") + 1));

/** Sub-issues in the status order of the groups, then oldest first, which is how a parent's parts are usually numbered. */
export const subIssueOrder = (a: Pick<TicketRelative, "id" | "status" | "statusType">, b: Pick<TicketRelative, "id" | "status" | "statusType">): number =>
	statusOrder(a, b) || issueNumber(a.id) - issueNumber(b.id);

/**
 * The tickets grouped by workflow state, in `statusOrder`. A sub-issue whose parent is listed nests under its topmost
 * listed ancestor, in that ancestor's group whatever its own status; one whose parent is not listed is a row of its own.
 */
export function ticketGroups(tickets: Ticket[]): TicketGroup[] {
	const byId = new Map(tickets.map(ticket => [ticket.id, ticket]));
	const rootOf = (ticket: Ticket): Ticket => {
		const seen = new Set([ticket.id]);
		let root = ticket;
		for (let parent = root.parentId ? byId.get(root.parentId) : undefined; parent && !seen.has(parent.id); parent = parent.parentId ? byId.get(parent.parentId) : undefined) {
			seen.add(parent.id);
			root = parent;
		}
		return root;
	};
	const nested = new Map<string, Ticket[]>();
	const tops: Ticket[] = [];
	for (const ticket of tickets) {
		const root = rootOf(ticket);
		const siblings = nested.get(root.id);
		if (root === ticket) tops.push(ticket);
		else if (siblings) siblings.push(ticket);
		else nested.set(root.id, [ticket]);
	}
	const groups = new Map<string, TicketGroup>();
	const sorted = tops.toSorted((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.updatedAt.localeCompare(a.updatedAt));
	for (const ticket of sorted) {
		const entry = { ticket, subIssues: (nested.get(ticket.id) ?? []).toSorted(subIssueOrder) };
		const group = groups.get(ticket.status);
		if (group) {
			group.entries.push(entry);
			group.count += 1 + entry.subIssues.length;
		} else groups.set(ticket.status, { status: ticket.status, statusType: ticket.statusType, entries: [entry], count: 1 + entry.subIssues.length });
	}
	return [...groups.values()].sort(statusOrder);
}

/** A status group of the tickets page, which a sidebar link scrolls to. */
export const ticketSection = (status: string): SectionTarget => ({ id: sectionId("tickets", status), folds: [status] });

/**
 * Issue `id`'s Linear address: the listed issue's own, else one in the workspace of any listed issue, which Linear opens by
 * identifier; `null` when nothing is listed to name the workspace.
 */
export function linearUrlOf(id: string, listed: readonly Ticket[]): string | null {
	const own = listed.find(ticket => ticket.id === id);
	if (own) return own.url;
	for (const { url } of listed) {
		const workspace = url.match(/^https:\/\/linear\.app\/[^/]+\/issue\//)?.[0];
		if (workspace) return `${workspace}${id}`;
	}
	return null;
}
