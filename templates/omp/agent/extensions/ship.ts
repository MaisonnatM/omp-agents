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
	draft_pr: "Create a draft with `gt submit --draft` for a Graphite repository, or push and run `gh pr create --draft` otherwise. Include the issue ID in the title and `Fixes <ID>` in the body.",
	thermonuclear: "Start dashboard-bound Review triage, save structured findings and proposed handling, and wait for the user's card decisions. Apply accepted does not commit, push, post, resolve, or edit the PR body. On a separate user-authorized /ship continuation, inspect the application evidence, commit and push, then add the review checkbox.",
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

/**
 * The commands of a bash line, each as its words: split on `&&`, `||`, `;`, `|`, `&`, parentheses, and newlines outside quotes,
 * with quotes removed and leading `NAME=value` assignments dropped, so `cd x && gh pr ready 4` is two commands and `rg "gh pr ready" f` one `rg`.
 */
export function commands(line: string): string[][] {
	const out: string[][] = [];
	let words: string[] = [];
	let word: string | undefined;
	const endWord = () => {
		if (word !== undefined) words.push(word);
		word = undefined;
	};
	const endCommand = () => {
		endWord();
		if (words.length > 0) out.push(words);
		words = [];
	};
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === "'") {
			const end = line.indexOf("'", i + 1);
			const stop = end < 0 ? line.length : end;
			word = (word ?? "") + line.slice(i + 1, stop);
			i = stop;
		} else if (c === '"') {
			word ??= "";
			for (i++; i < line.length && line[i] !== '"'; i++) {
				if (line[i] === "\\" && '"\\$`'.includes(line[i + 1] ?? "")) i++;
				word += line[i];
			}
		} else if (c === "\\") {
			i++;
			if (i < line.length && line[i] !== "\n") word = (word ?? "") + line[i];
		} else if (c === " " || c === "\t") {
			endWord();
		} else if (c === "&" && (line[i - 1] === ">" || line[i - 1] === "<" || line[i + 1] === ">")) {
			// The `&` of a redirection such as `2>&1` or `&>file`.
			word = (word ?? "") + c;
		} else if ("&|;()\n".includes(c)) {
			endCommand();
		} else {
			word = (word ?? "") + c;
		}
	}
	endCommand();
	return out.flatMap(w => {
		const start = w.findIndex(x => !/^[A-Za-z_]\w*=/.test(x));
		return start < 0 ? [] : [w.slice(start)];
	});
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
		if (r.code !== 0) return render(ctx);
		let response: unknown;
		try {
			response = JSON.parse(r.stdout);
		} catch {
			return render(ctx);
		}
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
		if (r.code !== 0) {
			const error = r.stderr.trim() || r.stdout.trim();
			if (/^no pull requests found for branch\b/i.test(error)) {
				return "Blocked: this branch has no PR yet. Create a draft with `gt submit --draft` for Graphite, or `gh pr create --draft` otherwise. Then run the thermonuclear Review triage, push the accepted fixes on a user-authorized /ship continuation, add the review checkbox, and pass the ready gate before publishing.";
			}
			return `Could not read the PR body to check the thermonuclear review: ${error}`;
		}
		if (!r.stdout.includes(CHECKBOX)) return `Blocked: the PR is not live until the thermonuclear review's accepted fixes are pushed. After the user's Review triage decisions and Apply accepted, inspect the application evidence, commit and push, then add \`${CHECKBOX}\` to the PR body.`;
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
				const reason = await bodyHasCheckbox(selector, cwd);
				if (reason) return { block: true, reason };
				if (!ctx.hasUI || !(await ctx.ui.confirm("Put PR live for review?", "The thermonuclear review is complete. Mark this draft ready for human review?"))) {
					return { block: true, reason: "The PR remains a draft until the operator approves putting it live." };
				}
			}
			if (words[0] === "gt" && (words[1] === "submit" || words[1] === "ss") && words.some(a => a === "--publish" || a === "-p")) {
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
			return { content: [{ type: "text", text: report(state) }], details: { state } };
		},
	});
}
