/**
 * The quick actions of the inbox and the tickets page: which pull request or Linear issue each applies to, and the
 * prompt that starts its session.
 */
import type { InboxPullRequest, PullRequest, Ticket } from "../src/shared";
import { pullRequestUrl } from "./inbox-model";
import type { OpenMode } from "./routing";
import type { QuickOp } from "./starts";

export type PullRequestActionId = "fix-ci" | "resolve-conflicts" | "address-comments" | "review";
export type TicketActionId = "work" | "plan";
export type QuickActionId = PullRequestActionId | TicketActionId;

/** What a quick start works on, with the action it runs there. */
export type QuickSubject = { kind: "pull-request"; pr: PullRequest; action: PullRequestActionId } | { kind: "ticket"; id: string; action: TicketActionId };

interface QuickAction<Subject> {
	label: string;
	/** One sentence, for the tooltip and the menu. */
	description: string;
	applies: (subject: Subject) => boolean;
	prompt: (subject: Subject) => string;
}

/** What every pull request prompt opens with: which pull request, and its branch. */
function pullRequestContext(pr: InboxPullRequest): string {
	const stacked = pr.stackedOn ? `, stacked on \`${pr.stackedOn}\`` : "";
	return `Pull request ${pullRequestUrl(pr)} ("${pr.title}"), branch \`${pr.head}\`${stacked}.`;
}

const ownOpen = (pr: InboxPullRequest): boolean => pr.role === "author" && pr.state !== "merged";

/** The inbox's quick actions by id, in the order they are offered. */
const PULL_REQUEST_ACTIONS: Record<PullRequestActionId, QuickAction<InboxPullRequest>> = {
	"fix-ci": {
		label: "Fix CI",
		description: "Start a session that fixes the failing checks",
		applies: pr => ownOpen(pr) && pr.checks === "failing",
		prompt: pr =>
			`${pullRequestContext(pr)} The checks on its latest commit fail. Find the failing checks and read their logs (\`gh pr checks ${pr.number} -R ${pr.owner}/${pr.repo}\`, \`gh run view <run> --log-failed\`). Work on the PR's branch in its own git worktree, fix the root cause, run the failing checks locally when you can, then commit and push to the PR's branch. If a failure is flaky or unrelated to this pull request, rerun it instead of changing code, and say so.`,
	},
	"resolve-conflicts": {
		label: "Resolve conflicts",
		description: "Start a session that rebases the branch and resolves its merge conflicts",
		applies: pr => ownOpen(pr) && pr.conflicts,
		prompt: pr =>
			`${pullRequestContext(pr)} It has merge conflicts with its base branch (${pr.stackedOn ? `\`${pr.stackedOn}\`` : "the repository's default branch"}). In a git worktree on the PR's branch, rebase it onto the latest base (restack with \`gt\` when the repository uses Graphite), resolve every conflict keeping the intent of both sides, run the project's checks, and push the branch with \`--force-with-lease\` (or \`gt submit\`).`,
	},
	"address-comments": {
		label: "Address comments",
		description: "Start a session that works through the review comments",
		applies: pr => ownOpen(pr) && (pr.unresolved.count > 0 || pr.review === "changes-requested"),
		prompt: pr => {
			const threads = pr.unresolved.count > 0 ? `${pr.unresolved.exact ? "" : "at least "}${pr.unresolved.count} unresolved review ${pr.unresolved.count === 1 ? "thread" : "threads"}` : null;
			const requested = pr.review === "changes-requested" ? "a reviewer requested changes" : null;
			const has = [threads, requested].filter(clause => clause !== null).join(" and ");
			return `${pullRequestContext(pr)} It has ${has}. Read the threads and reviews, fix what is right in a git worktree on the PR's branch, commit and push, then reply to each thread with what you changed or why you did not change it, and resolve the threads you fixed.`;
		},
	},
	review: {
		label: "Review",
		description: "Start a session that reviews the pull request",
		applies: pr => pr.role === "reviewer" && pr.state !== "merged",
		prompt: pr =>
			`${pullRequestContext(pr)} ${pr.author.login} asked you to review it. Read the description and the diff, check it for correctness, regressions, and missing tests, and report your findings here with file and line references. Do not post anything on GitHub.`,
	},
};

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

const PULL_REQUEST_IDS = Object.keys(PULL_REQUEST_ACTIONS) as PullRequestActionId[];
const TICKET_IDS = Object.keys(TICKET_ACTIONS) as TicketActionId[];

/** The actions that apply to `pr`, in registry order. */
export const pullRequestActions = (pr: InboxPullRequest): PullRequestActionId[] => PULL_REQUEST_IDS.filter(id => PULL_REQUEST_ACTIONS[id].applies(pr));

/** The actions that apply to `ticket`, in registry order: none once it is completed or canceled. */
export const ticketActions = (ticket: Ticket): TicketActionId[] => TICKET_IDS.filter(id => TICKET_ACTIONS[id].applies(ticket));

/** The start of `action` on `pr`, in `cwd`. */
export const pullRequestStart = (pr: InboxPullRequest, action: PullRequestActionId, cwd: string, mode: OpenMode): QuickOp => ({
	kind: "quick",
	cwd,
	prompt: PULL_REQUEST_ACTIONS[action].prompt(pr),
	subject: { kind: "pull-request", pr: { owner: pr.owner, repo: pr.repo, number: pr.number }, action },
	mode,
});

/** The start of `action` on `ticket`, in `cwd`. */
export const ticketStart = (ticket: Ticket, action: TicketActionId, cwd: string, mode: OpenMode): QuickOp => ({
	kind: "quick",
	cwd,
	prompt: TICKET_ACTIONS[action].prompt(ticket),
	subject: { kind: "ticket", id: ticket.id, action },
	mode,
});
