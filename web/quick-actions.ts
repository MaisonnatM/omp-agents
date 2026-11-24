/**
 * The quick actions of the Pull requests page and the Todo page: which pull request or todo each applies to, and the
 * prompt that starts its session. The pull request actions live in `src/pull-request-actions.ts`, which routines share.
 */
import { PULL_REQUEST_ACTIONS, type PullRequestActionId, type QuickAction } from "../src/pull-request-actions";
import type { BranchChoice } from "../src/shared/git";
import { type PullRequestSummary, type PullRequest, samePullRequest } from "../src/shared/github";
import type { NewSessionRequest, WorkItem } from "../src/shared/sessions";
import type { UserTodo } from "../src/user-todos-shared";
import { todoCwd } from "./todo-views";

/** The actions a todo offers: work on it, or plan it first. */
export type WorkActionId = "work" | "plan";
export type QuickActionId = PullRequestActionId | WorkActionId;

/** What a quick start works on: a pull request, which the server links the session to, or a todo. */
export type QuickItem = WorkItem | { kind: "todo"; id: string };

/** What a quick start works on, with the action it runs there. */
export type QuickSubject =
	| { kind: "pull-request"; pr: PullRequest; action: PullRequestActionId }
	| { kind: "todo"; id: string; text: string; action: WorkActionId };

/** A quick start's request. Defined here so the start list can hold one without this file importing the start list. */
export type QuickOp = {
	kind: "quick";
	cwd: string;
	branch: BranchChoice | null;
	prompt: string;
	subject: QuickSubject;
	skill: string | null;
	/** The session that owns the pull request, which gets the prompt instead of a new session; `null` for none. */
	owner: string | null;
};

/** What the server links the session that `subject` starts to: a pull request as its subject, or a todo; a Review start saves a review draft of its pull request. */
export function startTarget(subject: QuickSubject): Pick<NewSessionRequest, "subject" | "todoId" | "reviewDraft"> {
	switch (subject.kind) {
		case "pull-request":
			return { subject: { kind: "pull-request", pr: subject.pr }, todoId: null, reviewDraft: subject.action === "review" };
		case "todo":
			return { subject: null, todoId: subject.id, reviewDraft: false };
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
		case "todo":
			return item.kind === "todo" && subject.id === item.id ? subject.action : null;
		default: {
			const unhandled: never = subject;
			return unhandled;
		}
	}
}

/** `quick` when it works on `item`, else `null`: the start whose failure `item`'s details show. */
export const quickOn = <T extends { op: QuickOp }>(quick: T | null, item: QuickItem): T | null => (quick && actionOn(quick.op.subject, item) !== null ? quick : null);

/** The action of the quick start under way on `item`, if any. */
export function pendingOf(quick: ({ op: QuickOp } & { phase: string }) | null, item: QuickItem): QuickActionId | null {
	const on = quickOn(quick, item);
	return on?.phase === "starting" ? on.op.subject.action : null;
}

/** What todo actions are, by id, in the order they are offered; how each applies to a todo is its rule. */
const WORK_ACTIONS: Record<WorkActionId, Pick<QuickAction<unknown>, "label" | "description">> = {
	work: { label: "Work on it", description: "Start a session that implements it" },
	plan: { label: "Plan it", description: "Start a session that reads it and the code and proposes a plan, without changing anything" },
};

/** What every todo prompt opens with: its title, its notes, and its open sub-todos. */
function todoContext(todo: UserTodo): string {
	const notes = todo.body.trim();
	const open = todo.children.filter(child => child.doneAt === null).map(child => `- ${child.text}`);
	return [`Todo "${todo.text}" from my todo list.`, notes, open.length > 0 ? `Its open sub-todos:\n${open.join("\n")}` : ""].filter(part => part !== "").join("\n\n");
}

/** How each work action applies to a todo; a linked session already knows its todo. */
const TODO_RULES: Record<WorkActionId, Pick<QuickAction<UserTodo>, "applies" | "prompt">> = {
	work: {
		applies: todo => todo.doneAt === null,
		prompt: todo =>
			`${todoContext(todo)}\n\nDo what it asks. When it changes code, work in a git worktree on a new branch named after it and run it through \`skill://ship\` from its first step, including the grill and plan before any code, stopping before its Draft PR step. Report what you did and what is left open. Do not push or open a pull request.`,
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

/** The actions that apply to `todo`, in registry order: none once it is closed, and no plan once work started. */
export const todoActions = (todo: UserTodo): WorkActionId[] => WORK_IDS.filter(id => TODO_RULES[id].applies(todo));

/** The branch choice of a quick start that works on `branch`, `null` to start in the workspace as it is. */
const workBranch = (branch: string | null): QuickOp["branch"] => (branch ? { kind: "work", name: branch } : null);

/**
 * The start of `action` on `pr`, from `cwd` and in the PR branch's worktree when the action changes it, through the pinned
 * `skill` when one is pinned; with an `owner`, the server sends the prompt to that session instead, as {@link fixOwner} picks it.
 */
export const pullRequestStart = (pr: PullRequestSummary, action: PullRequestActionId, cwd: string, skill: string | null, owner: string | null = null): QuickOp => ({
	kind: "quick",
	cwd,
	branch: workBranch(PULL_REQUEST_ACTIONS[action].branch(pr)),
	prompt: PULL_REQUEST_ACTIONS[action].prompt(pr),
	subject: { kind: "pull-request", pr: { owner: pr.owner, repo: pr.repo, number: pr.number }, action },
	skill,
	owner,
});

/** The start of `action` on `todo`, in its Workspace or else `cwd`, through the pinned `skill` when one is pinned. */
export const todoStart = (todo: UserTodo, action: WorkActionId, cwd: string, skill: string | null): QuickOp => ({
	kind: "quick",
	cwd: todoCwd(todo, cwd),
	branch: null,
	prompt: TODO_RULES[action].prompt(todo),
	subject: { kind: "todo", id: todo.id, text: todo.text, action },
	skill,
	owner: null,
});
