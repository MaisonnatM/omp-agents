import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { planBrief } from "./checks";
import { FAST_PATH, reviewsBefore, reviewsOf } from "./publish";
import { LABEL, type LiveWork, NEXT, type PrStatus, REVIEW_STAGES, REVIEWS, type ShipState, STAGES, type Stage, type StageOutputs } from "./stages";

/** Live work that repeats until GitHub shows it done, so it runs in counted rounds. */
export type FixWork = Extract<LiveWork, "fix_ci" | "fix_comments">;
export const isFixWork = (work: string | undefined): work is FixWork => work === "fix_ci" || work === "fix_comments";
/** The rounds of one fix: how many started, and the failing-check or open-comment count each round that reported one started with. */
export interface FixRounds {
	rounds: number;
	counts: number[];
}
export type Fixes = Partial<Record<FixWork, FixRounds>>;
/** Rounds a PR gets for one fix before ship_stage refuses another and the agent asks the user. */
export const FIX_BUDGET = 5;
/** Reported counts in a row that did not shrink before ship_stage calls the fix stalled. */
export const STALL_ROUNDS = 2;

/** Cumulative session usage, as omp's session usage statistics report it. */
export interface Spent {
	tokens: number;
	cost: number;
}

export interface Need {
	kind: LiveWork;
	detail: string;
}

export const PR_QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){
state isDraft mergeable mergeStateStatus reviewDecision body changedFiles additions deletions
files(first:100){nodes{path}}
reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}
commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){totalCount nodes{
... on CheckRun{name status conclusion} ... on StatusContext{context state}}}}}}}}}}`;

interface CheckContext {
	name?: string;
	status?: string;
	conclusion?: string | null;
	context?: string;
	state?: string;
}

interface CheckRollup {
	state: string;
	contexts?: { totalCount: number; nodes: CheckContext[] };
}

interface PrResponse {
	state: "OPEN" | "MERGED" | "CLOSED";
	isDraft: boolean;
	mergeable: string;
	mergeStateStatus: string;
	reviewDecision: string | null;
	body: string;
	changedFiles: number;
	additions: number;
	deletions: number;
	files: { nodes: { path: string }[] };
	reviewThreads: { nodes: { isResolved: boolean }[]; pageInfo: { hasNextPage: boolean } };
	commits: { nodes: { commit: { statusCheckRollup: CheckRollup | null } }[] };
}

/** A check that fails until someone approves, such as a `human-review` job: it waits on review, not on a CI fix. */
const REVIEW_GATE = /review|approv/i;
const FAILED: Record<string, true> = { FAILURE: true, ERROR: true, TIMED_OUT: true, CANCELLED: true, STARTUP_FAILURE: true, ACTION_REQUIRED: true };

function contextState(c: CheckContext): PrStatus["checks"] {
	if (c.name === undefined) return c.state === "SUCCESS" ? "pass" : FAILED[c.state ?? ""] ? "fail" : "pending";
	if (c.status !== "COMPLETED") return "pending";
	return FAILED[c.conclusion ?? ""] ? "fail" : "pass";
}

/**
 * The head commit's checks, leaving out a failing review gate while the PR waits for approval, so it reads as waiting
 * for review rather than CI to fix. GitHub's rollup stands when it has more checks than the query returned.
 */
function checksOf(rollup: CheckRollup | null | undefined, approved: boolean): PrStatus["checks"] {
	if (!rollup) return "none";
	const state = rollup.state === "SUCCESS" ? "pass" : rollup.state === "FAILURE" || rollup.state === "ERROR" ? "fail" : "pending";
	const contexts = rollup.contexts;
	if (state !== "fail" || approved || !contexts || contexts.totalCount > contexts.nodes.length) return state;
	const checks = contexts.nodes.map(c => ({ name: c.name ?? c.context ?? "", state: contextState(c) }));
	const rest = checks.filter(c => !(c.state === "fail" && REVIEW_GATE.test(c.name)));
	if (rest.length === checks.length || rest.some(c => c.state === "fail")) return "fail";
	return rest.some(c => c.state === "pending") ? "pending" : "pass";
}

/** The PR's status; `read` returns the text of a paths file in the checkout, `undefined` when it has none. */
export function parsePr(pr: PrResponse, read: (pathsFile: string) => string | undefined): PrStatus {
	const approved = pr.reviewDecision === "APPROVED";
	const threads = pr.reviewThreads.nodes;
	return {
		state: pr.state,
		draft: pr.isDraft,
		conflicts: pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY",
		behind: pr.mergeStateStatus === "BEHIND",
		unresolvedThreads: threads.filter(t => !t.isResolved).length,
		moreThreads: pr.reviewThreads.pageInfo.hasNextPage,
		changesRequested: pr.reviewDecision === "CHANGES_REQUESTED",
		approved,
		checks: checksOf(pr.commits.nodes[0]?.commit.statusCheckRollup, approved),
		reviews: reviewsOf(pr.body, pr.files.nodes.map(file => file.path), pr.changedFiles, read, pr.additions + pr.deletions),
	};
}

/** What a live PR needs, in the order to work it: conflicts, then review threads, then CI. */
export function liveNeeds(s: PrStatus): Need[] {
	const needs: Need[] = [];
	if (s.conflicts) needs.push({ kind: "rebase", detail: "merge conflicts" });
	else if (s.behind) needs.push({ kind: "rebase", detail: "behind base" });
	if (s.moreThreads) needs.push({ kind: "fix_comments", detail: "more than 100 review threads; inspect the full thread list" });
	const review = [s.unresolvedThreads > 0 ? `${s.unresolvedThreads} unresolved threads` : "", s.changesRequested ? "changes requested" : ""];
	if (review.some(Boolean)) needs.push({ kind: "fix_comments", detail: review.filter(Boolean).join(", ") });
	if (s.checks === "fail") needs.push({ kind: "fix_ci", detail: "checks failing" });
	return needs;
}

export function liveSummary(s: PrStatus): string {
	if (s.state === "MERGED") return "merged";
	if (s.state === "CLOSED") return "closed without merge";
	if (s.draft) return "draft; not live for review";
	const needs = liveNeeds(s);
	if (needs.length > 0) return needs.map(n => `${LABEL[n.kind]} (${n.detail})`).join(" · ");
	if (s.approved && s.checks !== "pending") return "approved, check forge mergeability";
	return s.checks === "pending" ? "waiting for review · checks running" : "waiting for review";
}

/** Whether GitHub's status shows `work` done: checks pass for fix_ci, no unresolved review thread for fix_comments. */
export function fixDone(work: FixWork, s: PrStatus): boolean {
	return work === "fix_ci" ? s.checks === "pass" || s.checks === "none" : s.unresolvedThreads === 0 && !s.moreThreads;
}

/** The fix rounds once `s` is GitHub's status: a fix it shows done starts over at its next round. */
export function settleFixes(fixes: Fixes | undefined, s: PrStatus | undefined): Fixes | undefined {
	if (!fixes || !s) return fixes;
	const open = Object.entries(fixes).filter(([work]) => isFixWork(work) && !fixDone(work, s));
	return open.length ? Object.fromEntries(open) : undefined;
}

/**
 * Starts the next round of `work`, which began with `count` failing checks or open comments when the agent reported one,
 * or says why it may not: the fix used its whole budget, or its count did not shrink for two rounds in a row.
 */
export function startFix(fixes: Fixes | undefined, work: FixWork, count: number | undefined): { fixes: Fixes; round: number } | { round: number; refusal: string } {
	const done = fixes?.[work] ?? { rounds: 0, counts: [] };
	const round = done.rounds + 1;
	const ask = `Stop, tell the user what you tried, and ask them with \`ask\` how to proceed; if they approve more rounds, call ship_stage({stage: '${work}', moreRounds: true}).`;
	if (done.rounds >= FIX_BUDGET) {
		return { round, refusal: `${LABEL[work]} has run ${FIX_BUDGET} rounds on this PR without GitHub showing it fixed, so round ${round} is not recorded. ${ask}` };
	}
	const counts = count === undefined ? done.counts : [...done.counts, count];
	const recent = counts.slice(-(STALL_ROUNDS + 1));
	if (count !== undefined && recent.length > STALL_ROUNDS && recent.every((n, i) => i === 0 || n >= recent[i - 1]!)) {
		const noun = work === "fix_ci" ? "failing-check" : "open-comment";
		return { round, refusal: `${LABEL[work]} stalled: the ${noun} count did not shrink for ${STALL_ROUNDS} rounds in a row (${recent.join(" → ")}), so round ${round} is not recorded. ${ask}` };
	}
	return { fixes: { ...fixes, [work]: { rounds: round, counts } }, round };
}

/** One `ship_stage` call as the trace records it. */
export interface TraceLine {
	ts: string;
	session: string;
	repo?: string;
	pr?: number;
	stage: Stage | LiveWork;
	model?: string;
	/** Tokens and cost the session spent since the previous traced stage, or since it started. */
	tokens: number;
	cost: number;
	/** The round of a fix stage, recorded or refused. */
	round?: number;
	/** GitHub's checks on the PR when the call read them: pass, fail, pending, or none. */
	checks?: PrStatus["checks"];
	recorded: boolean;
	/** Why the stage was not recorded, when the call said so. */
	refusal?: string;
	/** The stage outputs the call carried. */
	output?: StageOutputs;
	/** Whether GitHub's status put the PR's diff on the fast path, which skips both reviews; absent while the status is unknown. */
	fastPath?: boolean;
}

/** Appends `line` to the JSONL trace every `ship_stage` call naming a stage writes to, across this user's sessions and repositories, beside the kit's other GitHub state. */
export function appendTrace(line: TraceLine) {
	const file = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "ship-trace.jsonl");
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, `${JSON.stringify(line)}\n`);
}

export function renderLines(s: ShipState): string[] {
	const at = STAGES.indexOf(s.stage);
	const ref = [s.issue, s.pr ? `PR #${s.pr}${s.prStatus?.draft ? " (draft)" : ""}` : ""].filter(Boolean).join(" · ");
	const lines = [`ship ${ref || (at > 0 ? "(no ticket)" : "(no ticket yet)")}`];
	const mark = (stage: Stage) => {
		const i = STAGES.indexOf(stage);
		return `${i < at || s.stage === "merged" ? "✓" : i === at ? "▶" : "○"} ${LABEL[stage]}`;
	};
	const reviews = STAGES.indexOf(REVIEW_STAGES[0]);
	lines.push(STAGES.slice(0, reviews).map(mark).join("  "), STAGES.slice(reviews).map(mark).join("  "));
	if (s.stage === "live" && s.prStatus) lines.push(`Live: ${liveSummary(s.prStatus)}`);
	if (s.stage === "live" && s.work) lines.push(`Working on: ${LABEL[s.work]}`);
	for (const stage of REVIEW_STAGES) {
		const review = s.prStatus?.reviews[stage];
		const { label, pathsFile } = REVIEWS[stage];
		if (review?.needed && !review.done && reviewsBefore(s.stage).includes(stage) && at <= STAGES.indexOf("ready_gate")) lines.push(`${label} checkbox missing from the PR body`);
		if (review?.fastPath && s.stage === stage) lines.push(`${label} skipped on the fast path: the PR changes at most ${FAST_PATH.lines} lines in ${FAST_PATH.files} files, none a schema or shared-contract file`);
		else if (review && !review.needed && s.stage === stage) lines.push(`${label} not needed: \`${pathsFile}\` lists no changed file`);
	}
	if (s.note) lines.push(`Note: ${s.note}`);
	return lines;
}

export function statusText(s: ShipState): string {
	const ref = [s.issue, s.pr ? `#${s.pr}` : ""].filter(Boolean).join(" ");
	const where = s.stage === "live" ? `Live: ${s.work ? LABEL[s.work] : s.prStatus ? liveSummary(s.prStatus) : "…"}` : LABEL[s.stage];
	return `ship ${ref} › ${where}`.replace(/\s+/g, " ");
}

export function report(s: ShipState | undefined): string {
	if (!s) return "No /ship workflow in this session yet. Start with ship_stage({stage: 'ticket'}).";
	const lines = renderLines(s);
	lines.push(`Repo: ${s.repo ?? "unknown"}`);
	lines.push(`Next: ${NEXT[s.stage]}`);
	const brief = planBrief(s);
	if (brief) lines.push(brief);
	for (const post of s.posts ?? []) lines.push(`Posted: ${post.kind} for PR #${post.pr}, ${post.ref}; do not post it again.`);
	if (s.stage === "live" && s.prStatus) {
		const needs = liveNeeds(s.prStatus);
		if (needs.length > 0) lines.push(`First need: ${LABEL[needs[0].kind]}. Record it with ship_stage({stage: '${needs[0].kind}'}).`);
	}
	return lines.join("\n");
}
