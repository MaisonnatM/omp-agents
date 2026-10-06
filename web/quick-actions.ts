/**
 * The quick actions of the inbox and the tickets page: which pull request or Linear issue each applies to, and the
 * prompt that starts its session. The pull request actions live in `src/pull-request-actions.ts`, which routines share.
 */
import { PULL_REQUEST_ACTIONS, type PullRequestActionId, type QuickAction } from "../src/pull-request-actions";
import { type InboxPullRequest, type PullRequest, samePullRequest } from "../src/shared/github";
import type { WorkItem } from "../src/shared/sessions";
import type { Ticket } from "../src/shared/tickets";
import type { QuickOp, StartOf } from "./starts";

export type TicketActionId = "work" | "plan";
export type QuickActionId = PullRequestActionId | TicketActionId;

/** What a quick start works on, with the action it runs there. */
export type QuickSubject = { kind: "pull-request"; pr: PullRequest; action: PullRequestActionId } | { kind: "ticket"; id: string; action: TicketActionId };

/** What `subject` works on, without the action it runs there. */
export const workItemOf = (subject: QuickSubject): WorkItem => (subject.kind === "ticket" ? { kind: "ticket", id: subject.id } : { kind: "pull-request", pr: subject.pr });

/** The action that `subject` runs on `item`; `null` when it works on something else. */
export function actionOn(subject: QuickSubject, item: WorkItem): QuickActionId | null {
	switch (subject.kind) {
		case "pull-request":
			return item.kind === "pull-request" && samePullRequest(subject.pr, item.pr) ? subject.action : null;
		case "ticket":
			return item.kind === "ticket" && subject.id === item.id ? subject.action : null;
		default: {
			const unhandled: never = subject;
			return unhandled;
		}
	}
}

/** The action of the quick start under way on `item`, if any. */
export function pendingOf(quick: StartOf<"quick"> | null, item: WorkItem): QuickActionId | null {
	return quick?.phase === "starting" ? actionOn(quick.op.subject, item) : null;
}

/** What every ticket prompt opens with: which issue, and where to read it in full. */
const ticketContext = (ticket: Ticket): string =>
	`Linear issue ${ticket.id} ("${ticket.title}"), ${ticket.url}. Read it in full, with its comments, through Linear's MCP tools.`;

const isOpen = (ticket: Ticket): boolean => ticket.statusType !== "completed" && ticket.statusType !== "canceled";

/** The tickets page's quick actions by id, in the order they are offered. */
const TICKET_ACTIONS: Record<TicketActionId, QuickAction<Ticket>> = {
	work: {
		label: "Work on it",
		description: "Start a session that implements the issue",
		applies: isOpen,
		prompt: ticket => {
			const branch = ticket.branch
				? `the branch \`${ticket.branch}\`, Linear's name for it, so that Linear links the work to the issue (check it out if it exists already)`
				: `a new branch named after ${ticket.id}`;
			return `${ticketContext(ticket)} Then work on it in a git worktree on ${branch}. When a branch or pull request for it exists already, continue from there. Implement what the issue asks, add tests for the behavior you change, run the project's checks, and commit. Report what you changed and what is left open. Do not push, open a pull request, or update the issue on Linear.`;
		},
	},
	plan: {
		label: "Plan it",
		description: "Start a session that reads the issue and the code and proposes a plan, without changing anything",
		applies: ticket => isOpen(ticket) && ticket.statusType !== "started",
		prompt: ticket =>
			`${ticketContext(ticket)} Then read the code it concerns, and report a plan to resolve it here: the cause or the design, the files to change, the tests to add, and the questions the issue leaves open. Do not change any file, and do not update the issue on Linear.`,
	},
};

/** Every quick action's label and description, by id, for the menus and buttons that offer them. */
export const QUICK_ACTIONS: Record<QuickActionId, Pick<QuickAction<unknown>, "label" | "description">> = { ...PULL_REQUEST_ACTIONS, ...TICKET_ACTIONS };

const TICKET_IDS = Object.keys(TICKET_ACTIONS) as TicketActionId[];

/** The actions that apply to `ticket`, in registry order: none once it is completed or canceled. */
export const ticketActions = (ticket: Ticket): TicketActionId[] => TICKET_IDS.filter(id => TICKET_ACTIONS[id].applies(ticket));

/** The start of `action` on `pr`, in `cwd`, through the pinned `skill` when one is pinned. */
export const pullRequestStart = (pr: InboxPullRequest, action: PullRequestActionId, cwd: string, skill: string | null): QuickOp => ({
	kind: "quick",
	cwd,
	prompt: PULL_REQUEST_ACTIONS[action].prompt(pr),
	subject: { kind: "pull-request", pr: { owner: pr.owner, repo: pr.repo, number: pr.number }, action },
	skill,
});

/** The start of `action` on `ticket`, in `cwd`, through the pinned `skill` when one is pinned. */
export const ticketStart = (ticket: Ticket, action: TicketActionId, cwd: string, skill: string | null): QuickOp => ({
	kind: "quick",
	cwd,
	prompt: TICKET_ACTIONS[action].prompt(ticket),
	subject: { kind: "ticket", id: ticket.id, action },
	skill,
});
