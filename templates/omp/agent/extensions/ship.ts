// Tracks the /ship workflow (Linear ticket -> draft PR -> thermonuclear -> live for review) per session.
// The agent declares the stage it works on through the `ship_stage` tool. GitHub decides what a live PR
// needs next (rebase, review comments, CI), so that part is polled, never declared.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { commands } from "./shell/commands";
import { GitHubAccess, quotaExhausted, quotaReset } from "./github/access";
import { type Gh, ghJson, ghText } from "./github/command";

const ENTRY = "omp-ship.state";
const WIDGET = "omp-ship";
export const CHECKBOX = "- [x] Thermo-nuclear code quality review";
/** A proof box a repository's PR template declares; the PR goes live only once the author checks it. The gate reads the box, not the proof behind it. */
export const PROOF_BOX = "- [ ] Browser proof";
const POLL_MS = 60_000;
const TURN_REFRESH_MS = 15_000;

export const STAGES = ["ticket", "implement", "draft_pr", "thermonuclear", "ready_gate", "live", "merged"] as const;
export type Stage = (typeof STAGES)[number];
export const LIVE_WORK = ["rebase", "fix_comments", "fix_ci"] as const;
export type LiveWork = (typeof LIVE_WORK)[number];
/** Stages from the ready gate on, and all live work, decide from GitHub's current PR status, never a stale one. */
const NEEDS_CURRENT_STATUS: readonly string[] = [...STAGES.slice(STAGES.indexOf("ready_gate")), ...LIVE_WORK];

const LABEL: Record<Stage | LiveWork, string> = {
	ticket: "Ticket",
	implement: "Implement",
	draft_pr: "Draft PR",
	thermonuclear: "Thermonuclear",
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
	thermonuclear: `Run thermonuclear-reviewer on the PR diff, apply the findings, push, then add \`${CHECKBOX}\` to the PR body. If the body has an unchecked \`${PROOF_BOX}\` box, do what the repository asks for it, then check it.`,
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
	reviewed: boolean;
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
state isDraft mergeable mergeStateStatus reviewDecision body
reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}
commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}`;

interface PrResponse {
	state: "OPEN" | "MERGED" | "CLOSED";
	isDraft: boolean;
	mergeable: string;
	mergeStateStatus: string;
	reviewDecision: string | null;
	body: string;
	reviewThreads: { nodes: { isResolved: boolean }[]; pageInfo: { hasNextPage: boolean } };
	commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}

export function parsePr(pr: PrResponse): PrStatus {
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
		reviewed: pr.body.includes(CHECKBOX),
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
	if (s.prStatus && !s.prStatus.reviewed && (s.stage === "thermonuclear" || s.stage === "ready_gate")) lines.push("Thermonuclear checkbox missing from the PR body");
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

/** The arguments after `gh pr <sub>` when the command's words run it, else `undefined`. */
export function ghPr(words: string[], sub: "create" | "ready"): string[] | undefined {
	return words[0] === "gh" && words[1] === "pr" && words[2] === sub ? words.slice(3) : undefined;
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

/** Why a PR with this body may not go live, or `undefined` when it may: it needs the thermonuclear checkbox and no unchecked proof box. */
export function publishBlocker(body: string): string | undefined {
	if (!body.includes(CHECKBOX)) {
		return `Blocked: the PR is not live until the thermonuclear review is applied and pushed. Run the thermonuclear stage, then add \`${CHECKBOX}\` to the PR body.`;
	}
	if (body.split("\n").some(line => line.trimStart().startsWith(PROOF_BOX))) {
		return `Blocked: the PR body has an unchecked \`${PROOF_BOX}\` box from the repository's PR template. Do what the box and the repository's instructions ask, then check it; delete the line only when it does not apply to this PR.`;
	}
	return undefined;
}

/** A credential gh holds for a host, as `gh auth status --json hosts` reports it; the report carries no token. */
export interface GhCredential {
	host: string;
	/** `success`, `error` when GitHub rejects it, or `timeout`. */
	state: string;
	/** Whether gh uses it for the host. */
	active: boolean;
	login: string;
	/** The environment variable gh read it from, such as `GITHUB_TOKEN`, or the store it sits in, such as `keyring`. */
	tokenSource: string;
}

/**
 * Why GitHub rejects gh, or `undefined` when it accepts every credential gh uses: the credential, where it comes from, and any working login it overrides, never a token.
 * `dotenvFiles` maps an environment variable to the project dotenv file its value came from.
 */
export function authDiagnosis(credentials: GhCredential[], dotenvFiles: Record<string, string>): string | undefined {
	const rejected = credentials.find(c => c.active && c.state === "error");
	if (!rejected) return undefined;
	const login = `\`gh auth login -h ${rejected.host}\``;
	if (!/^[A-Z][A-Z0-9_]*$/.test(rejected.tokenSource)) {
		return `GitHub rejects gh's ${rejected.tokenSource} login${rejected.login ? ` for ${rejected.login}` : ""} on ${rejected.host}. Ask the user to run ${login}.`;
	}
	const working = credentials.find(c => c.host === rejected.host && c.state === "success");
	const file = dotenvFiles[rejected.tokenSource];
	return [
		`GitHub rejects the token in \`${rejected.tokenSource}\`, which gh uses for ${rejected.host}${working ? ` ahead of the ${working.tokenSource} login for ${working.login}, which works` : ""}.`,
		file ? `omp read it from \`${file}\` when it started.` : "It is set in the environment omp started with.",
		`Ask the user to ${working ? "remove or replace it there" : `replace it there, or remove it and run ${login}`}, then restart the session.`,
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
		reviewThreads: z.object({ nodes: z.array(z.object({ isResolved: z.boolean() })), pageInfo: z.object({ hasNextPage: z.boolean() }) }),
		commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({ state: z.string() }).nullable() }) })) }),
	});
	const prStatusSchema = z.object({
		state: z.enum(["OPEN", "MERGED", "CLOSED"]), draft: z.boolean(), conflicts: z.boolean(), behind: z.boolean(),
		unresolvedThreads: z.number().int(), moreThreads: z.boolean(), changesRequested: z.boolean(), approved: z.boolean(),
		checks: z.enum(["pass", "fail", "pending", "none"]), reviewed: z.boolean(),
	});
	const stateSchema = z.object({
		stage: z.enum(STAGES), work: z.enum(LIVE_WORK).optional(), issue: z.string().optional(),
		repo: z.string().optional(), pr: z.number().int().optional(), note: z.string().optional(),
		prStatus: prStatusSchema.optional(), updatedAt: z.string(),
	});
	let state: ShipState | undefined;
	let lastRefresh = 0;
	let lastSummary = "";
	let refreshFailure: string | undefined;
	const access = new GitHubAccess();

	const gh = async (ghArgs: string[], cwd: string) => {
		if (ghArgs[0] === "auth") return pi.exec("gh", ghArgs, { cwd, timeout: 20_000 });
		const run: Gh = args => pi.exec("gh", args, { cwd, timeout: 20_000 });
		const budget = ghArgs[0] === "api" && ghArgs[1] !== "graphql" ? "rest" : "graphql";
		try {
			return { code: 0, stdout: await access.request(budget, () => ghText(run, ghArgs), async () => quotaReset(await ghJson(run, ["api", "rate_limit"]), budget)), stderr: "" };
		} catch (error) {
			return { code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
		}
	};
	const authSchema = z.object({
		hosts: z.record(z.string(), z.array(z.object({ host: z.string(), state: z.string(), active: z.boolean(), login: z.string().default(""), tokenSource: z.string() }))),
	});

	async function authProblem(sessionDir: string): Promise<string | undefined> {
		const r = await gh(["auth", "status", "--json", "hosts"], sessionDir);
		let report: unknown;
		try {
			report = JSON.parse(r.stdout);
		} catch {
			return undefined;
		}
		const parsed = authSchema.safeParse(report);
		return parsed.success ? authDiagnosis(Object.values(parsed.data.hosts).flat(), dotenvFiles(sessionDir)) : undefined;
	}

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
		const prStatus = parsePr(parsed.data);
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

	async function publishCheck(selector: string[], cwd: string, sessionDir: string): Promise<string | undefined> {
		const r = await gh(["pr", "view", ...selector, "--json", "body", "-q", ".body"], cwd);
		if (r.code !== 0) {
			const error = r.stderr.trim() || r.stdout.trim();
			if (/^no pull requests found for branch\b/i.test(error)) {
				return "Blocked: this branch has no PR yet. Create a draft with `gt submit --draft` for Graphite, or `gh pr create --draft` otherwise. Then run the thermonuclear stage, commit and push its fixes, add the review checkbox, and pass the ready gate before publishing.";
			}
			const auth = quotaExhausted(error) ? undefined : await authProblem(sessionDir);
			// gh's hint after its first line, `gh auth login`, cannot replace a token an environment variable holds, and the diagnosis names the fix.
			return `Could not read the PR body to check its review and proof boxes: ${auth ? `${error.split("\n")[0]}. ${auth}` : error}`;
		}
		return publishBlocker(r.stdout);
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
		const cwd = typeof input.cwd === "string" ? input.cwd : ctx.cwd;
		for (const words of commands(input.command)) {
			const create = ghPr(words, "create");
			if (create && !create.some(a => a === "--draft" || a === "-d" || a.startsWith("--draft="))) {
				return { block: true, reason: "Blocked: open PRs as drafts (`gh pr create --draft`). A PR goes live only after the thermonuclear review." };
			}
			const ready = ghPr(words, "ready");
			if (ready && !ready.includes("--undo")) {
				const selector = prSelector(ready);
				// A PR to someone else's repository, such as an awesome list, follows that project's process, not /ship.
				const owner = selectorOwner(selector);
				if (owner && otherOwner(owner, await resolveRepo(cwd))) continue;
				const reason = await publishCheck(selector, cwd, ctx.cwd);
				if (reason) return { block: true, reason };
				if (!ctx.hasUI || !(await ctx.ui.confirm("Put PR live for review?", "The thermonuclear review is complete. Mark this draft ready for human review?"))) {
					return { block: true, reason: "The PR remains a draft until the operator approves putting it live." };
				}
			}
			if (words[0] === "gt" && (words[1] === "submit" || words[1] === "ss") && words.some(a => a === "--publish" || a === "-p")) {
				const reason = await publishCheck([], cwd, ctx.cwd);
				if (reason) return { block: true, reason };
				if (!ctx.hasUI || !(await ctx.ui.confirm("Put PR live for review?", "Publish this reviewed PR for human review?"))) {
					return { block: true, reason: "The PR remains a draft until the operator approves putting it live." };
				}
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
			save(ctx, { ...state, repo: url[1], pr: Number(url[2]), stage: "thermonuclear" });
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
			"Read or record the /ship workflow stage of this session: ticket, implement, draft_pr, thermonuclear, ready_gate, live, merged.",
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
				if (stage === "ready_gate" && state?.prStatus?.reviewed !== true) {
					return { content: [{ type: "text", text: "The PR must have the thermonuclear checkbox after the review fixes are pushed." }], isError: true };
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
