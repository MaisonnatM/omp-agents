// Tracks the /ship workflow (Linear ticket -> draft PR -> thermonuclear -> live for review) per session.
// The agent declares the stage it works on through the `ship_stage` tool. GitHub decides what a live PR
// needs next (rebase, review comments, CI), so that part is polled, never declared.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const ENTRY = "omp-ship.state";
const WIDGET = "omp-ship";
export const CHECKBOX = "- [x] Thermo-nuclear code quality review";
const POLL_MS = 60_000;
const TURN_REFRESH_MS = 15_000;

export const STAGES = ["ticket", "implement", "draft_pr", "thermonuclear", "ready_gate", "live", "merged"] as const;
export type Stage = (typeof STAGES)[number];
export const LIVE_WORK = ["rebase", "fix_comments", "fix_ci"] as const;
export type LiveWork = (typeof LIVE_WORK)[number];

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
	draft_pr: "Push and run `gh pr create --draft` with the issue ID in the title and `Fixes <ID>` in the body.",
	thermonuclear: `Run thermonuclear-reviewer on the PR diff, apply the findings, push, then add \`${CHECKBOX}\` to the PR body.`,
	ready_gate: "Ask the user to approve, then run `gh pr ready <N>`.",
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

/** Bash segments, split on shell separators, so `cd x && gh pr ready 4` is seen as two commands. */
function segments(command: string): string[] {
	return command.split(/&&|\|\||;|\||\n/).map(s => s.trim()).filter(Boolean);
}

function args(rest: string): string[] {
	return rest.trim().split(/\s+/).filter(Boolean);
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

	const gh = (ghArgs: string[], cwd: string) => pi.exec("gh", ghArgs, { cwd, timeout: 20_000 });

	function render(ctx: ExtensionContext) {
		if (!ctx.hasUI || ctx.agent?.kind === "sub") return;
		ctx.ui.setStatus(WIDGET, state ? statusText(state) : undefined);
		ctx.ui.setWidget(WIDGET, state ? renderLines(state) : undefined, { placement: "aboveEditor" });
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
		render(ctx);
	}

	async function resolveRepo(cwd: string): Promise<string | undefined> {
		const r = await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd);
		return r.code === 0 ? r.stdout.trim() || undefined : undefined;
	}

	async function refresh(ctx: ExtensionContext) {
		lastRefresh = Date.now();
		if (!state?.pr || !state.repo || state.stage === "merged") return render(ctx);
		const [owner, name] = state.repo.split("/");
		const r = await gh(["api", "graphql", "-f", `query=${PR_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `n=${state.pr}`], ctx.cwd);
		if (r.code !== 0) return render(ctx);
		const response: unknown = JSON.parse(r.stdout);
		const raw = response && typeof response === "object" && "data" in response ? response.data : undefined;
		const repository = raw && typeof raw === "object" && "repository" in raw ? raw.repository : undefined;
		const payload = repository && typeof repository === "object" && "pullRequest" in repository ? repository.pullRequest : undefined;
		const parsed = prSchema.safeParse(payload);
		if (!parsed.success) return render(ctx);
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

	async function bodyHasCheckbox(selector: string[], cwd: string): Promise<string | undefined> {
		const r = await gh(["pr", "view", ...selector, "--json", "body", "-q", ".body"], cwd);
		if (r.code !== 0) return `Could not read the PR body to check the thermonuclear review: ${r.stderr.trim() || r.stdout.trim()}`;
		if (!r.stdout.includes(CHECKBOX)) return `Blocked: the PR is not live until the thermonuclear review is applied and pushed. Run the thermonuclear stage, then add \`${CHECKBOX}\` to the PR body.`;
		return undefined;
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
		for (const seg of segments(input.command)) {
			const create = seg.match(/\bgh\s+pr\s+create\b(.*)$/);
			if (create && !args(create[1]).some(a => a === "--draft" || a === "-d" || a.startsWith("--draft="))) {
				return { block: true, reason: "Blocked: open PRs as drafts (`gh pr create --draft`). A PR goes live only after the thermonuclear review." };
			}
			const ready = seg.match(/\bgh\s+pr\s+ready\b(.*)$/);
			if (ready && !args(ready[1]).includes("--undo")) {
				const reason = await bodyHasCheckbox(args(ready[1]), cwd);
				if (reason) return { block: true, reason };
				if (!ctx.hasUI || !(await ctx.ui.confirm("Put PR live for review?", "The thermonuclear review is complete. Mark this draft ready for human review?"))) {
					return { block: true, reason: "The PR remains a draft until the operator approves putting it live." };
				}
			}
			if (/\bgt\s+(submit|ss)\b/.test(seg) && /(^|\s)(--publish|-p)(\s|$)/.test(seg)) {
				const reason = await bodyHasCheckbox([], cwd);
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
		if (/\bgh\s+pr\s+create\b/.test(command) && url && !state.pr) {
			save(ctx, { ...state, repo: url[1], pr: Number(url[2]), stage: "thermonuclear" });
			await refresh(ctx);
		} else if (/\bgh\s+pr\s+ready\b/.test(command) && !/--undo/.test(command) && state.pr && state.stage !== "live") {
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
			await refresh(ctx);
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
				const base: ShipState = state ?? { stage: "ticket", updatedAt: "" };
				const isWork = stage === "rebase" || stage === "fix_comments" || stage === "fix_ci";
				const next: ShipState = {
					...base,
					stage: stage ? (isWork ? "live" : stage) : base.stage,
					work: stage ? (isWork ? stage : undefined) : base.work,
					issue: issue ?? base.issue,
					pr: pr ?? base.pr,
					repo: repo ?? base.repo ?? (pr ? await resolveRepo(ctx.cwd) : undefined),
					note: note === undefined ? base.note : note || undefined,
				};
				save(ctx, next);
			}
			await refresh(ctx);
			return { content: [{ type: "text", text: report(state) }], details: { state } };
		},
	});
}
