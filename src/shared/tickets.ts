/** Linear issues: the tickets page's list, one issue in full, and its edits. */

/** Linear's workflow state categories, in the order its My issues lists them. */
export const TICKET_STATUS_TYPES = ["triage", "started", "unstarted", "backlog", "completed", "canceled"] as const;
export type TicketStatusType = (typeof TICKET_STATUS_TYPES)[number];

/** Linear's priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const TICKET_PRIORITIES = [0, 1, 2, 3, 4] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** A Linear label as an issue wears it: its name, and Linear's color for it, `""` when Linear names none. */
export interface TicketLabel {
	name: string;
	/** A CSS color: `#f2c94c`. */
	color: string;
}

/** A Linear issue assigned to the viewer, on the tickets page. */
export interface Ticket {
	/** The identifier Linear shows: `ENG-2368`. */
	id: string;
	title: string;
	url: string;
	/** The workflow state's name: `In Review`. */
	status: string;
	statusType: TicketStatusType;
	priority: TicketPriority;
	labels: TicketLabel[];
	project: string | null;
	team: string;
	/** `YYYY-MM-DD`. */
	dueDate: string | null;
	/** ISO time. */
	createdAt: string;
	/** ISO time. */
	updatedAt: string;
	/** Linear's suggested git branch name. */
	branch: string;
}

/** A workflow state as an issue names it: the status and its type. */
export type TicketStatus = Pick<Ticket, "status" | "statusType">;

/** `GET /api/tickets`: the viewer's assigned Linear issues. A failed read is the API's usual `{ error }` with status 500. */
export interface TicketsAnswer {
	tickets: Ticket[];
}

/** A Linear issue's identifier as Linear shows it, `ENG-2368`: its team's key, a dash, and its number. */
export const TICKET_ID = /^[A-Z][A-Z0-9_]*-\d+$/;

/** Where the page loads a file that a Linear issue or its comments embed; the server fetches it from Linear. */
export const TICKET_MEDIA_PATH = "/api/ticket/media";

/** A person or a team the pickers and the new-issue step offer, by Linear's id. */
export interface TicketChoice {
	id: string;
	name: string;
}

/** `PUT /api/ticket/new`: a Linear issue to open in team `team`, Linear's id of it, assigned to the viewer. It answers the new issue's identifier. */
export interface TicketDraft {
	title: string;
	description: string;
	team: string;
}

export interface TicketComment {
	author: string;
	/** Markdown. */
	body: string;
	/** ISO time. */
	createdAt: string;
}

/** `GET /api/ticket?id=<identifier>`: a Linear issue in full, for the tickets page's main content. */
export interface TicketDetail extends Ticket {
	/** Markdown, with Linear's issue mentions as links, and its images and videos loading through `TICKET_MEDIA_PATH`. */
	description: string;
	createdBy: string | null;
	assignee: TicketChoice | null;
	/** Linear's id of the issue's team, whose states, labels, and projects the pickers offer. */
	teamId: string;
	/** What Linear links the issue to: pull requests, documents, and other pages. */
	attachments: { title: string; url: string }[];
	/** Comment threads, oldest first, each its first comment then the replies. */
	threads: TicketComment[][];
}

/** `GET /api/ticket/options?team=<id>`: what the issue's field pickers offer for that team. */
export interface TicketOptions {
	/** As Linear lists the team's workflow states; the page orders them. */
	statuses: TicketStatus[];
	/** Active members, by name. */
	users: TicketChoice[];
	/** The team's labels and the workspace's, by name. */
	labels: TicketLabel[];
	/** The team's projects' names, sorted. */
	projects: string[];
}

/**
 * `PUT /api/ticket`: changes to an issue, each field left out unchanged and `null` clearing it, which answers the
 * issue as Linear has it after the change. Fields go by the names that an issue read shows (`state` and `project` are
 * names, as is each of `labels`, which replaces every label) except `assignee`, which is the person's id, as
 * `TicketDetail.assignee` carries; `dueDate` is `YYYY-MM-DD`. Linear's `save_issue` takes any of them.
 */
export interface TicketEdit {
	id: string;
	state?: string;
	assignee?: string | null;
	priority?: TicketPriority;
	labels?: string[];
	project?: string | null;
	dueDate?: string | null;
}
