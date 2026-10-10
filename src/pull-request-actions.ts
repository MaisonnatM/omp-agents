/**
 * The pull request actions: which listed pull request each applies to, and the prompt that starts its session.
 * The Pull requests page's quick actions and the routines both read them, so the server and the page share one prompt.
 */
import { type PullRequestSummary, pullRequestUrl } from "./shared/github";

export type PullRequestActionId = "fix-ci-and-conflicts" | "fix-ci" | "resolve-conflicts" | "address-comments" | "review" | "thermonuclear-review";

/** An action that starts a session on a `Subject`: a pull request here, a Linear issue on the tickets page. */
export interface QuickAction<Subject> {
	label: string;
	/** One sentence, for the tooltip and the menu. */
	description: string;
	applies: (subject: Subject) => boolean;
	prompt: (subject: Subject) => string;
}

/** What every pull request prompt opens with: which pull request, and its branch. */
function pullRequestContext(pr: PullRequestSummary): string {
	const stacked = pr.stackedOn ? `, stacked on \`${pr.stackedOn}\`` : "";
	return `Pull request ${pullRequestUrl(pr)} ("${pr.title}"), branch \`${pr.head}\`${stacked}.`;
}

const ownOpen = (pr: PullRequestSummary): boolean => pr.role === "author" && pr.state !== "merged";

/** The branch that `pr` merges into, as a prompt names it. */
const baseOf = (pr: PullRequestSummary): string => (pr.stackedOn ? `\`${pr.stackedOn}\`` : "the repository's default branch");

/** The commands that list the failing checks of `pr` and print their logs. */
const checkLogs = (pr: PullRequestSummary): string => `(\`gh pr checks ${pr.number} -R ${pr.owner}/${pr.repo}\`, \`gh run view <run> --log-failed\`)`;

/** How a session runs the thermo-nuclear review of `pr`: on the `plan` role, through the kit's reviewer agent. */
const thermonuclear = (pr: PullRequestSummary): string =>
	`Run a thermo-nuclear code quality review of its diff: spawn \`task\` with \`agent: "thermonuclear-reviewer"\` on \`pr://${pr.owner}/${pr.repo}/${pr.number}/diff\` (run the \`thermo-nuclear-code-quality-review\` skill yourself when that agent is missing).`;

/** The Pull requests page's quick actions by id, in the order they are offered. */
export const PULL_REQUEST_ACTIONS: Record<PullRequestActionId, QuickAction<PullRequestSummary>> = {
	"fix-ci-and-conflicts": {
		label: "Fix CI and conflicts",
		description: "Start a session that rebases the branch, resolves its merge conflicts, then fixes the failing checks",
		applies: pr => ownOpen(pr) && pr.conflicts && pr.checks === "failing",
		prompt: pr =>
			`${pullRequestContext(pr)} It has merge conflicts with its base branch (${baseOf(pr)}) and the checks on its latest commit fail. In a git worktree on the PR's branch, first rebase it onto the latest base (restack with \`gt\` when the repository uses Graphite) and resolve every conflict keeping the intent of both sides. Then find the failing checks and read their logs ${checkLogs(pr)}. Fix the root cause of each failure that still applies after the rebase, and rerun a failure that is flaky or unrelated to this pull request instead of changing code, saying so. Run the project's checks, then push the branch with \`--force-with-lease\` (or \`gt submit\`).`,
	},
	"fix-ci": {
		label: "Fix CI",
		description: "Start a session that fixes the failing checks",
		applies: pr => ownOpen(pr) && pr.checks === "failing",
		prompt: pr =>
			`${pullRequestContext(pr)} The checks on its latest commit fail. Find the failing checks and read their logs ${checkLogs(pr)}. Work on the PR's branch in its own git worktree, fix the root cause, run the failing checks locally when you can, then commit and push to the PR's branch. If a failure is flaky or unrelated to this pull request, rerun it instead of changing code, and say so.`,
	},
	"resolve-conflicts": {
		label: "Resolve conflicts",
		description: "Start a session that rebases the branch and resolves its merge conflicts",
		applies: pr => ownOpen(pr) && pr.conflicts,
		prompt: pr =>
			`${pullRequestContext(pr)} It has merge conflicts with its base branch (${baseOf(pr)}). In a git worktree on the PR's branch, rebase it onto the latest base (restack with \`gt\` when the repository uses Graphite), resolve every conflict keeping the intent of both sides, run the project's checks, and push the branch with \`--force-with-lease\` (or \`gt submit\`).`,
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
	"thermonuclear-review": {
		label: "Thermonuclear review",
		description: "Start a session that runs a thermo-nuclear code quality review",
		applies: pr => pr.state !== "merged",
		prompt: pr =>
			pr.role === "author"
				? `${pullRequestContext(pr)} ${thermonuclear(pr)} Apply the valid findings in a git worktree on the PR's branch, run the project's checks, then commit and push to the PR's branch. Only once the fixes are pushed, add the line \`- [x] Thermo-nuclear code quality review\` to the PR's description (\`gh pr edit ${pr.number} -R ${pr.owner}/${pr.repo} --body-file\` from its current body, never a blind overwrite), unless it is already there. Report each finding and what you did with it.`
				: `${pullRequestContext(pr)} ${pr.author.login} asked you to review it. ${thermonuclear(pr)} Report its findings here with file and line references. Do not change the PR's branch or post anything on GitHub.`,
	},
};

const PULL_REQUEST_IDS = Object.keys(PULL_REQUEST_ACTIONS) as PullRequestActionId[];

/** The actions that apply to `pr`, in registry order. */
export const pullRequestActions = (pr: PullRequestSummary): PullRequestActionId[] => PULL_REQUEST_IDS.filter(id => PULL_REQUEST_ACTIONS[id].applies(pr));
