// Tracks the /ship workflow (Linear ticket -> draft PR -> reviews -> live for review) per session.
// The agent declares the stage it works on through the `ship_stage` tool. GitHub decides what a live PR
// needs next (rebase, review comments, CI), so that part is polled, never declared.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { commands, located, within } from "./shell/commands";
import { quotaExhausted } from "./github/access";
import { type GhCredential, GhRunner, rejectedCredential, TOKEN_VARIABLE } from "./github/runner";

const ENTRY = "omp-ship.state";
const WIDGET = "omp-ship";
/** A proof box a repository's PR template declares; the PR goes live only once the author checks it. The gate reads the box, not the proof behind it. */
export const PROOF_BOX = "- [ ] Browser proof";
const POLL_MS = 60_000;
const TURN_REFRESH_MS = 15_000;

// The interface review comes before the thermonuclear one, so the code-quality review sees the interface fixes.
export const STAGES = ["ticket", "implement", "draft_pr", "interface_review", "thermonuclear", "ready_gate", "live", "merged"] as const;
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
/** Each review's state for one PR: whether its changed files call for it, and whether its body has the box. */
export type Reviews = Record<ReviewStage, { needed: boolean; done: boolean }>;

function byReview<T>(value: (stage: ReviewStage) => T): Record<ReviewStage, T> {
	return Object.fromEntries(REVIEW_STAGES.map(stage => [stage, value(stage)])) as Record<ReviewStage, T>;
}

/** Stages after the first review, and all live work, decide from GitHub's current PR status, never a stale one. */
const NEEDS_CURRENT_STATUS: readonly string[] = [...STAGES.slice(STAGES.indexOf(REVIEW_STAGES[0]) + 1), ...LIVE_WORK];

const LABEL: Record<Stage | LiveWork, string> = {
	ticket: "Ticket",
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
	ticket: "Create or link the Linear issue, then record it with ship_stage({stage: 'implement', issue}).",
	implement: "Implement and commit on the issue's branch. Do not open a PR in this stage.",
	draft_pr: "Create a draft with `gt submit --draft` for a Graphite repository, or push and run `gh pr create --draft` otherwise. Include the issue ID in the title and `Fixes <ID>` in the body.",
	interface_review: `If the status says the ${REVIEWS.interface_review.label} is not needed because \`${REVIEWS.interface_review.pathsFile}\` lists no changed file, record ship_stage({stage: 'thermonuclear'}) and move on. Otherwise wait until the user approves the direction, then spawn \`task\` with \`agent: "interface-reviewer"\` on the PR, apply the findings in a fresh agent, push, then add \`${REVIEWS.interface_review.box}\` to the PR body.`,
	thermonuclear: `If the status says the ${REVIEWS.thermonuclear.label} is not needed because \`${REVIEWS.thermonuclear.pathsFile}\` lists no changed file, skip the review. Otherwise wait until the user approves the direction, then run thermonuclear-reviewer on the PR diff, apply the findings, push, then add \`${REVIEWS.thermonuclear.box}\` to the PR body. If the body has an unchecked \`${PROOF_BOX}\` box, do what the repository asks for it, then check it.`,
	ready_gate: `Make sure the PR body has no unchecked \`${PROOF_BOX}\` box, ask the user to approve, then run \`gh pr ready <N>\`.`,
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
	updatedAt: string;
}

export interface Need {
	kind: LiveWork;
	detail: string;
}

const PR_QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){
state isDraft mergeable mergeStateStatus reviewDecision body changedFiles
files(first:100){nodes{path}}
reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}
commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}`;

interface PrResponse {
	state: "OPEN" | "MERGED" | "CLOSED";
	isDraft: boolean;
	mergeable: string;
	mergeStateStatus: string;
	reviewDecision: string | null;
	body: string;
	changedFiles: number;
	files: { nodes: { path: string }[] };
	reviewThreads: { nodes: { isResolved: boolean }[]; pageInfo: { hasNextPage: boolean } };
	commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}

/** The PR's status; `read` returns the text of a paths file in the checkout, `undefined` when it has none. */
export function parsePr(pr: PrResponse, read: (pathsFile: string) => string | undefined): PrStatus {
	const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup?.state;
	const threads = pr.reviewThreads.nodes;
	return {
		state: pr.state,
		draft: pr.isDraft,
		conflicts: pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY",
		behind: pr.mergeStateStatus === "BEHIND",
		unresolvedThreads: threads.filter(t => !t.isResolved).length,
		moreThreads: pr.reviewThreads.pageInfo.hasNextPage,
		changesRequested: pr.reviewDecision === "CHANGES_REQUESTED",
		approved: pr.reviewDecision === "APPROVED",
		checks: !rollup ? "none" : rollup === "SUCCESS" ? "pass" : rollup === "FAILURE" || rollup === "ERROR" ? "fail" : "pending",
		reviews: reviewsOf(pr.body, pr.files.nodes.map(file => file.path), pr.changedFiles, read),
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

export function renderLines(s: ShipState): string[] {
	const at = STAGES.indexOf(s.stage);
	const ref = [s.issue, s.pr ? `PR #${s.pr}${s.prStatus?.draft ? " (draft)" : ""}` : ""].filter(Boolean).join(" · ");
	const lines = [`ship ${ref || "(no ticket yet)"}`];
	lines.push(STAGES.slice(0, 4).map((stage, i) => `${i < at || s.stage === "merged" ? "✓" : i === at ? "▶" : "○"} ${LABEL[stage]}`).join("  "));
	lines.push(STAGES.slice(4).map((stage, i) => `${i + 4 < at || s.stage === "merged" ? "✓" : i + 4 === at ? "▶" : "○"} ${LABEL[stage]}`).join("  "));
	if (s.stage === "live" && s.prStatus) lines.push(`Live: ${liveSummary(s.prStatus)}`);
	if (s.stage === "live" && s.work) lines.push(`Working on: ${LABEL[s.work]}`);
	for (const stage of REVIEW_STAGES) {
		const review = s.prStatus?.reviews[stage];
		const { label, pathsFile } = REVIEWS[stage];
		if (review?.needed && !review.done && reviewsBefore(s.stage).includes(stage) && at <= STAGES.indexOf("ready_gate")) lines.push(`${label} checkbox missing from the PR body`);
		if (review && !review.needed && s.stage === stage) lines.push(`${label} not needed: \`${pathsFile}\` lists no changed file`);
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
	if (s.stage === "live" && s.prStatus) {
		const needs = liveNeeds(s.prStatus);
		if (needs.length > 0) lines.push(`First need: ${LABEL[needs[0].kind]}. Record it with ship_stage({stage: '${needs[0].kind}'}).`);
	}
	return lines.join("\n");
}

/** The arguments of `gh pr <sub>` when the command's words run it, including any `-R` given before `<sub>`, else `undefined`. */
export function ghPr(words: string[], sub: "create" | "ready"): string[] | undefined {
	if (words[0] !== "gh" || words[1] !== "pr") return undefined;
	let i = 2;
	while (/^(?:-R|--repo(?:=|$))/.test(words[i] ?? "")) i += words[i] === "-R" || words[i] === "--repo" ? 2 : 1;
	return words[i] === sub ? [...words.slice(2, i), ...words.slice(i + 1)] : undefined;
}

/** The PR a `gt submit --publish` (or `gt ss -p`) puts live, the branch's, with an empty selector, and the directory it runs in from `dir` after gt's own flags such as `--cwd`; `undefined` when the words publish nothing. */
function gtPublish(words: string[], dir: string | null): { selector: string[]; dir: string | null } | undefined {
	if (words[0] !== "gt") return undefined;
	let i = 1;
	for (; words[i]?.startsWith("-"); i++) {
		if (words[i] === "--cwd") dir = within(dir, words[++i]);
		else if (words[i].startsWith("--cwd=")) dir = within(dir, words[i].slice(6));
	}
	return (words[i] === "submit" || words[i] === "ss") && words.slice(i + 1).some(a => a === "--publish" || a === "-p") ? { selector: [], dir } : undefined;
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

/**
 * Whether a PR needs `review`: when the repository commits no `review.pathsFile` (`paths` is `undefined`), only if the review has `withoutPaths`;
 * else always when GitHub listed fewer `files` than the PR's `changedFiles`, and otherwise when a changed repository-relative path matches one of its globs.
 * The file lists one glob per line; `#` starts a comment and blank lines are ignored.
 */
export function reviewNeeded(review: Review, paths: string | undefined, files: string[], changedFiles: number): boolean {
	if (paths === undefined) return review.withoutPaths;
	if (files.length < changedFiles) return true;
	const globs = paths.split("\n").map(line => line.replace(/#.*/, "").trim()).filter(Boolean).map(glob => new Bun.Glob(glob));
	return files.some(file => globs.some(glob => glob.match(file)));
}

/** Each review's state for a PR with this body that changes `files`; `read` returns the text of a paths file in the checkout, `undefined` when it has none. */
export function reviewsOf(body: string, files: string[], changedFiles: number, read: (pathsFile: string) => string | undefined): Reviews {
	return byReview(stage => ({ needed: reviewNeeded(REVIEWS[stage], read(REVIEWS[stage].pathsFile), files, changedFiles), done: body.includes(REVIEWS[stage].box) }));
}

/** The reviews whose stages come before `stage`. */
function reviewsBefore(stage: Stage): ReviewStage[] {
	return REVIEW_STAGES.filter(review => STAGES.indexOf(review) < STAGES.indexOf(stage));
}

/** The first review, in stage order, that runs before `stage` and that the PR needs without its box. */
function missingReview(reviews: Reviews, stage: Stage): ReviewStage | undefined {
	return reviewsBefore(stage).find(review => reviews[review].needed && !reviews[review].done);
}

/** A reader returning the text of a paths file from the top of the checkout holding `dir`, or `undefined` when it has none. */
function checkoutReader(dir: string): (pathsFile: string) => string | undefined {
	let root: string | undefined;
	for (let at = dir; ; at = dirname(at)) {
		if (existsSync(join(at, ".git"))) {
			root = at;
			break;
		}
		if (dirname(at) === at) break;
	}
	return pathsFile => {
		if (root === undefined) return undefined;
		const file = join(root, pathsFile);
		return existsSync(file) ? readFileSync(file, "utf8") : undefined;
	};
}

/** Why a PR with this body may not go live, or `undefined` when it may: it needs the box of every review `reviews` calls for, and no unchecked proof box. */
export function publishBlocker(body: string, reviews: Reviews): string | undefined {
	const missing = missingReview(reviews, "live");
	if (missing) {
		const { label, box } = REVIEWS[missing];
		return `Blocked: the PR is not live until the ${label} stage is done. Run it, apply and push its fixes, then add \`${box}\` to the PR body.`;
	}
	if (body.split("\n").some(line => line.trimStart().startsWith(PROOF_BOX))) {
		return `Blocked: the PR body has an unchecked \`${PROOF_BOX}\` box from the repository's PR template. Do what the box and the repository's instructions ask, then check it; delete the line only when it does not apply to this PR.`;
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
		files: z.object({ nodes: z.array(z.object({ path: z.string() })) }),
		reviewThreads: z.object({ nodes: z.array(z.object({ isResolved: z.boolean() })), pageInfo: z.object({ hasNextPage: z.boolean() }) }),
		commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({ state: z.string() }).nullable() }) })) }),
	});
	const prStatusSchema = z.object({
		state: z.enum(["OPEN", "MERGED", "CLOSED"]), draft: z.boolean(), conflicts: z.boolean(), behind: z.boolean(),
		unresolvedThreads: z.number().int(), moreThreads: z.boolean(), changesRequested: z.boolean(), approved: z.boolean(),
		checks: z.enum(["pass", "fail", "pending", "none"]),
		reviews: z.object(byReview(() => z.object({ needed: z.boolean(), done: z.boolean() }))),
	});
	const stateSchema = z.object({
		stage: z.enum(STAGES), work: z.enum(LIVE_WORK).optional(), issue: z.string().optional(),
		repo: z.string().optional(), pr: z.number().int().optional(), note: z.string().optional(),
		// A status recorded before the reviews were per stage is dropped; the next poll refetches it.
		prStatus: prStatusSchema.optional().catch(undefined), updatedAt: z.string(),
	});
	const viewSchema = z.object({ body: z.string(), changedFiles: z.number().int(), files: z.array(z.object({ path: z.string() })), url: z.string() });
	let state: ShipState | undefined;
	let lastRefresh = 0;
	let lastSummary = "";
	let refreshFailure: string | undefined;
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
		state = { ...next, updatedAt: new Date().toISOString() };
		pi.appendEntry(ENTRY, state);
		render(ctx);
	}

	function restore(ctx: ExtensionContext) {
		state = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY) {
				const parsed = stateSchema.safeParse(entry.data);
				if (parsed.success) state = parsed.data;
			}
		}
		lastSummary = state?.prStatus ? liveSummary(state.prStatus) : "";
		refreshFailure = state?.prStatus && state.stage !== "merged" ? "Status restored from the session; awaiting a fresh GitHub read." : undefined;
		render(ctx);
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
		if (!state?.pr || !state.repo || state.stage === "merged") return render(ctx);
		const [owner, name] = state.repo.split("/");
		const r = await gh(["api", "graphql", "-f", `query=${PR_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `n=${state.pr}`], ctx.cwd);
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
		const r = await gh(["pr", "view", ...selector, "--json", "body,changedFiles,files,url"], dir);
		if (r.code !== 0) {
			const error = r.stderr.trim() || r.stdout.trim();
			if (/^no pull requests found for branch\b/i.test(error)) {
				return { kind: "block", reason: "Blocked: this branch has no PR yet. Create a draft with `gt submit --draft` for Graphite, or `gh pr create --draft` otherwise. Then run each review stage the change needs, commit and push its fixes, add its box, and pass the ready gate before publishing." };
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
		const { body, files, changedFiles } = parsed.data;
		const reason = publishBlocker(body, reviewsOf(body, files.map(file => file.path), changedFiles, checkoutReader(dir)));
		return reason ? { kind: "block", reason } : { kind: "ask" };
	}

	pi.on("session_start", async (_event, ctx) => {
		restore(ctx);
		ctx.setInterval(() => refresh(ctx), POLL_MS);
		await refresh(ctx);
	});
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
			const create = ghPr(words, "create");
			if (create && !create.some(a => a === "--draft" || a === "-d" || a.startsWith("--draft="))) {
				return { block: true, reason: "Blocked: open PRs as drafts (`gh pr create --draft`). A PR goes live only after the ready gate, and after each review its changed files call for." };
			}
			const ready = ghPr(words, "ready");
			const live = ready && !ready.includes("--undo") ? { selector: prSelector(ready), dir } : gtPublish(words, dir);
			if (!live) continue;
			const command = `\`${words.join(" ")}\``;
			if (/\bGH_(?:REPO|HOST)=/.test(input.command)) {
				return { block: true, reason: `Blocked: this command sets GH_REPO or GH_HOST, which this gate cannot apply to its own read of the PR ${command} puts live. Name the repository with \`-R owner/name\` or a PR URL instead, then retry.` };
			}
			if (live.dir === null) {
				return { block: true, reason: `Blocked: ${command} puts a PR live from a directory this gate cannot locate, because a variable, a command substitution, or \`cd -\` names it. Write the directory out, as in \`cd /absolute/path && ...\`, or set the bash call's cwd, then retry.` };
			}
			const verdict = await publishCheck(live.selector, live.dir, command, ctx.cwd);
			if (verdict.kind === "theirs") continue;
			if (verdict.kind === "block") return { block: true, reason: verdict.reason };
			if (!ctx.hasUI || !(await ctx.ui.confirm("Put PR live for review?", `The PR passed the ship gate. ${ready ? "Mark this draft ready" : "Publish it"} for human review?`))) {
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
			save(ctx, { ...state, repo: url[1], pr: Number(url[2]), stage: REVIEW_STAGES[0] });
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
	});
	pi.registerTool({
		loadMode: "essential",
		name: "ship_stage",
		label: "Ship stage",
		description: [
			`Read or record the /ship workflow stage of this session: ${STAGES.join(", ")}.`,
			"While live, record the work you start: rebase, fix_comments, or fix_ci; record `live` again after you push.",
			"Call with no stage to read the current stage, the PR's live needs from GitHub, and the next action.",
		].join(" "),
		parameters: toolParamsSchema,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const parsed = toolParamsSchema.safeParse(params);
			if (!parsed.success) return { content: [{ type: "text", text: "Invalid ship stage input." }], isError: true };
			const { stage, issue, pr, repo, note } = parsed.data;
			const base: ShipState = state ?? { stage: "ticket", updatedAt: "" };
			const newPr = pr !== undefined && pr !== base.pr;
			if (newPr || (repo !== undefined && repo !== base.repo)) {
				// Record the PR before polling, so the gates below read this PR's body rather than none or another PR's.
				const prRepo = repo ?? base.repo ?? (pr ? await resolveRepo(ctx.cwd) : undefined);
				save(ctx, { ...base, pr: pr ?? base.pr, repo: prRepo, prStatus: newPr ? undefined : base.prStatus });
			}
			await refreshNow(ctx);
			if (refreshFailure && stage && NEEDS_CURRENT_STATUS.includes(stage)) {
				return { content: [{ type: "text", text: `Cannot advance using stale GitHub status: ${refreshFailure}` }], isError: true };
			}
			if (stage || issue || pr || repo || note !== undefined) {
				if (stage === "ready_gate" || (stage !== undefined && isReviewStage(stage))) {
					const reviews = state?.prStatus?.reviews;
					if (!reviews && reviewsBefore(stage).length > 0) {
						return { content: [{ type: "text", text: `GitHub has reported no status for this PR, so ${stage} cannot check its review boxes. Name the PR with ship_stage({pr}).` }], isError: true };
					}
					const missing = reviews && missingReview(reviews, stage);
					if (missing) {
						const { label, box, pathsFile, withoutPaths } = REVIEWS[missing];
						return { content: [{ type: "text", text: `The PR must have \`${box}\` after the ${label} fixes are pushed, since a changed file matches \`${pathsFile}\`${withoutPaths ? ` or the repository has no \`${pathsFile}\`` : ""}.` }], isError: true };
					}
				}
				if ((stage === "live" || stage === "rebase" || stage === "fix_comments" || stage === "fix_ci") && (!state?.prStatus || state.prStatus.draft || state.prStatus.state !== "OPEN")) {
					return { content: [{ type: "text", text: "The PR must be open and ready for review before recording live work." }], isError: true };
				}
				if (stage === "merged" && state?.prStatus?.state !== "MERGED") {
					return { content: [{ type: "text", text: "GitHub has not reported this PR merged." }], isError: true };
				}
				const current = state ?? base;
				const isWork = stage === "rebase" || stage === "fix_comments" || stage === "fix_ci";
				save(ctx, {
					...current,
					stage: stage ? (isWork ? "live" : stage) : current.stage,
					work: stage ? (isWork ? stage : undefined) : current.work,
					issue: issue ?? current.issue,
					note: note === undefined ? current.note : note || undefined,
				});
			}
			return { content: [{ type: "text", text: `${report(state)}${refreshFailure ? `\nGitHub status unavailable; previous status is stale: ${refreshFailure}` : ""}` }], details: { state, ...(refreshFailure ? { stale: true, error: refreshFailure } : {}) } };
		},
	});
}
