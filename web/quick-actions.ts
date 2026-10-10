/**
 * The quick actions of the Pull requests page, the tickets page, and the Todo page: which pull request, Linear issue, or todo
 * each applies to, and the prompt that starts its session. The pull request actions live in `src/pull-request-actions.ts`,
 * which routines share.
 */
import { PULL_REQUEST_ACTIONS, type PullRequestActionId, type QuickAction } from "../src/pull-request-actions";
import { type PullRequestSummary, type PullRequest, samePullRequest } from "../src/shared/github";
import type { NewSessionRequest, WorkItem } from "../src/shared/sessions";
import type { Ticket } from "../src/shared/tickets";
import type { UserTodo } from "../src/user-todos-shared";
import type { QuickOp, StartOf } from "./starts";

/** The actions that tickets and todos share: work on it, or plan it first. */
export type WorkActionId = "work" | "plan";
export type QuickActionId = PullRequestActionId | WorkActionId;

/** What a quick start works on: a pull request or Linear issue, which the server links the session to, or a todo. */
export type QuickItem = WorkItem | { kind: "todo"; id: string };

/** What a quick start works on, with the action it runs there. */
export type QuickSubject =
	| { kind: "pull-request"; pr: PullRequest; action: PullRequestActionId }
	| { kind: "ticket"; id: string; action: WorkActionId }
	| { kind: "todo"; id: string; text: string; action: WorkActionId };

/** What the server links the session that `subject` starts to: a pull request or issue as its subject, or a todo. */
export function startTarget(subject: QuickSubject): Pick<NewSessionRequest, "subject" | "todoId"> {
	switch (subject.kind) {
		case "pull-request":
			return { subject: { kind: "pull-request", pr: subject.pr }, todoId: null };
		case "ticket":
			return { subject: { kind: "ticket", id: subject.id }, todoId: null };
		case "todo":
			return { subject: null, todoId: subject.id };
		default: {
			const unhandled: never = subject;
			return unhandled;
		}
	}
}

/** The action that `subject` runs on `item`; `null` when it works on something else. */
function actionOn(subject: QuickSubject, item: QuickItem): QuickActionId | null {
	switch (subject.kind) {
		case "pull-request":
			return item.kind === "pull-request" && samePullRequest(subject.pr, item.pr) ? subject.action : null;
		case "ticket":
			return item.kind === "ticket" && subject.id === item.id ? subject.action : null;
		case "todo":
			return item.kind === "todo" && subject.id === item.id ? subject.action : null;
		default: {
			const unhandled: never = subject;
			return unhandled;
		}
	}
}

/** `quick` when it works on `item`, else `null`: the start whose failure `item`'s details show. */
export const quickOn = (quick: StartOf<"quick"> | null, item: QuickItem): StartOf<"quick"> | null => (quick && actionOn(quick.op.subject, item) !== null ? quick : null);

/** The action of the quick start under way on `item`, if any. */
export function pendingOf(quick: StartOf<"quick"> | null, item: QuickItem): QuickActionId | null {
	const on = quickOn(quick, item);
	return on?.phase === "starting" ? on.op.subject.action : null;
}

/** What ticket and todo actions are, by id, in the order they are offered; how each applies to a subject is its rule. */
const WORK_ACTIONS: Record<WorkActionId, Pick<QuickAction<unknown>, "label" | "description">> = {
	work: { label: "Work on it", description: "Start a session that implements it" },
	plan: { label: "Plan it", description: "Start a session that reads it and the code and proposes a plan, without changing anything" },
};

/** Which subjects of type `S` a work action applies to, and the prompt that starts its session on one. */
type WorkRule<S> = Pick<QuickAction<S>, "applies" | "prompt">;

/** What every ticket prompt opens with: which issue, and where to read it in full. */
const ticketContext = (ticket: Ticket): string =>
	`Linear issue ${ticket.id} ("${ticket.title}"), ${ticket.url}. Read it in full, with its comments, through Linear's MCP tools.`;

const isOpen = (ticket: Ticket): boolean => ticket.statusType !== "completed" && ticket.statusType !== "canceled";

/** How each work action applies to a Linear issue. */
const TICKET_RULES: Record<WorkActionId, WorkRule<Ticket>> = {
	work: {
		applies: isOpen,
		prompt: ticket => {
			const branch = ticket.branch
				? `the branch \`${ticket.branch}\`, Linear's name for it, so that Linear links the work to the issue (check it out if it exists already)`
				: `a new branch named after ${ticket.id}`;
			return `${ticketContext(ticket)} Then work on it in a git worktree on ${branch}. When a branch or pull request for it exists already, continue from there. Implement what the issue asks, add tests for the behavior you change, run the project's checks, and commit. Report what you changed and what is left open. Do not push, open a pull request, or update the issue on Linear.`;
		},
	},
	plan: {
		applies: ticket => isOpen(ticket) && ticket.statusType !== "started",
		prompt: ticket =>
			`${ticketContext(ticket)} Then read the code it concerns, and report a plan to resolve it here: the cause or the design, the files to change, the tests to add, and the questions the issue leaves open. Do not change any file, and do not update the issue on Linear.`,
	},
};

/** What every todo prompt opens with: its title, its notes, and its open sub-todos. */
function todoContext(todo: UserTodo): string {
	const notes = todo.body.trim();
	const open = todo.children.filter(child => child.doneAt === null).map(child => `- ${child.text}`);
	return [`Todo "${todo.text}" from my todo list.`, notes, open.length > 0 ? `Its open sub-todos:\n${open.join("\n")}` : ""].filter(part => part !== "").join("\n\n");
}

/** How each work action applies to a todo; a linked session already knows its todo. */
const TODO_RULES: Record<WorkActionId, WorkRule<UserTodo>> = {
	work: {
		applies: todo => todo.doneAt === null,
		prompt: todo =>
			`${todoContext(todo)}\n\nDo what it asks. When it changes code, work in a git worktree on a new branch named after it, add tests for the behavior you change, run the project's checks, and commit. Report what you did and what is left open. Do not push or open a pull request.`,
	},
	plan: {
		applies: todo => todo.doneAt === null && todo.status !== "in-progress",
		prompt: todo =>
			`${todoContext(todo)}\n\nRead the code or material it concerns, and report a plan to do it here: the steps, the files to change, and the questions it leaves open. Do not change any file.`,
	},
};

/** Every quick action's label and description, by id, for the menus and buttons that offer them. */
export const QUICK_ACTIONS: Record<QuickActionId, Pick<QuickAction<unknown>, "label" | "description">> = { ...PULL_REQUEST_ACTIONS, ...WORK_ACTIONS };

const WORK_IDS = Object.keys(WORK_ACTIONS) as WorkActionId[];

/** The actions that apply to `ticket`, in registry order: none once it is completed or canceled. */
export const ticketActions = (ticket: Ticket): WorkActionId[] => WORK_IDS.filter(id => TICKET_RULES[id].applies(ticket));

/** The actions that apply to `todo`, in registry order: none once it is closed, and no plan once work started. */
export const todoActions = (todo: UserTodo): WorkActionId[] => WORK_IDS.filter(id => TODO_RULES[id].applies(todo));

/** The start of `action` on `pr`, in `cwd`, through the pinned `skill` when one is pinned. */
export const pullRequestStart = (pr: PullRequestSummary, action: PullRequestActionId, cwd: string, skill: string | null): QuickOp => ({
	kind: "quick",
	cwd,
	prompt: PULL_REQUEST_ACTIONS[action].prompt(pr),
	subject: { kind: "pull-request", pr: { owner: pr.owner, repo: pr.repo, number: pr.number }, action },
	skill,
});

/** The start of `action` on `ticket`, in `cwd`, through the pinned `skill` when one is pinned. */
export const ticketStart = (ticket: Ticket, action: WorkActionId, cwd: string, skill: string | null): QuickOp => ({
	kind: "quick",
	cwd,
	prompt: TICKET_RULES[action].prompt(ticket),
	subject: { kind: "ticket", id: ticket.id, action },
	skill,
});

/** The start of `action` on `todo`, in `cwd`, through the pinned `skill` when one is pinned. */
export const todoStart = (todo: UserTodo, action: WorkActionId, cwd: string, skill: string | null): QuickOp => ({
	kind: "quick",
	cwd,
	prompt: TODO_RULES[action].prompt(todo),
	subject: { kind: "todo", id: todo.id, text: todo.text, action },
	skill,
});
