/**
 * The pull request actions: which listed pull request each applies to, and the prompt that starts its session.
 * The Pull requests page's quick actions and the routines both read them, so the server and the page share one prompt.
 */
import { type PullRequestSummary, pullRequestUrl } from "./shared/github";
import { REVIEW_DRAFT_TOOL } from "./shared/review-drafts";

export type PullRequestActionId = "fix-ci-and-conflicts" | "fix-ci" | "resolve-conflicts" | "address-comments" | "review" | "thermonuclear-review";

/** An action that starts a session on a `Subject`: a pull request here, a Linear issue on the tickets page, a todo on the Todo page. */
export interface QuickAction<Subject> {
	label: string;
	/** One sentence, for the tooltip and the menu. */
	description: string;
	applies: (subject: Subject) => boolean;
	prompt: (subject: Subject) => string;
	/** The branch its session starts on, in that branch's worktree, `null` to start in the workspace as it is. */
	branch: (subject: Subject) => string | null;
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

/** Where every prompt of an action that changes the PR's branch says the session runs: the dashboard starts it there. */
const ON_BRANCH = "This session runs in a git worktree on the PR's branch, which the dashboard checked out for it; work there.";

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
			`${pullRequestContext(pr)} It has merge conflicts with its base branch (${baseOf(pr)}) and the checks on its latest commit fail. ${ON_BRANCH} First rebase it onto the latest base (restack with \`gt\` when the repository uses Graphite) and resolve every conflict keeping the intent of both sides. Then find the failing checks and read their logs ${checkLogs(pr)}. Fix the root cause of each failure that still applies after the rebase, and rerun a failure that is flaky or unrelated to this pull request instead of changing code, saying so. Run the project's checks, then push the branch with \`--force-with-lease\` (or \`gt submit\`).`,
		branch: pr => pr.head,
	},
	"fix-ci": {
		label: "Fix CI",
		description: "Start a session that fixes the failing checks",
		applies: pr => ownOpen(pr) && pr.checks === "failing",
		prompt: pr =>
			`${pullRequestContext(pr)} The checks on its latest commit fail. ${ON_BRANCH} Find the failing checks and read their logs ${checkLogs(pr)}. Fix the root cause, run the failing checks locally when you can, then commit and push to the PR's branch. If a failure is flaky or unrelated to this pull request, rerun it instead of changing code, and say so.`,
		branch: pr => pr.head,
	},
	"resolve-conflicts": {
		label: "Resolve conflicts",
		description: "Start a session that rebases the branch and resolves its merge conflicts",
		applies: pr => ownOpen(pr) && pr.conflicts,
		prompt: pr =>
			`${pullRequestContext(pr)} It has merge conflicts with its base branch (${baseOf(pr)}). ${ON_BRANCH} Rebase it onto the latest base (restack with \`gt\` when the repository uses Graphite), resolve every conflict keeping the intent of both sides, run the project's checks, and push the branch with \`--force-with-lease\` (or \`gt submit\`).`,
		branch: pr => pr.head,
	},
	"address-comments": {
		label: "Address comments",
		description: "Start a session that works through the review comments",
		applies: pr => ownOpen(pr) && (pr.unresolved.count > 0 || pr.review === "changes-requested"),
		prompt: pr => {
			const threads = pr.unresolved.count > 0 ? `${pr.unresolved.exact ? "" : "at least "}${pr.unresolved.count} unresolved review ${pr.unresolved.count === 1 ? "thread" : "threads"}` : null;
			const requested = pr.review === "changes-requested" ? "a reviewer requested changes" : null;
			const has = [threads, requested].filter(clause => clause !== null).join(" and ");
			return `${pullRequestContext(pr)} It has ${has}. ${ON_BRANCH} Read the threads and reviews, fix what is right, commit and push, then reply to each thread with what you changed or why you did not change it, and resolve the threads you fixed.`;
		},
		branch: pr => pr.head,
	},
	review: {
		label: "Review",
		description: "Start a session that reviews the pull request into a draft you post",
		applies: pr => pr.role === "reviewer" && pr.state !== "merged",
		prompt: pr =>
			`${pullRequestContext(pr)} ${pr.author.login} asked you to review it. Read the description and the diff, and check it for correctness, regressions, and missing tests. Note the head commit you reviewed with \`gh pr view ${pr.number} -R ${pr.owner}/${pr.repo} --json headRefOid\`. Then save your review with the \`${REVIEW_DRAFT_TOOL}\` tool: a verdict, a summary, and one finding per issue, each with its file and the line at that commit. The user reads the draft in the dashboard, accepts or dismisses each finding, and posts it. Do not post anything on GitHub yourself.`,
		branch: () => null,
	},
	"thermonuclear-review": {
		label: "Thermonuclear review",
		description: "Start a session that runs a thermo-nuclear code quality review",
		applies: pr => pr.state !== "merged",
		prompt: pr =>
			pr.role === "author"
				? `${pullRequestContext(pr)} ${ON_BRANCH} ${thermonuclear(pr)} Apply the valid findings, run the project's checks, then commit and push to the PR's branch. Only once the fixes are pushed, read the PR's description with \`pr_description({repo:"${pr.owner}/${pr.repo}",pr:${pr.number},change:{kind:"read"}})\`. Unless the line \`- [x] Thermo-nuclear code quality review\` is already there, append it with the same tool and \`change:{kind:"append",text:"- [x] Thermo-nuclear code quality review"}\`. The tool preserves the original and refuses failed reads or concurrent changes; never use an unchecked body overwrite. Report each finding and what you did with it.`
				: `${pullRequestContext(pr)} ${pr.author.login} asked you to review it. ${thermonuclear(pr)} Report its findings here with file and line references. Do not change the PR's branch or post anything on GitHub.`,
		branch: pr => (pr.role === "author" ? pr.head : null),
	},
};

const PULL_REQUEST_IDS = Object.keys(PULL_REQUEST_ACTIONS) as PullRequestActionId[];

/** The actions that apply to `pr`, in registry order. */
export const pullRequestActions = (pr: PullRequestSummary): PullRequestActionId[] => PULL_REQUEST_IDS.filter(id => PULL_REQUEST_ACTIONS[id].applies(pr));

/** The prompt of the session that lands `pr` through the `land` tool, for a repository that commits `.omp/land.json` and whose PR shepherd asked to merge it. */
export const landPrompt = (pr: PullRequestSummary): string =>
	`${pullRequestContext(pr)} Its PR shepherd asked to merge it, and this repository lands on \`${pr.base}\` only through the \`land\` tool, which runs the repository's checks on the merged result before it pushes. ${ON_BRANCH} First make the branch match the pull request: run \`git fetch origin\`, then \`git merge --ff-only origin/${pr.head}\`; if the branch has commits the pull request lacks, stop and say so. Then call \`land\` with the divergence "None". If \`land\` reports a conflict or a failed check, do not change the code: report what it returned, so the user can start a fix on the pull request.`;
