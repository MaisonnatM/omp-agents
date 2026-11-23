// Tracks the /ship workflow (optional Linear ticket -> plan -> draft PR -> reviews -> live for review) per session.
// The agent declares the stage it works on through the `ship_stage` tool. GitHub decides what a live PR
// needs next (rebase, review comments, CI), so that part is polled, never declared.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { commands, located, positionals } from "./shell/commands";
import { quotaExhausted } from "./github/access";
import { type GhCredential, GhRunner, rejectedCredential, TOKEN_VARIABLE } from "./github/runner";
import { descriptionSnapshot, editDescription } from "./github/description";

const ENTRY = "omp-ship.state";
/** The message that puts the contract and rejected approaches back in the agent's context after a compaction or a resume. */
const BRIEF = "omp-ship.brief";
const WIDGET = "omp-ship";
/** A proof box a repository's PR template declares; the PR goes live only once the author checks it. The gate reads the box, not the proof behind it. */
export const PROOF_BOX = "- [ ] Browser proof";
const POLL_MS = 60_000;
const TURN_REFRESH_MS = 15_000;

// The plan comes before any code, so the implementation follows an approach chosen against its alternatives.
// The interface review comes before the thermonuclear one, so the code-quality review sees the interface fixes.
export const STAGES = ["ticket", "plan", "implement", "draft_pr", "interface_review", "thermonuclear", "ready_gate", "live", "merged"] as const;
export type Stage = (typeof STAGES)[number];
export const LIVE_WORK = ["rebase", "fix_comments", "fix_ci"] as const;
export type LiveWork = (typeof LIVE_WORK)[number];

/** A review a PR's changed files call for, proven by a checked box in the PR body. */
interface Review {
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
const isReviewStage = (stage: string): stage is ReviewStage => Object.hasOwn(REVIEWS, stage);
/** The review stages in workflow order. */
const REVIEW_STAGES = STAGES.filter(isReviewStage);
/** Each review's state for one PR: whether its changed files call for it, whether its body has the box, and whether a small change skips it on the fast path. */
export type Reviews = Record<ReviewStage, { needed: boolean; done: boolean; fastPath?: true }>;

function byReview<T>(value: (stage: ReviewStage) => T): Record<ReviewStage, T> {
	return Object.fromEntries(REVIEW_STAGES.map(stage => [stage, value(stage)])) as Record<ReviewStage, T>;
}

/** Stages after the first review, and all live work, decide from GitHub's current PR status, never a stale one. */
const NEEDS_CURRENT_STATUS: readonly string[] = [...STAGES.slice(STAGES.indexOf(REVIEW_STAGES[0]) + 1), ...LIVE_WORK];

const LABEL: Record<Stage | LiveWork, string> = {
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

const NEXT: Record<Stage, string> = {
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

/** Whether `path` names a file inside the repository: relative, and never climbing out through `..`. */
export function repoRelative(path: string): boolean {
	return /\S/.test(path) && !/^(?:[\\/~]|[A-Za-z]:)/.test(path) && !path.split(/[\\/]/).includes("..");
}

/** The test files `contract` plans to change, unless a constraint names `test-change`, the reason an existing test may change on purpose. */
export function plannedTestEdits(contract: Contract): string[] {
	if (contract.constraints.some(constraint => /test-change/i.test(constraint))) return [];
	return contract.files_to_change.filter(path => /\.test\.tsx?$/.test(path));
}

/** The stages that claim the change works, so each needs a passing check after the last file change. */
export const VERIFIED_STAGES: readonly Stage[] = ["draft_pr", "ready_gate"];
/** Tools whose call may change files in the checkout; a `task` subagent may edit, so it counts too. */
const EDIT_TOOLS: Record<string, true> = { edit: true, write: true, ast_edit: true, notebook: true, task: true };
/** A package script that checks the change, such as `test`, `test:agent`, `typecheck`, or `lint`. */
const CHECK_SCRIPT = /^(?:test|typecheck|lint|check|tsc|verify)(?:[:._-]|$)/;
/** A program that is itself a check. */
const CHECK_PROGRAMS: Record<string, true> = { tsc: true, vitest: true, jest: true, pytest: true, eslint: true, biome: true, mypy: true, ruff: true };
/** Words in front of the program they run, which a check may sit behind. */
const PREFIXES: Record<string, true> = { time: true, nice: true, nohup: true, command: true, exec: true };

/** One tool call of the session, with whether its result was an error. */
export interface ToolRun {
	name: string;
	input: Record<string, unknown>;
	ok: boolean;
}

/** The fields of a session entry's message that `toolRuns` reads; omp's `SessionEntry` holds them. */
interface BranchMessage {
	role: string;
	content?: unknown;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
}

/** The tool calls in `entries`, a session branch, in the order their results arrived. */
export function toolRuns(entries: readonly { type: string; message?: BranchMessage }[]): ToolRun[] {
	const inputs = new Map<string, Record<string, unknown>>();
	const runs: ToolRun[] = [];
	for (const { type, message } of entries) {
		if (type !== "message" || !message) continue;
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block?.type === "toolCall" && typeof block.id === "string") inputs.set(block.id, block.arguments ?? {});
			}
		} else if (message.role === "toolResult" && message.toolName) {
			runs.push({ name: message.toolName, input: inputs.get(message.toolCallId ?? "") ?? {}, ok: message.isError !== true });
		}
	}
	return runs;
}

/** The single commands a repository's `.omp/land.json` lists as checks, each as its words; a shell line that runs several commands is left out. */
export function declaredChecks(landJson: string | undefined): string[][] {
	if (!landJson) return [];
	let checks: unknown;
	try {
		checks = (JSON.parse(landJson) as { checks?: unknown }).checks;
	} catch {
		return [];
	}
	if (!Array.isArray(checks)) return [];
	return checks.flat().flatMap(check => {
		if (typeof check !== "string") return [];
		const ran = commands(check);
		return ran.length === 1 && ran[0].length >= 2 ? ran : [];
	});
}

/** Whether a command's `words` run a test, typecheck, or lint: one `declared` by the repository, a package `test` script or one named like a check, or a checker such as `tsc`; `heavy.py` and prefixes like `time` are looked through. */
export function isCheckCommand(words: string[], declared: string[][]): boolean {
	let w = words;
	while (w.length > 0 && PREFIXES[w[0]]) w = w.slice(1);
	if (w[0] === "timeout") w = w.slice(2);
	const heavy = w.findIndex(word => word.endsWith("heavy.py"));
	if (heavy !== -1 && heavy <= 1) {
		const rest = w.slice(heavy + 1);
		// The shell applies redirections such as `2>&1`, so heavy.py gets the script alone.
		const script = positionals(rest);
		return script.length === 1 ? commands(script[0]).some(inner => isCheckCommand(inner, declared)) : isCheckCommand(rest, declared);
	}
	if (w.length === 0) return false;
	if (declared.some(check => check.every((word, i) => w[i] === word))) return true;
	const [run, sub = "", script = ""] = w;
	const name = run.split("/").pop() ?? run;
	if (CHECK_PROGRAMS[name]) return true;
	if (/^(?:bunx|npx|pnpx|uvx)$/.test(name)) return isCheckCommand(w.slice(1), declared);
	if (/^(?:bun|npm|pnpm|yarn)$/.test(name)) return sub === "test" || (sub === "run" ? CHECK_SCRIPT.test(script) : name !== "bun" && name !== "npm" && CHECK_SCRIPT.test(sub));
	if (name === "cargo") return /^(?:test|check|clippy|nextest)$/.test(sub);
	if (name === "go") return sub === "test" || sub === "vet";
	if (name === "make" || name === "just") return CHECK_SCRIPT.test(sub);
	if (/^python3?$/.test(name)) return sub === "-m" && CHECK_PROGRAMS[script] === true;
	if (name === "uv") return sub === "run" && isCheckCommand(w.slice(2), declared);
	return false;
}

/**
 * Why `stage` may not be recorded yet, or `undefined` when it may: a stage that claims the change works needs a bash check,
 * such as the tests or the typecheck, that exited 0 in this session after the last tool call that may have changed files.
 */
export function verificationRefusal(stage: Stage, runs: ToolRun[], declared: string[][]): string | undefined {
	let lastEdit: ToolRun | undefined;
	let checked = false;
	for (const run of runs) {
		if (EDIT_TOOLS[run.name] && (run.ok || run.name === "task")) {
			lastEdit = run;
			checked = false;
		} else if (run.name === "bash" && run.ok && run.input.async !== true && typeof run.input.command === "string" && commands(run.input.command).some(words => isCheckCommand(words, declared))) {
			checked = true;
		}
	}
	if (checked) return undefined;
	const since = lastEdit ? ` since the last \`${lastEdit.name}\` call` : "";
	const checks = declared.length > 0 ? `, such as ${declared.map(words => `\`${words.join(" ")}\``).join(", ")} from .omp/land.json,` : "";
	return `${stage} is not recorded: no test, typecheck, or lint command passed in this session${since}, so nothing shows the change works. Run the repository's checks${checks} in this session with bash and without async, fix what fails, then record ${stage} again and quote each check's result line in your report.`;
}

/** One commit of the branch with the files it changes. */
export interface BranchCommit {
	sha: string;
	files: string[];
}

/** The commits of `git log --reverse --no-merges --format=%x00%h --name-only`, oldest first. */
export function parseBranchLog(stdout: string): BranchCommit[] {
	return stdout.split("\0").slice(1).map(chunk => {
		const [sha, ...files] = chunk.split("\n").map(line => line.trim()).filter(Boolean);
		return { sha, files };
	});
}

/** Whether `path` is a test file by its name or directory. */
export function isTestFile(path: string): boolean {
	return /(?:^|\/)(?:tests?|__tests__|spec)\/|[._-](?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/.test(path);
}

/**
 * Why a branch with a `test_first` contract may not get its draft PR, or `undefined` when it may: a commit changing only the test
 * `test_first` names, or any test file when it names no path the branch changes, must come before the first commit changing code; Markdown is not code.
 */
export function testFirstRefusal(contract: Contract, commits: BranchCommit[], base: string): string | undefined {
	const test = contract.test_first;
	if (!test) return undefined;
	const changed = [...new Set(commits.flatMap(commit => commit.files))];
	const named = changed.filter(path => test.includes(path));
	const isTest = named.length > 0 ? (path: string) => named.includes(path) : isTestFile;
	const isCode = (path: string) => !isTestFile(path) && !/\.mdx?$/i.test(path);
	const firstTest = commits.findIndex(commit => commit.files.some(isTest) && !commit.files.some(isCode));
	const firstCode = commits.findIndex(commit => commit.files.some(isCode));
	if (firstTest !== -1 && (firstCode === -1 || firstTest < firstCode)) return undefined;
	const tests = (named.length > 0 ? named : changed.filter(isTestFile)).map(path => `\`${path}\``).join(", ");
	const found = firstCode === -1 || !tests
		? `no commit on this branch changes ${tests || "a test file"} on its own`
		: `${commits[firstCode].sha} changes code before any commit that changes only ${tests}`;
	return `draft_pr is not recorded: the contract's test_first is "${test}", but ${found}. A bug fix commits its failing test first, so the history shows the test failing before the fix. Run \`git reset --soft ${base}\`, commit only the test (\`git commit -m "<test subject>" -- <test file>\`), check that it fails, commit the rest, then record draft_pr again.`;
}

/** `rejected` with `approach` appended, unless it already holds it, ignoring case and spacing. */
export function withRejected(rejected: string[] | undefined, approach: string): string[] {
	const key = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
	const list = rejected ?? [];
	return list.some(entry => key(entry) === key(approach)) ? list : [...list, approach.trim()];
}

/** The contract and the rejected approaches as the agent reads them, or `undefined` when the run recorded neither. */
export function planBrief(s: Pick<ShipState, "contract" | "rejected">): string | undefined {
	const lines: string[] = [];
	const list = (label: string, items: string[]) => {
		if (items.length > 0) lines.push(`${label}:`, ...items.map(item => `- ${item}`));
	};
	if (s.contract) {
		lines.push(`Contract goal: ${s.contract.goal}`);
		list("Constraints", s.contract.constraints);
		list("Files to change", s.contract.files_to_change);
		lines.push(`Test first: ${s.contract.test_first ?? "none"}`);
		list("Done when", s.contract.done_when);
	}
	list("Rejected approaches, never to propose again", s.rejected ?? []);
	return lines.length > 0 ? lines.join("\n") : undefined;
}

/** Live work that repeats until GitHub shows it done, so it runs in counted rounds. */
export type FixWork = Extract<LiveWork, "fix_ci" | "fix_comments">;
const isFixWork = (work: string | undefined): work is FixWork => work === "fix_ci" || work === "fix_comments";
/** The rounds of one fix: how many started, and the failing-check or open-comment count each round that reported one started with. */
export interface FixRounds {
	rounds: number;
	counts: number[];
}
export type Fixes = Partial<Record<FixWork, FixRounds>>;
/** Rounds a PR gets for one fix before ship_stage refuses another and the agent asks the user. */
export const FIX_BUDGET = 5;
/** Reported counts in a row that did not shrink before ship_stage calls the fix stalled. */
const STALL_ROUNDS = 2;

/** Cumulative session usage, as omp's session usage statistics report it. */
export interface Spent {
	tokens: number;
	cost: number;
}

export interface Need {
	kind: LiveWork;
	detail: string;
}

const PR_QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){
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
function appendTrace(line: TraceLine) {
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

function report(s: ShipState | undefined): string {
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

/** Whether a command's words open a PR that is not a draft, which the tool_call gate blocks. */
export function opensLivePr(words: string[]): boolean {
	const create = ghPr(words, "create");
	return create !== undefined && !create.some(a => a === "--draft" || a === "-d" || a.startsWith("--draft="));
}

/** The arguments of `gh pr <sub>` when the command's words run it, including any `-R` given before `<sub>`, else `undefined`. */
export function ghPr(words: string[], sub: "create" | "ready"): string[] | undefined {
	if (words[0] !== "gh" || words[1] !== "pr") return undefined;
	let i = 2;
	while (/^(?:-R|--repo(?:=|$))/.test(words[i] ?? "")) i += words[i] === "-R" || words[i] === "--repo" ? 2 : 1;
	return words[i] === sub ? [...words.slice(2, i), ...words.slice(i + 1)] : undefined;
}

/** The `gh pr view` selector for `gh pr ready <args>`: its first positional (number, URL, or branch) and `--repo`; redirections and other flags drop. */
export function prSelector(args: string[]): string[] {
	const repo: string[] = [];
	let positional: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const redirect = arg.match(/^(?:\d*|&)(?:>&|<&|>>|<<|>|<)(.*)$/);
		if (redirect) {
			// A bare operator such as `>` takes the next word as its target.
			if (!redirect[1]) i++;
		} else if (arg === "-R" || arg === "--repo") {
			if (i + 1 < args.length) repo.splice(0, 2, "--repo", args[++i]);
		} else if (/^(--repo=|-R)./.test(arg)) {
			repo.splice(0, 2, "--repo", arg.replace(/^(--repo=|-R)/, ""));
		} else if (!arg.startsWith("-")) {
			positional ??= arg;
		}
	}
	return positional === undefined ? repo : [positional, ...repo];
}

/** The owner a selector names through `--repo` (`owner/name`, `host/owner/name`, or a URL) or a pull request URL, else `undefined`. */
export function selectorOwner(selector: string[]): string | undefined {
	const flag = selector.indexOf("--repo");
	if (flag >= 0) {
		const parts = (selector[flag + 1] ?? "").replace(/^https?:\/\//, "").split("/").filter(Boolean);
		return parts.length >= 3 ? parts[1] : parts[0];
	}
	return selector[0]?.match(/^https?:\/\/[^/]+\/([^/]+)\/[^/]+\/pull\/\d+/)?.[1];
}

/** Whether `owner` differs from the owner of the repository `repo` (`owner/name`), case-insensitively; `false` when either is unknown. */
export function otherOwner(owner: string | undefined, repo: string | undefined): boolean {
	const own = repo?.split("/")[0];
	return owner !== undefined && own !== undefined && owner.toLowerCase() !== own.toLowerCase();
}

/** The most a PR may change and still take the fast path, which skips the arena and both reviews. */
export const FAST_PATH = { lines: 50, files: 3 } as const;
/** Paths of files that define a schema or a public interface, which never take the fast path whatever the diff's size. */
const INTERFACE_FILE = /(^|\/)(schema|openapi|swagger)[^/]*$|\.(proto|graphql|gql|sql|d\.ts)$|(^|\/)migrations?\/|(^|\/)package\.json$/i;

/** The globs of a paths file: one per line, where `#` starts a comment and blank lines are ignored. */
function globsOf(paths: string): Bun.Glob[] {
	return paths.split("\n").map(line => line.replace(/#.*/, "").trim()).filter(Boolean).map(glob => new Bun.Glob(glob));
}

/**
 * Whether a PR changing `files`, `changedFiles` in all, with `changedLines` added plus deleted, may take the fast path: at most `FAST_PATH.lines` lines in `FAST_PATH.files` files,
 * every one listed, none a schema or public-interface file, and none matching the shared contracts `reviewPaths`, the text of `.omp/review-paths`, lists.
 */
export function smallChange(files: string[], changedFiles: number, changedLines: number, reviewPaths: string | undefined): boolean {
	if (changedLines > FAST_PATH.lines || changedFiles > FAST_PATH.files || files.length < changedFiles) return false;
	const contracts = reviewPaths === undefined ? [] : globsOf(reviewPaths);
	return !files.some(file => INTERFACE_FILE.test(file) || contracts.some(glob => glob.match(file)));
}

/**
 * Whether a PR needs `review`: when the repository commits no `review.pathsFile` (`paths` is `undefined`), only if the review has `withoutPaths`;
 * else always when GitHub listed fewer `files` than the PR's `changedFiles`, and otherwise when a changed repository-relative path matches one of its globs.
 */
export function reviewNeeded(review: Review, paths: string | undefined, files: string[], changedFiles: number): boolean {
	if (paths === undefined) return review.withoutPaths;
	if (files.length < changedFiles) return true;
	const globs = globsOf(paths);
	return files.some(file => globs.some(glob => glob.match(file)));
}

/**
 * Each review's state for a PR with this body that changes `files`; `read` returns the text of a paths file in the checkout, `undefined` when it has none.
 * `changedLines`, the PR's added plus deleted lines, lets a small change skip both reviews on the fast path; while it is unknown, every review the paths call for stays needed.
 */
export function reviewsOf(body: string, files: string[], changedFiles: number, read: (pathsFile: string) => string | undefined, changedLines?: number): Reviews {
	const fast = changedLines !== undefined && smallChange(files, changedFiles, changedLines, read(REVIEWS.thermonuclear.pathsFile));
	return byReview(stage => ({
		needed: !fast && reviewNeeded(REVIEWS[stage], read(REVIEWS[stage].pathsFile), files, changedFiles),
		done: body.includes(REVIEWS[stage].box),
		...(fast ? { fastPath: true as const } : {}),
	}));
}

/** The reviews whose stages come before `stage`. */
function reviewsBefore(stage: Stage): ReviewStage[] {
	return REVIEW_STAGES.filter(review => STAGES.indexOf(review) < STAGES.indexOf(stage));
}

/** The first review, in stage order, that runs before `stage` and that the PR needs without its box. */
function missingReview(reviews: Reviews, stage: Stage): ReviewStage | undefined {
	return reviewsBefore(stage).find(review => reviews[review].needed && !reviews[review].done);
}

/**
 * A reader returning the text of a paths file from the top of the checkout holding `dir`, or `undefined` when it has none.
 * A linked worktree without the file reads its main checkout's, so a paths file kept out of git, in `.git/info/exclude`, covers every worktree.
 */
function checkoutReader(dir: string): (pathsFile: string) => string | undefined {
	let root: string | undefined;
	for (let at = dir; ; at = dirname(at)) {
		if (existsSync(join(at, ".git"))) {
			root = at;
			break;
		}
		if (dirname(at) === at) break;
	}
	const roots = root === undefined ? [] : [root];
	const main = root === undefined ? undefined : mainCheckoutOf(root);
	if (main !== undefined) roots.push(main);
	return pathsFile => {
		for (const at of roots) {
			const file = join(at, pathsFile);
			if (existsSync(file)) return readFileSync(file, "utf8");
		}
		return undefined;
	};
}

/** The main checkout of the linked worktree at `root`, read from its `.git` file's `gitdir: <main>/.git/worktrees/<name>`, or `undefined` for a main checkout. */
function mainCheckoutOf(root: string): string | undefined {
	const git = join(root, ".git");
	if (!statSync(git).isFile()) return undefined;
	const gitdir = /^gitdir: (.+)$/m.exec(readFileSync(git, "utf8"))?.[1]?.trim();
	const at = gitdir?.lastIndexOf("/.git/worktrees/") ?? -1;
	return gitdir !== undefined && at > 0 ? gitdir.slice(0, at) : undefined;
}

/**
 * Why a PR with this body may not go live, or `undefined` when it may: it needs the box of every review `reviews` calls for,
 * and no unchecked proof box while the interface review is needed, since only an interface change has a page to prove.
 */
export function publishBlocker(body: string, reviews: Reviews): string | undefined {
	const missing = missingReview(reviews, "live");
	if (missing) {
		const { label, box } = REVIEWS[missing];
		return `Blocked: the PR is not live until the ${label} stage is done. Run it, apply and push its fixes, then add \`${box}\` to the PR body.`;
	}
	if (reviews.interface_review.needed && body.split("\n").some(line => line.trimStart().startsWith(PROOF_BOX))) {
		return `Blocked: the PR body has an unchecked \`${PROOF_BOX}\` box from the repository's PR template, and a changed file matches \`${REVIEWS.interface_review.pathsFile}\`. Do what the box and the repository's instructions ask, then check it.`;
	}
	return undefined;
}

/**
 * Why GitHub rejects gh, or `undefined` when it accepts every credential gh uses: the credential and where it comes from, never a token.
 * `dotenvFiles` maps an environment variable to the project dotenv file its value came from.
 */
export function authDiagnosis(credentials: GhCredential[], dotenvFiles: Record<string, string>): string | undefined {
	const rejected = rejectedCredential(credentials);
	if (!rejected) return undefined;
	const login = `\`gh auth login -h ${rejected.host}\``;
	if (!TOKEN_VARIABLE.test(rejected.tokenSource)) {
		return `GitHub rejects gh's ${rejected.tokenSource} login${rejected.login ? ` for ${rejected.login}` : ""} on ${rejected.host}. Ask the user to run ${login}.`;
	}
	const file = dotenvFiles[rejected.tokenSource];
	return [
		`GitHub rejects the token in \`${rejected.tokenSource}\`, which gh uses for ${rejected.host}.`,
		file ? `omp read it from \`${file}\` when it started.` : "It is set in the environment omp started with.",
		`Ask the user to replace it there, or remove it and run ${login}, then restart the session.`,
	].join(" ");
}

/** The dotenv file in `dir` each environment variable's current value came from: Bun loads `.env` and its variants from the directory omp starts in, except variables the launch environment already set. */
function dotenvFiles(dir: string): Record<string, string> {
	const files: Record<string, string> = {};
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !/^\.env(\..+)?$/.test(entry.name)) continue;
		const file = join(dir, entry.name);
		for (const [variable, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
			if (process.env[variable] === value) files[variable] ??= file;
		}
	}
	return files;
}

export default function ship(pi: ExtensionAPI) {
	const z = pi.zod;
	const prSchema = z.object({
		state: z.enum(["OPEN", "MERGED", "CLOSED"]),
		isDraft: z.boolean(),
		mergeable: z.string(),
		mergeStateStatus: z.string(),
		reviewDecision: z.string().nullable(),
		body: z.string(),
		changedFiles: z.number().int(),
		additions: z.number().int(),
		deletions: z.number().int(),
		files: z.object({ nodes: z.array(z.object({ path: z.string() })) }),
		reviewThreads: z.object({ nodes: z.array(z.object({ isResolved: z.boolean() })), pageInfo: z.object({ hasNextPage: z.boolean() }) }),
		commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({
			state: z.string(),
			contexts: z.object({ totalCount: z.number().int(), nodes: z.array(z.object({
				name: z.string().optional(), status: z.string().optional(), conclusion: z.string().nullable().optional(),
				context: z.string().optional(), state: z.string().optional(),
			})) }).optional(),
		}).nullable() }) })) }),
	});
	const prStatusSchema = z.object({
		state: z.enum(["OPEN", "MERGED", "CLOSED"]), draft: z.boolean(), conflicts: z.boolean(), behind: z.boolean(),
		unresolvedThreads: z.number().int(), moreThreads: z.boolean(), changesRequested: z.boolean(), approved: z.boolean(),
		checks: z.enum(["pass", "fail", "pending", "none"]),
		reviews: z.object(byReview(() => z.object({ needed: z.boolean(), done: z.boolean(), fastPath: z.literal(true).optional() }))),
	});
	const fixRoundsSchema = z.object({ rounds: z.number().int(), counts: z.array(z.number()) });
	// omp's zod reports a failed check as "must be <message>" and uses a field's description as that message, so the checked fields carry no description of their own.
	const filled = z.string().regex(/\S/, "non-empty");
	const contractSchema = z.object({
		goal: filled,
		constraints: z.array(z.string()).default(() => []),
		files_to_change: z.array(z.string().refine(repoRelative, "repository-relative, with no `..`")).default(() => []),
		test_first: z.string().nullable().default(() => null),
		done_when: z.array(filled).min(1),
	});
	const checkRunSchema = z.object({ command: filled, result: filled });
	const verdictsSchema = z.object({ verdicts: z.array(z.object({ finding: filled, verdict: z.enum(["fixed", "dismissed", "deferred"]) })), skipped: z.literal("fast-path").optional() });
	const outputSchema = z.object({
		implement: z.object({ files_changed: z.array(z.string().refine(repoRelative, "repository-relative, with no `..`")).min(1), checks_run: z.array(checkRunSchema).min(1) }).optional(),
		draft_pr: z.object({ pr: z.number().int(), url: z.string() }).refine(({ pr, url }) => prOfUrl(url)?.pr === pr, { message: "the URL of PR `pr`, as https://github.com/owner/name/pull/<pr>", path: ["url"] }).optional(),
		interface_review: verdictsSchema.optional(),
		thermonuclear: verdictsSchema.optional(),
		ready_gate: z.object({ checks: z.array(checkRunSchema).min(1) }).optional(),
	}).strict();
	const postKind = z.enum(["slack", "linear"]);
	const postSchema = z.object({ kind: postKind, pr: z.number().int(), ref: filled });
	const stateSchema = z.object({
		stage: z.enum(STAGES), work: z.enum(LIVE_WORK).optional(), issue: z.string().optional(),
		repo: z.string().optional(), pr: z.number().int().optional(), note: z.string().optional(),
		// A status recorded before the reviews were per stage is dropped; the next poll refetches it.
		prStatus: prStatusSchema.optional().catch(undefined),
		fixes: z.object({ fix_ci: fixRoundsSchema.optional(), fix_comments: fixRoundsSchema.optional() }).optional().catch(undefined),
		contract: contractSchema.optional().catch(undefined),
		rejected: z.array(z.string()).optional().catch(undefined),
		outputs: outputSchema.optional().catch(undefined),
		posts: z.array(postSchema).optional().catch(undefined),
		spent: z.object({ tokens: z.number(), cost: z.number() }).optional().catch(undefined),
		updatedAt: z.string(),
	});
	const viewSchema = z.object({ body: z.string(), changedFiles: z.number().int(), additions: z.number().int(), deletions: z.number().int(), files: z.array(z.object({ path: z.string() })), url: z.string() });
	let state: ShipState | undefined;
	let lastRefresh = 0;
	let lastSummary = "";
	let refreshFailure: string | undefined;
	/** The session's usage at the last traced stage; `save` persists it so a resumed session's next trace line starts from it. */
	let usageMark: Spent | undefined;
	const runner = new GhRunner((command, args, options) => pi.exec(command, args, options));
	const gh = async (args: string[], cwd: string) => {
		try {
			return { code: 0, stdout: await runner.text(args, cwd), stderr: "" };
		} catch (error) {
			return { code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
		}
	};

	function render(ctx: ExtensionContext) {
		if (!ctx.hasUI || ctx.agent?.kind === "sub") return;
		ctx.ui.setStatus(WIDGET, state ? `${statusText(state)}${refreshFailure ? " · stale GitHub status" : ""}` : undefined);
		ctx.ui.setWidget(WIDGET, state ? [...renderLines(state), ...(refreshFailure ? [`GitHub status unavailable; previous status is stale: ${refreshFailure}`] : [])] : undefined, { placement: "aboveEditor" });
	}

	function save(ctx: ExtensionContext, next: ShipState) {
		state = { ...next, spent: usageMark, updatedAt: new Date().toISOString() };
		pi.appendEntry(ENTRY, state);
		render(ctx);
	}

	function restore(ctx: ExtensionContext) {
		state = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY) {
				const parsed = stateSchema.safeParse(entry.data);
				if (parsed.success) state = parsed.data;
				else if ((entry.data as { stopped?: unknown } | undefined)?.stopped === true) state = undefined;
			}
		}
		usageMark = state?.spent;
		lastSummary = state?.prStatus ? liveSummary(state.prStatus) : "";
		refreshFailure = state?.prStatus && state.prStatus.state !== "MERGED" ? "Status restored from the session; awaiting a fresh GitHub read." : undefined;
		render(ctx);
	}

	/**
	 * Puts the contract and rejected approaches back in the agent's context after a compaction or a resume, unless the context since the last compaction already holds the same brief.
	 * Idle, the message joins the context without starting a turn; during a run, it joins at the next step.
	 */
	function remind(ctx: ExtensionContext) {
		const brief = state && planBrief(state);
		if (!brief) return;
		const content = `The /ship run's plan, as ship_stage recorded it:\n${brief}`;
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type === "compaction") break;
			if (entry.type === "custom_message" && entry.customType === BRIEF) {
				if (entry.content === content) return;
				break;
			}
		}
		pi.sendMessage({ customType: BRIEF, content, display: false, attribution: "agent" }, { deliverAs: ctx.isIdle() ? "nextTurn" : "aside" });
	}

	async function resolveRepo(cwd: string): Promise<string | undefined> {
		const r = await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd);
		return r.code === 0 ? r.stdout.trim() || undefined : undefined;
	}

	/** One poll at a time: the interval, a turn's end, and a command can all ask while `gh` still answers an earlier one. */
	let polling: Promise<void> | undefined;
	function refresh(ctx: ExtensionContext): Promise<void> {
		polling ??= pollPr(ctx).finally(() => {
			polling = undefined;
		});
		return polling;
	}

	/** A poll that starts after this call, so it reads a PR body edited just before; `refresh` can hand back a poll already under way. */
	async function refreshNow(ctx: ExtensionContext): Promise<void> {
		await polling?.catch(() => undefined);
		return refresh(ctx);
	}

	async function pollPr(ctx: ExtensionContext) {
		lastRefresh = Date.now();
		// Only a merged status is final: the stage can say merged for the PR before, while the PR named since has no status yet.
		if (!state?.pr || !state.repo || state.prStatus?.state === "MERGED") return render(ctx);
		const { pr, repo } = state;
		const [owner, name] = repo.split("/");
		const r = await gh(["api", "graphql", "-f", `query=${PR_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `n=${pr}`], ctx.cwd);
		// The session named another PR while GitHub answered, so this answer is not the status of the PR it now follows.
		if (state?.pr !== pr || state.repo !== repo) return render(ctx);
		if (r.code !== 0) {
			refreshFailure = r.stderr.trim() || "GitHub status read failed.";
			return render(ctx);
		}
		let response: unknown;
		try {
			response = JSON.parse(r.stdout);
		} catch {
			refreshFailure = "GitHub returned invalid JSON; previous status is stale.";
			return render(ctx);
		}
		const raw = response && typeof response === "object" && "data" in response ? response.data : undefined;
		const repository = raw && typeof raw === "object" && "repository" in raw ? raw.repository : undefined;
		const payload = repository && typeof repository === "object" && "pullRequest" in repository ? repository.pullRequest : undefined;
		const parsed = prSchema.safeParse(payload);
		if (!parsed.success) {
			refreshFailure = "GitHub did not return a complete PR status; previous status is stale.";
			return render(ctx);
		}
		refreshFailure = undefined;
		const prStatus = parsePr(parsed.data, checkoutReader(ctx.cwd));
		const merged = prStatus.state === "MERGED";
		const stage: Stage = merged ? "merged" : state.stage;
		if (JSON.stringify(prStatus) === JSON.stringify(state.prStatus) && stage === state.stage) return render(ctx);
		save(ctx, { ...state, prStatus, stage, work: merged ? undefined : state.work });
		const summary = liveSummary(prStatus);
		if (state.stage === "live" || merged) {
			if (summary !== lastSummary && ctx.hasUI && ctx.agent?.kind !== "sub") ctx.ui.notify(`PR #${state.pr}: ${summary}`, "info");
		}
		lastSummary = summary;
	}

	/** What the publish gate does with a PR: `theirs` is a PR of a repository the user cannot push to, such as an awesome list, which follows that project's process, not /ship. */
	type Verdict = { kind: "block"; reason: string } | { kind: "theirs" } | { kind: "ask" };

	/** The verdict on `command` putting live the PR `selector` names, read from `dir`, where it runs, whose checkout holds the review paths it is checked against. */
	async function publishCheck(selector: string[], dir: string, command: string, sessionDir: string): Promise<Verdict> {
		const r = await gh(["pr", "view", ...selector, "--json", "body,changedFiles,additions,deletions,files,url"], dir);
		if (r.code !== 0) {
			const error = r.stderr.trim() || r.stdout.trim();
			if (/^no pull requests found for branch\b/i.test(error)) {
				return { kind: "block", reason: "Blocked: this branch has no PR yet. Push it and create a draft with `gh pr create --draft`. Then run each review stage the change needs, commit and push its fixes, add its box, and pass the ready gate before publishing." };
			}
			const held = quotaExhausted(error) ? undefined : await runner.credentials(sessionDir);
			const auth = held && authDiagnosis(held, dotenvFiles(sessionDir));
			// gh's hint after its first line, `gh auth login`, cannot replace a token an environment variable holds, and the diagnosis names the fix.
			return { kind: "block", reason: `Could not read the PR body to check its review and proof boxes: ${auth ? `${error.split("\n")[0]}. ${auth}` : error}` };
		}
		let view: unknown;
		try {
			view = JSON.parse(r.stdout);
		} catch {
			view = undefined;
		}
		const parsed = viewSchema.safeParse(view);
		const pr = parsed.success ? parsed.data.url.match(/^https?:\/\/(([^/]+)\/([^/]+\/[^/]+))\/pull\/(\d+)/) : null;
		if (!parsed.success || !pr) return { kind: "block", reason: "Could not read the PR body and changed files to check its review and proof boxes: gh returned an unexpected answer." };
		const [, repository, host, name, number] = pr;
		if ((await gh(["api", `repos/${name}`, "--hostname", host, "--jq", ".permissions.push"], dir)).stdout.trim() === "false") return { kind: "theirs" };
		const local = (await gh(["repo", "view", "--json", "url", "-q", ".url"], dir)).stdout.trim().replace(/^https?:\/\//, "");
		if (local.toLowerCase() !== repository.toLowerCase()) {
			return {
				kind: "block",
				reason: `Blocked: ${repository}#${number} is checked against the review paths in a checkout of ${repository}, but ${command} runs in ${dir}, ${local ? `a checkout of ${local}` : "which gh resolves to no repository"}. Run it from a checkout of ${repository}: set the bash call's cwd to one, or cd there in the same command.`,
			};
		}
		const { body, files, changedFiles, additions, deletions } = parsed.data;
		const reason = publishBlocker(body, reviewsOf(body, files.map(file => file.path), changedFiles, checkoutReader(dir), additions + deletions));
		return reason ? { kind: "block", reason } : { kind: "ask" };
	}

	pi.on("session_start", async (_event, ctx) => {
		// The session that runs /ship records its stages, so a subagent's requests leave out this tool's schema.
		if (ctx.agent.kind === "sub") await pi.setActiveTools(pi.getActiveTools().filter(name => name !== "ship_stage"));
		restore(ctx);
		remind(ctx);
		ctx.setInterval(() => refresh(ctx), POLL_MS);
		await refresh(ctx);
	});
	pi.on("session_switch", async (_event, ctx) => {
		restore(ctx);
		remind(ctx);
	});
	pi.on("session_compact", async (_event, ctx) => remind(ctx));
	pi.on("session_branch", async (_event, ctx) => restore(ctx));
	pi.on("session_tree", async (_event, ctx) => restore(ctx));
	pi.on("turn_end", async (_event, ctx) => {
		if (Date.now() - lastRefresh >= TURN_REFRESH_MS) await refresh(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const input = event.input;
		if (typeof input.command !== "string") return;
		for (const { words, dir } of located(input.command, typeof input.cwd === "string" ? resolve(ctx.cwd, input.cwd) : ctx.cwd)) {
			if (opensLivePr(words)) {
				return { block: true, reason: "Blocked: open PRs as drafts (`gh pr create --draft`). A PR goes live only after the ready gate, and after each review its changed files call for." };
			}
			const ready = ghPr(words, "ready");
			if (!ready || ready.includes("--undo")) continue;
			const missing = state && !otherOwner(selectorOwner(prSelector(ready)), state.repo) ? missingOutput("live", state.stage, state.outputs) : undefined;
			if (missing) {
				return { block: true, reason: `Blocked: \`gh pr ready\` puts the PR live, which starts from the ${LABEL[missing.stage]} stage's output, and ship has not recorded it. Record it first with ship_stage({output: ${missing.argument}}), then retry.` };
			}
			const command = `\`${words.join(" ")}\``;
			if (/\bGH_(?:REPO|HOST)=/.test(input.command)) {
				return { block: true, reason: `Blocked: this command sets GH_REPO or GH_HOST, which this gate cannot apply to its own read of the PR ${command} puts live. Name the repository with \`-R owner/name\` or a PR URL instead, then retry.` };
			}
			if (dir === null) {
				return { block: true, reason: `Blocked: ${command} puts a PR live from a directory this gate cannot locate, because a variable, a command substitution, or \`cd -\` names it. Write the directory out, as in \`cd /absolute/path && ...\`, or set the bash call's cwd, then retry.` };
			}
			const verdict = await publishCheck(prSelector(ready), dir, command, ctx.cwd);
			if (verdict.kind === "theirs") continue;
			if (verdict.kind === "block") return { block: true, reason: verdict.reason };
			if (!ctx.hasUI || !(await ctx.ui.confirm("Put PR live for review?", "The PR passed the ship gate. Mark this draft ready for human review?"))) {
				return { block: true, reason: "The PR remains a draft until the operator approves putting it live." };
			}
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash" || event.isError || !state || typeof event.input.command !== "string") return;
		const command = event.input.command;
		const output = event.content.map(c => (c.type === "text" ? c.text : "")).join("\n");
		const url = output.match(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
		const ran = commands(command);
		if (ran.some(words => ghPr(words, "create")) && url && !state.pr) {
			save(ctx, { ...state, repo: url[1], pr: Number(url[2]), stage: REVIEW_STAGES[0], outputs: { ...state.outputs, draft_pr: { pr: Number(url[2]), url: url[0] } } });
			await refresh(ctx);
		} else if (state.pr && state.stage !== "live" && ran.some(words => {
			const ready = ghPr(words, "ready");
			return ready !== undefined && !ready.includes("--undo") && !otherOwner(selectorOwner(prSelector(ready)), state?.repo);
		})) {
			save(ctx, { ...state, stage: "live", work: undefined });
			await refresh(ctx);
		}
	});

	const toolParamsSchema = z.object({
		stage: z.enum([...STAGES, ...LIVE_WORK]).optional().describe("Stage or live work to record. Omit to read."),
		issue: z.string().optional().describe("Linear issue identifier, e.g. ENG-123"),
		pr: z.number().int().optional().describe("Pull request number"),
		repo: z.string().optional().describe("owner/name; resolved from the cwd when omitted"),
		note: z.string().optional().describe("One-line status note; empty string clears it"),
		count: z.number().int().min(0).optional().describe("With fix_ci or fix_comments: how many checks fail, or review comments are open, as this round starts"),
		moreRounds: z.boolean().optional().describe("With fix_ci or fix_comments: the user approved more rounds after ship_stage stopped the fix; starts its rounds over"),
		contract: contractSchema.optional().describe("At the plan stage, required before implement, replacing any earlier one: goal, one sentence; constraints, rules the change keeps, naming `test-change: <reason>` to change an existing test; files_to_change, repository-relative paths; test_first, the test path written and committed before the code, which a bug fix needs, or null; done_when, at least one check that shows the change done"),
		rejected: filled.optional().describe("One approach a reviewer or the user rejected, with why; added to the run's rejected list"),
		output: outputSchema.optional().describe("The output of each stage this call finishes, keyed by stage; advancing to a stage needs the output of the stage before it. implement: {files_changed, checks_run: [{command, result}]}; draft_pr: {pr, url}; interface_review and thermonuclear: {verdicts: [{finding, verdict: fixed, dismissed, or deferred}]}, empty when skipped, and recorded for you on the fast path; ready_gate: {checks: [{command, result}]}"),
		posted: z.object({ kind: postKind, pr: z.number().int().optional(), ref: filled }).optional().describe("A Slack post or Linear link you just made for a PR: kind, ref (its permalink or URL), and pr, which defaults to the run's PR. Recording a kind already recorded for that PR is a no-op that says not to post again"),
		stop: z.boolean().optional().describe("End the workflow in this session, as when the user says 'no ship'"),
	});
	type ToolParams = { stage?: Stage | LiveWork; issue?: string; pr?: number; repo?: string; note?: string; count?: number; moreRounds?: boolean; contract?: Contract; rejected?: string; output?: StageOutputs; posted?: { kind: Post["kind"]; pr?: number; ref: string }; stop?: boolean };
	type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; details?: unknown };
	/** What a call did with the stage it named, for its trace line. */
	type Outcome = { recorded: boolean; round?: number };
	/** The `ship_stage` call under way, which the next one waits for. */
	let calls: Promise<unknown> = Promise.resolve();
	pi.registerTool({
		loadMode: "essential",
		name: "ship_stage",
		label: "Ship stage",
		description: [
			`Read or record the /ship workflow stage of this session: ${STAGES.join(", ")}.`,
			"Recording thermonuclear or ready_gate checks the box of each needed review before it in the PR body, so record it only after that review's fixes are pushed.",
			"`gh pr ready` records live; while live, record the work you start: rebase, fix_comments, or fix_ci; record `live` again after you push.",
			"Call with no stage to read the current stage, the PR's live needs from GitHub, and the next action.",
			"Call with stop: true when the user says 'no ship'; the widget, the gates, and the dashboard's Ship card then drop the run.",
			`fix_ci and fix_comments run in rounds per PR: pass count each round; after ${FIX_BUDGET} rounds, or when count did not shrink for ${STALL_ROUNDS} rounds in a row, the round is refused until the user approves moreRounds.`,
			"Pass contract at the plan stage: implement is refused without one. Pass rejected for each approach a reviewer or the user rejects. Both show on every read and come back after a compaction or a resume.",
			"draft_pr and ready_gate are refused until a test, typecheck, or lint bash command exits 0 in this session after the last edit, write, or task call; with a contract's test_first, draft_pr is also refused until a branch commit changing only that test comes before the first commit changing code.",
			"Advancing to draft_pr, interface_review, thermonuclear, ready_gate, or live is refused until the stage before it has its output, passed as output keyed by that stage; `gh pr ready` is blocked until the ready gate's output is recorded. draft_pr reuses the branch's open PR when one exists.",
			`A PR changing at most ${FAST_PATH.lines} lines in ${FAST_PATH.files} files, none a schema, public-interface, or \`${REVIEWS.thermonuclear.pathsFile}\` file, takes the fast path: neither review is needed, and advancing past them records each as an empty verdict list marked skipped.`,
			"Pass posted after each Slack post or Linear link you make for a PR; every read lists them, and recording one again is a no-op.",
			"Every call naming a stage appends a line to the ship trace, with the outputs it carried and whether the PR took the fast path.",
		].join(" "),
		parameters: toolParamsSchema,
		execute(_id, params, _signal, _onUpdate, ctx) {
			// One call at a time: the session follows one PR, so parallel calls naming different PRs would each check whichever PR the last one named.
			const call = calls.then(async () => {
				const parsed = toolParamsSchema.safeParse(params);
				if (!parsed.success) return { content: [{ type: "text" as const, text: `Invalid ship stage input: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}` }], isError: true };
				const { stage } = parsed.data;
				if (!stage) return stageCall(parsed.data, ctx, { recorded: false });
				const usage = ctx.sessionManager.getUsageStatistics();
				const since = usageMark ?? { tokens: 0, cost: 0 };
				usageMark = { tokens: usage.totalTokens, cost: usage.cost };
				const outcome: Outcome = { recorded: false };
				const result = await stageCall(parsed.data, ctx, outcome);
				const reviews = state?.prStatus?.reviews;
				appendTrace({
					ts: new Date().toISOString(),
					session: ctx.sessionManager.getSessionId(),
					repo: state?.repo ?? parsed.data.repo,
					pr: state?.pr ?? parsed.data.pr,
					stage,
					model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
					tokens: usageMark.tokens - since.tokens,
					cost: usageMark.cost - since.cost,
					round: outcome.round,
					checks: state?.prStatus?.checks,
					recorded: outcome.recorded,
					refusal: outcome.recorded ? undefined : result.content[0]?.text,
					output: parsed.data.output,
					fastPath: reviews && REVIEW_STAGES.some(review => reviews[review].fastPath === true),
				});
				return result;
			});
			calls = call.catch(() => undefined);
			return call;
		},
	});

	/** One `ship_stage` call, recording into `outcome` whether it recorded the stage it named and which fix round it started. */
	async function stageCall(params: ToolParams, ctx: ExtensionContext, outcome: Outcome): Promise<ToolResult> {
		const { stage, issue, note, count, moreRounds, contract, rejected, output, posted, stop } = params;
		const opened = output?.draft_pr && prOfUrl(output.draft_pr.url);
		// A draft PR's output names the PR, so the call need not name it again.
		const pr = params.pr ?? opened?.pr;
		const repo = params.repo ?? opened?.repo;
		if (stop) {
			state = undefined;
			pi.appendEntry(ENTRY, { stopped: true });
			render(ctx);
			return { content: [{ type: "text" as const, text: "Stopped the /ship workflow in this session." }] };
		}
		if (contract) {
			const refusal = await testEditRefusal(contract, ctx.cwd);
			if (refusal) return { content: [{ type: "text" as const, text: refusal }], isError: true };
		}
		if (stage === "implement" && !(contract ?? state?.contract)) {
			return { content: [{ type: "text" as const, text: "Record the plan's contract before implementing: call ship_stage({stage: 'implement', contract: {goal, constraints, files_to_change, test_first, done_when}}), with done_when listing at least one check." }], isError: true };
		}
		let posts = state?.posts;
		if (posted) {
			const postPr = posted.pr ?? pr ?? state?.pr;
			if (postPr === undefined) return { content: [{ type: "text" as const, text: "posted needs the PR it is for: pass posted.pr, or name the PR first." }], isError: true };
			const added = withPost(posts, { kind: posted.kind, pr: postPr, ref: posted.ref });
			if ("existing" in added) return { content: [{ type: "text" as const, text: `A ${posted.kind} post for PR #${postPr} is already recorded, ${added.existing.ref}, so nothing changed. Do not post it again.` }] };
			posts = added.posts;
		}
		const base: ShipState = state ?? { stage: "ticket", updatedAt: "" };
		const newPr = (pr !== undefined && pr !== base.pr) || (repo !== undefined && repo !== base.repo);
		if (newPr) {
			// Record the PR before polling, so the gates below read this PR's body rather than none or another PR's.
			const prRepo = repo ?? base.repo ?? (pr ? await resolveRepo(ctx.cwd) : undefined);
			save(ctx, { ...base, pr: pr ?? base.pr, repo: prRepo, prStatus: undefined, fixes: undefined });
		}
		await refreshNow(ctx);
		if (refreshFailure && stage && NEEDS_CURRENT_STATUS.includes(stage)) {
			return { content: [{ type: "text" as const, text: `Cannot advance using stale GitHub status: ${refreshFailure}` }], isError: true };
		}
		// After the refresh, so the fast path fills in the skipped reviews' outputs from GitHub's current status.
		const missing = stage && missingOutput(stage, state?.stage ?? "ticket", withFastPath(stage, { ...state?.outputs, ...output }, state?.prStatus?.reviews));
		if (missing) {
			return { content: [{ type: "text" as const, text: `${stage} is not recorded: it starts from the ${LABEL[missing.stage]} stage's output, and ship has not recorded it. Pass it with this call: output: ${missing.argument}.` }], isError: true };
		}
		const verified = VERIFIED_STAGES.find(claim => claim === stage);
		if (verified) {
			const refusal = verificationRefusal(verified, toolRuns(ctx.sessionManager.getBranch()), declaredChecks(checkoutReader(ctx.cwd)(".omp/land.json")))
				?? (verified === "draft_pr" && state?.contract ? await testOrderRefusal(state.contract, ctx.cwd) : undefined);
			if (refusal) return { content: [{ type: "text" as const, text: refusal }], isError: true };
		}
		let checked = "";
		let reused = "";
		if (stage || issue || pr || repo || note !== undefined || contract || rejected || output || posted) {
			if (stage === "ready_gate" || (stage !== undefined && isReviewStage(stage))) {
				const status = state?.prStatus;
				if (!status && reviewsBefore(stage).length > 0) {
					return { content: [{ type: "text" as const, text: `GitHub has reported no status for this PR, so ${stage} cannot check its review boxes. Name the PR with ship_stage({pr}).` }], isError: true };
				}
				const unchecked = status ? reviewsBefore(stage).filter(review => status.reviews[review].needed && !status.reviews[review].done) : [];
				if (state && status && unchecked.length > 0) {
					// Recording a stage declares the reviews before it done, so their boxes go in the PR body; a box the body already holds, such as one GitHub's status read missed just after an edit, stays as it is.
					const path = `repos/${state.repo}/pulls/${state.pr}`;
					const boxes = unchecked.map(review => `\`${REVIEWS[review].box}\``).join(" and ");
					try {
						const { changed } = await editDescription(`${state.repo}-${state.pr}`, { kind: "check", boxes: unchecked.map(review => REVIEWS[review].box) }, {
							read: async () => descriptionSnapshot(await runner.json(["api", path], ctx.cwd)),
							write: async body => {
								await runner.json(["api", "-X", "PATCH", path, "-f", `body=${body}`], ctx.cwd);
							},
						});
						if (changed) checked = `Checked ${boxes} in the PR body.\n`;
					} catch (error) {
						return { content: [{ type: "text" as const, text: `Could not check ${boxes} in the PR body, so ${stage} is not recorded: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
					}
					save(ctx, { ...state, prStatus: { ...status, reviews: byReview(review => (unchecked.includes(review) ? { ...status.reviews[review], done: true } : status.reviews[review])) } });
				}
			}
			const isWork = stage === "rebase" || stage === "fix_comments" || stage === "fix_ci";
			if (stage === "live" || isWork) {
				if (state?.prStatus?.state === "OPEN" && state.prStatus.draft) {
					const next = stage === "live"
						? `Run \`gh pr ready ${state.pr}\` once the ready gate passes; it asks the user to approve, and a successful run records live.`
						: "Do the work without recording it; live work is for a PR under review.";
					return { content: [{ type: "text" as const, text: `PR #${state.pr} is still a draft, so ${stage} is not recorded and the stage stays ${LABEL[state.stage]}. ${next}` }] };
				}
				if (!state?.prStatus || state.prStatus.state !== "OPEN") {
					return { content: [{ type: "text" as const, text: "The PR must be open before recording live work." }], isError: true };
				}
			}
			if (stage === "merged" && state?.prStatus?.state !== "MERGED") {
				return { content: [{ type: "text" as const, text: "GitHub has not reported this PR merged." }], isError: true };
			}
			let fixes = settleFixes(state?.fixes, state?.prStatus);
			if (isFixWork(stage)) {
				if (moreRounds && fixes) {
					const { [stage]: _restarted, ...others } = fixes;
					fixes = others;
				}
				const next = startFix(fixes, stage, count);
				outcome.round = next.round;
				if ("refusal" in next) return { content: [{ type: "text" as const, text: next.refusal }], isError: true };
				fixes = next.fixes;
			}
			const current = state ?? base;
			save(ctx, {
				...current,
				stage: stage ? (isWork ? "live" : stage) : current.stage,
				work: stage ? (isWork ? stage : undefined) : current.work,
				issue: issue ?? current.issue,
				note: note === undefined ? current.note : note || undefined,
				fixes,
				contract: contract ?? current.contract,
				rejected: rejected ? withRejected(current.rejected, rejected) : current.rejected,
				outputs: stage ? withFastPath(stage, { ...current.outputs, ...output }, current.prStatus?.reviews) : output ? { ...current.outputs, ...output } : current.outputs,
				posts,
			});
			outcome.recorded = stage !== undefined;
			if (stage === "draft_pr" && state && !state.pr) {
				const found = await branchPr(ctx.cwd);
				const at = found && prOfUrl(found.url);
				if (found && at) {
					save(ctx, { ...state, pr: at.pr, repo: at.repo, prStatus: undefined, fixes: undefined, outputs: { ...state.outputs, draft_pr: { pr: at.pr, url: found.url } } });
					reused = `PR #${at.pr} (${found.url}) is already open for branch \`${found.branch}\`, so ship reuses it: do not run \`gh pr create\`. Push the branch${found.draft ? "" : `, run \`gh pr ready ${at.pr} --undo\` to make it a draft again`}, then record ship_stage({stage: 'interface_review'}).\n`;
					await refreshNow(ctx);
				}
			}
		}
		return { content: [{ type: "text" as const, text: `${checked}${reused}${report(state)}${refreshFailure ? `\nGitHub status unavailable; previous status is stale: ${refreshFailure}` : ""}` }], details: { state, ...(refreshFailure ? { stale: true, error: refreshFailure } : {}) } };
	}

	/** The open PR whose head is the checkout's current branch, so draft_pr reuses it rather than sending the agent to open a second one. */
	async function branchPr(cwd: string): Promise<{ url: string; draft: boolean; branch: string } | undefined> {
		const current = await pi.exec("git", ["branch", "--show-current"], { cwd });
		const branch = current.code === 0 ? current.stdout.trim() : "";
		if (!branch) return undefined;
		const r = await gh(["pr", "list", "--head", branch, "--state", "open", "--json", "url,isDraft", "--limit", "1"], cwd);
		if (r.code !== 0) return undefined;
		let list: unknown;
		try {
			list = JSON.parse(r.stdout);
		} catch {
			return undefined;
		}
		const parsed = z.array(z.object({ url: z.string(), isDraft: z.boolean() })).safeParse(list);
		const first = parsed.success ? parsed.data[0] : undefined;
		return first && { url: first.url, draft: first.isDraft, branch };
	}

	/** Why `contract` may not stand: it plans to change a test file HEAD already has, without a `test-change` constraint. */
	async function testEditRefusal(contract: Contract, cwd: string): Promise<string | undefined> {
		const tests = plannedTestEdits(contract);
		if (tests.length === 0) return undefined;
		// --full-tree reads the paths from the top of the checkout, as the contract writes them; a checkout without HEAD has no test yet.
		const r = await pi.exec("git", ["ls-tree", "--full-tree", "-r", "--name-only", "HEAD", "--", ...tests], { cwd });
		const existing = r.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
		if (existing.length === 0) return undefined;
		return `The contract is not recorded: files_to_change holds ${existing.join(", ")}, which HEAD already has, and a test that exists guards behavior. Leave it out, or add a constraint \`test-change: <why the behavior changes on purpose>\`.`;
	}

	/** Why `contract`'s branch may not get its draft PR: with a `test_first`, a commit changing only that test must come before the code. */
	async function testOrderRefusal(contract: Contract, cwd: string): Promise<string | undefined> {
		if (!contract.test_first) return undefined;
		let base: string | undefined;
		for (const ref of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
			const r = await pi.exec("git", ["merge-base", "HEAD", ref], { cwd });
			if (r.code === 0 && r.stdout.trim()) {
				base = r.stdout.trim().slice(0, 12);
				break;
			}
		}
		if (!base) return `draft_pr is not recorded: the contract's test_first is "${contract.test_first}", and this checkout has no main or master branch to read the branch's commits from. Fetch the default branch, then record draft_pr again.`;
		const log = await pi.exec("git", ["log", "--reverse", "--no-merges", "--format=%x00%h", "--name-only", `${base}..HEAD`], { cwd });
		if (log.code !== 0) return `draft_pr is not recorded: \`git log ${base}..HEAD\` failed, so the test-first order cannot be checked: ${log.stderr.trim()}`;
		return testFirstRefusal(contract, parseBranchLog(log.stdout), base);
	}
}
