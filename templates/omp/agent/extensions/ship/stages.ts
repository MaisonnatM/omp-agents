import type { Fixes, Spent } from "./live";

/** A proof box a repository's PR template declares; the PR goes live only once the author checks it. The gate reads the box, not the proof behind it. */
export const PROOF_BOX = "- [ ] Browser proof";

// The plan comes before any code, so the implementation follows an approach chosen against its alternatives.
// The interface review comes before the thermonuclear one, so the code-quality review sees the interface fixes.
export const STAGES = ["ticket", "plan", "implement", "draft_pr", "interface_review", "thermonuclear", "ready_gate", "live", "merged"] as const;
export type Stage = (typeof STAGES)[number];
export const LIVE_WORK = ["rebase", "fix_comments", "fix_ci"] as const;
export type LiveWork = (typeof LIVE_WORK)[number];

/** A review a PR's changed files call for, proven by a checked box in the PR body. */
export interface Review {
	label: string;
	box: string;
	/** The repository's file of globs whose changes need the review; see `reviewNeeded`. */
	pathsFile: string;
	/** Needed when the repository commits no `pathsFile`. */
	withoutPaths: boolean;
}
/** Each review by the stage that runs it. */
export const REVIEWS = {
	interface_review: { label: "Interface review", box: "- [x] Interface review", pathsFile: ".omp/ui-paths", withoutPaths: false },
	thermonuclear: { label: "Thermonuclear", box: "- [x] Thermo-nuclear code quality review", pathsFile: ".omp/review-paths", withoutPaths: true },
} as const satisfies Partial<Record<Stage, Review>>;
export type ReviewStage = keyof typeof REVIEWS;
export const isReviewStage = (stage: string): stage is ReviewStage => Object.hasOwn(REVIEWS, stage);
/** The review stages in workflow order. */
export const REVIEW_STAGES = STAGES.filter(isReviewStage);
/** Each review's state for one PR: whether its changed files call for it, whether its body has the box, and whether a small change skips it on the fast path. */
export type Reviews = Record<ReviewStage, { needed: boolean; done: boolean; fastPath?: true }>;

export function byReview<T>(value: (stage: ReviewStage) => T): Record<ReviewStage, T> {
	return Object.fromEntries(REVIEW_STAGES.map(stage => [stage, value(stage)])) as Record<ReviewStage, T>;
}

/** Stages after the first review, and all live work, decide from GitHub's current PR status, never a stale one. */
export const NEEDS_CURRENT_STATUS: readonly string[] = [...STAGES.slice(STAGES.indexOf(REVIEW_STAGES[0]) + 1), ...LIVE_WORK];

export const LABEL: Record<Stage | LiveWork, string> = {
	ticket: "Ticket",
	plan: "Plan",
	implement: "Implement",
	draft_pr: "Draft PR",
	interface_review: REVIEWS.interface_review.label,
	thermonuclear: REVIEWS.thermonuclear.label,
	ready_gate: "Ready gate",
	live: "Live for review",
	merged: "Merged",
	rebase: "Rebase",
	fix_comments: "Fix review comments",
	fix_ci: "Fix CI",
};

export const NEXT: Record<Stage, string> = {
	ticket: "Link the Linear issue the user named, or an open one that clearly matches the work, then record ship_stage({stage: 'plan', issue}); with no issue, record ship_stage({stage: 'plan'}).",
	plan: "Choose how to build the change as the ship skill's Plan step says, then record ship_stage({stage: 'implement'}).",
	implement: "Implement the plan and commit on the work's branch. Do not open a PR in this stage.",
	draft_pr: "If ship_stage named an open PR for the branch, reuse it: push the branch and record ship_stage({stage: 'interface_review'}). Otherwise push the branch and run `gh pr create --draft`. Reference the issue, or put the plan in the body without one, as the ship skill's Draft PR step says.",
	interface_review: `If the status says the reviews are skipped on the fast path, run neither review: record ship_stage({stage: 'ready_gate', output: {ready_gate: {checks}}}), which records both as skipped. If it says the ${REVIEWS.interface_review.label} is not needed because \`${REVIEWS.interface_review.pathsFile}\` lists no changed file, record ship_stage({stage: 'thermonuclear'}) and move on. Otherwise wait until the user approves the direction, then spawn \`interface-reviewer\` on the PR and, unless the ${REVIEWS.thermonuclear.label} is not needed, \`thermonuclear-reviewer\` on the PR diff, in one \`task\` call, apply both reviews' findings in one fresh agent, push, then record ship_stage({stage: 'thermonuclear'}), which checks \`${REVIEWS.interface_review.box}\` in the PR body.`,
	thermonuclear: `If the status says the ${REVIEWS.thermonuclear.label} is skipped on the fast path, or not needed because \`${REVIEWS.thermonuclear.pathsFile}\` lists no changed file, skip the review. Otherwise, if thermonuclear-reviewer already ran alongside the ${REVIEWS.interface_review.label}, run it again on the interface fix commits alone unless they changed only copy, tokens, or styles; if not, wait until the user approves the direction, then run thermonuclear-reviewer on the PR diff; apply the findings, push, then record ship_stage({stage: 'ready_gate'}), which checks \`${REVIEWS.thermonuclear.box}\` in the PR body. If the ${REVIEWS.interface_review.label} was needed and the body has an unchecked \`${PROOF_BOX}\` box, do what the repository asks for it, then check it.`,
	ready_gate: `When the ${REVIEWS.interface_review.label} was needed, make sure the PR body has no unchecked \`${PROOF_BOX}\` box. Then run \`gh pr ready <N>\` without asking first: the command itself asks the user to approve.`,
	live: "Work the first need below. Stop when the forge reports merge-ready or while waiting for review. Never merge without an explicit request.",
	merged: "Done.",
};

export interface PrStatus {
	state: "OPEN" | "MERGED" | "CLOSED";
	draft: boolean;
	conflicts: boolean;
	behind: boolean;
	unresolvedThreads: number;
	changesRequested: boolean;
	moreThreads: boolean;
	approved: boolean;
	checks: "pass" | "fail" | "pending" | "none";
	reviews: Reviews;
}

export interface ShipState {
	stage: Stage;
	work?: LiveWork;
	issue?: string;
	repo?: string;
	pr?: number;
	note?: string;
	prStatus?: PrStatus;
	/** This PR's fix rounds since GitHub last showed each fix done. */
	fixes?: Fixes;
	/** The plan's contract, recorded at the plan stage; implement starts only once it holds one. */
	contract?: Contract;
	/** Approaches a reviewer or the user rejected, so the agent never proposes them again. */
	rejected?: string[];
	/** What each finished stage produced; advancing to a stage needs the output of the stage before it. */
	outputs?: StageOutputs;
	/** Slack posts and Linear links made for the run's PRs, so a resumed run never makes one twice. */
	posts?: Post[];
	/** The session's cumulative usage at the last traced stage, so the next trace line reports what was spent since. */
	spent?: Spent;
	updatedAt: string;
}

/** What the implementation builds toward, written at the plan stage and judged against before the PR. */
export interface Contract {
	goal: string;
	constraints: string[];
	/** Repository-relative paths. */
	files_to_change: string[];
	/** The test written before the code, or `null` when the change starts without one. */
	test_first: string | null;
	done_when: string[];
	/** The Linear issue the contract was drafted from, or `null` for a run without one. */
	source: string | null;
}

/** One check a stage ran, with the result line it printed. */
export interface CheckRun {
	command: string;
	result: string;
}

/** What became of one review finding. */
export interface ReviewVerdict {
	finding: string;
	verdict: "fixed" | "dismissed" | "deferred";
}

/** What became of one review's findings; `skipped` says a small change skipped the review on the fast path. */
export interface ReviewOutput {
	verdicts: ReviewVerdict[];
	skipped?: "fast-path";
}

/** What each finished stage produced, recorded by the call that leaves it; the plan's output is the contract. */
export interface StageOutputs {
	implement?: { files_changed: string[]; checks_run: CheckRun[] };
	draft_pr?: { pr: number; url: string };
	interface_review?: ReviewOutput;
	thermonuclear?: ReviewOutput;
	ready_gate?: { checks: CheckRun[] };
}
export type OutputStage = keyof StageOutputs;

/** The fields of each stage's output, as a refusal names them. */
const OUTPUT_FIELDS: Record<OutputStage, string> = {
	implement: "files_changed: [repository-relative paths], checks_run: [{command, result}]",
	draft_pr: "pr: <number>, url: <the PR's URL>",
	interface_review: "verdicts: [{finding, verdict: fixed | dismissed | deferred}], empty when the review was skipped or found nothing",
	thermonuclear: "verdicts: [{finding, verdict: fixed | dismissed | deferred}], empty when the review was skipped or found nothing",
	ready_gate: "checks: [{command, result}]",
};

/** The stage whose output each stage starts from. */
const STARTS_FROM: Partial<Record<Stage | LiveWork, OutputStage>> = { draft_pr: "implement", interface_review: "draft_pr", thermonuclear: "interface_review", ready_gate: "thermonuclear", live: "ready_gate" };

/**
 * The output that advancing from `from` to `stage` needs and `outputs` lacks, with the `output` argument that records it, or `undefined` when nothing is missing.
 * Only advancing needs it: recording the current stage again, or an earlier one, does not.
 */
export function missingOutput(stage: Stage | LiveWork, from: Stage, outputs: StageOutputs | undefined): { stage: OutputStage; argument: string } | undefined {
	const needed = STARTS_FROM[stage];
	if (!needed || (STAGES as readonly string[]).indexOf(stage) <= STAGES.indexOf(from) || outputs?.[needed]) return undefined;
	return { stage: needed, argument: `{${needed}: {${OUTPUT_FIELDS[needed]}}}` };
}

/**
 * `outputs` with an empty verdict list marked `skipped: "fast-path"` for each review before `stage` that `reviews` put on the fast path and `outputs` lacks,
 * so a small change advances past its reviews without running them.
 */
export function withFastPath(stage: Stage | LiveWork, outputs: StageOutputs, reviews: Reviews | undefined): StageOutputs {
	const at = (STAGES as readonly string[]).indexOf(stage);
	const next = { ...outputs };
	for (const review of REVIEW_STAGES) {
		if (reviews?.[review].fastPath && STAGES.indexOf(review) < at && !next[review]) next[review] = { verdicts: [], skipped: "fast-path" };
	}
	return next;
}

/** The repository (`owner/name`) and number of a pull request URL, else `undefined`. */
export function prOfUrl(url: string): { repo: string; pr: number } | undefined {
	const match = url.match(/^https?:\/\/[^/\s]+\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)\/?$/);
	return match ? { repo: match[1], pr: Number(match[2]) } : undefined;
}

/** A Slack post or Linear link made for a PR, with its permalink or URL. */
export interface Post {
	kind: "slack" | "linear";
	pr: number;
	ref: string;
}

/** `posts` with `post` added, or the post already recorded for the same kind and PR, which makes recording it again a no-op. */
export function withPost(posts: Post[] | undefined, post: Post): { posts: Post[] } | { existing: Post } {
	const existing = posts?.find(p => p.kind === post.kind && p.pr === post.pr);
	return existing ? { existing } : { posts: [...(posts ?? []), post] };
}
