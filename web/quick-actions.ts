/** The inbox's quick actions: which pull requests each applies to, and the prompt that starts its session. */
import type { InboxPullRequest } from "../src/shared";
import { pullRequestUrl } from "./inbox-model";

export type QuickActionId = "fix-ci" | "resolve-conflicts" | "address-comments" | "review";

interface QuickAction {
	label: string;
	/** One sentence, for the tooltip and the menu. */
	description: string;
	applies: (pr: InboxPullRequest) => boolean;
	prompt: (pr: InboxPullRequest) => string;
}

/** What every prompt opens with: which pull request, and its branch. */
function context(pr: InboxPullRequest): string {
	const stacked = pr.stackedOn ? `, stacked on \`${pr.stackedOn}\`` : "";
	return `Pull request ${pullRequestUrl(pr)} ("${pr.title}"), branch \`${pr.head}\`${stacked}.`;
}

const ownOpen = (pr: InboxPullRequest): boolean => pr.role === "author" && pr.state !== "merged";

/** Quick actions by id, in the order they are offered. */
export const QUICK_ACTIONS: Record<QuickActionId, QuickAction> = {
	"fix-ci": {
		label: "Fix CI",
		description: "Start a session that fixes the failing checks",
		applies: pr => ownOpen(pr) && pr.checks === "failing",
		prompt: pr =>
			`${context(pr)} The checks on its latest commit fail. Find the failing checks and read their logs (\`gh pr checks ${pr.number} -R ${pr.owner}/${pr.repo}\`, \`gh run view <run> --log-failed\`). Work on the PR's branch in its own git worktree, fix the root cause, run the failing checks locally when you can, then commit and push to the PR's branch. If a failure is flaky or unrelated to this pull request, rerun it instead of changing code, and say so.`,
	},
	"resolve-conflicts": {
		label: "Resolve conflicts",
		description: "Start a session that rebases the branch and resolves its merge conflicts",
		applies: pr => ownOpen(pr) && pr.conflicts,
		prompt: pr =>
			`${context(pr)} It has merge conflicts with its base branch (${pr.stackedOn ? `\`${pr.stackedOn}\`` : "the repository's default branch"}). In a git worktree on the PR's branch, rebase it onto the latest base (restack with \`gt\` when the repository uses Graphite), resolve every conflict keeping the intent of both sides, run the project's checks, and push the branch with \`--force-with-lease\` (or \`gt submit\`).`,
	},
	"address-comments": {
		label: "Address comments",
		description: "Start a session that works through the review comments",
		applies: pr => ownOpen(pr) && (pr.unresolved.count > 0 || pr.review === "changes-requested"),
		prompt: pr => {
			const threads = pr.unresolved.count > 0 ? `${pr.unresolved.exact ? "" : "at least "}${pr.unresolved.count} unresolved review ${pr.unresolved.count === 1 ? "thread" : "threads"}` : null;
			const requested = pr.review === "changes-requested" ? "a reviewer requested changes" : null;
			const has = [threads, requested].filter(clause => clause !== null).join(" and ");
			return `${context(pr)} It has ${has}. Read the threads and reviews, fix what is right in a git worktree on the PR's branch, commit and push, then reply to each thread with what you changed or why you did not change it, and resolve the threads you fixed.`;
		},
	},
	review: {
		label: "Review",
		description: "Start a session that reviews the pull request",
		applies: pr => pr.role === "reviewer" && pr.state !== "merged",
		prompt: pr =>
			`${context(pr)} ${pr.author.login} asked you to review it. Read the description and the diff, check it for correctness, regressions, and missing tests, and report your findings here with file and line references. Do not post anything on GitHub.`,
	},
};

const IDS = Object.keys(QUICK_ACTIONS) as QuickActionId[];

/** The actions that apply to `pr`, in registry order. */
export const actionsFor = (pr: InboxPullRequest): QuickActionId[] => IDS.filter(id => QUICK_ACTIONS[id].applies(pr));
