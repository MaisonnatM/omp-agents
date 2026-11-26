// Tracks the /ship workflow (optional Linear ticket -> plan -> draft PR -> reviews -> live for review) per session.
// The agent declares the stage it works on through the `ship_stage` tool. GitHub decides what a live PR
// needs next (rebase, review comments, CI), so that part is polled, never declared.
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { commands, located } from "./shell/commands";
import { quotaExhausted } from "./github/access";
import { GhRunner } from "./github/runner";
import { descriptionSnapshot, editDescription } from "./github/description";
import { contractSourceRefusal, declaredChecks, parseBranchLog, planBrief, plannedTestEdits, repoRelative, scopeRefusal, testFirstRefusal, toolRuns, VERIFIED_STAGES, verificationRefusal, withRejected } from "./ship/checks";
import { appendTrace, FIX_BUDGET, isFixWork, liveSummary, PR_QUERY, parsePr, renderLines, report, settleFixes, type Spent, STALL_ROUNDS, startFix, statusText } from "./ship/live";
import { authDiagnosis, checkoutReader, dotenvFiles, FAST_PATH, ghPr, opensLivePr, otherOwner, prSelector, publishBlocker, reviewsBefore, reviewsOf, selectorOwner } from "./ship/publish";
import { byReview, type Contract, isReviewStage, LABEL, LIVE_WORK, type LiveWork, missingOutput, NEEDS_CURRENT_STATUS, type Post, prOfUrl, REVIEW_STAGES, REVIEWS, type ShipState, STAGES, type Stage, type StageOutputs, withFastPath, withPost } from "./ship/stages";

export * from "./ship/checks";
export * from "./ship/live";
export * from "./ship/publish";
export * from "./ship/stages";

const ENTRY = "omp-ship.state";
/** The message that puts the contract and rejected approaches back in the agent's context after a compaction or a resume. */
const BRIEF = "omp-ship.brief";
const WIDGET = "omp-ship";
const POLL_MS = 60_000;
const TURN_REFRESH_MS = 15_000;

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
		source: z.string().nullable().default(() => null),
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
		contract: contractSchema.optional().describe("At the plan stage, required before implement, replacing any earlier one: goal, one sentence; constraints, rules the change keeps, naming `test-change: <reason>` to change an existing test and `scope-change: <reason>` to change files outside files_to_change; files_to_change, repository-relative paths or globs; test_first, the test path written and committed before the code, which a bug fix needs, or null; done_when, at least one check that shows the change done; source, the run's Linear issue identifier the contract was drafted from, required when the run has an issue, or null"),
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
			"draft_pr and ready_gate are refused until a test, typecheck, or lint bash command exits 0 in this session after the last edit, write, or task call, and while the branch changes a file outside the contract's files_to_change other than a lockfile or generated file, unless a constraint names scope-change; with a contract's test_first, draft_pr is also refused until a branch commit changing only that test comes before the first commit changing code.",
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
			const refusal = contractSourceRefusal(contract, issue ?? state?.issue) ?? await testEditRefusal(contract, ctx.cwd);
			if (refusal) return { content: [{ type: "text" as const, text: refusal }], isError: true };
		}
		if (stage === "implement" && !(contract ?? state?.contract)) {
			return { content: [{ type: "text" as const, text: "Record the plan's contract before implementing: call ship_stage({stage: 'implement', contract: {goal, constraints, files_to_change, test_first, done_when, source}}), with done_when listing at least one check and source the run's issue, or null without one." }], isError: true };
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
				?? (state?.contract ? await scopeCheck(verified, state.contract, ctx.cwd) : undefined)
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

	/** The commit where the checkout's branch left its default branch, abbreviated, or `undefined` when the checkout has no default branch. */
	async function branchBase(cwd: string): Promise<string | undefined> {
		for (const ref of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
			const r = await pi.exec("git", ["merge-base", "HEAD", ref], { cwd });
			if (r.code === 0 && r.stdout.trim()) return r.stdout.trim().slice(0, 12);
		}
		return undefined;
	}

	/** Why `contract`'s branch may not get its draft PR: with a `test_first`, a commit changing only that test must come before the code. */
	async function testOrderRefusal(contract: Contract, cwd: string): Promise<string | undefined> {
		if (!contract.test_first) return undefined;
		const base = await branchBase(cwd);
		if (!base) return `draft_pr is not recorded: the contract's test_first is "${contract.test_first}", and this checkout has no main or master branch to read the branch's commits from. Fetch the default branch, then record draft_pr again.`;
		const log = await pi.exec("git", ["log", "--reverse", "--no-merges", "--format=%x00%h", "--name-only", `${base}..HEAD`], { cwd });
		if (log.code !== 0) return `draft_pr is not recorded: \`git log ${base}..HEAD\` failed, so the test-first order cannot be checked: ${log.stderr.trim()}`;
		return testFirstRefusal(contract, parseBranchLog(log.stdout), base);
	}

	/** Why `stage` may not be recorded: the branch changes files outside `contract`'s files_to_change. */
	async function scopeCheck(stage: Stage, contract: Contract, cwd: string): Promise<string | undefined> {
		const base = await branchBase(cwd);
		if (!base) return `${stage} is not recorded: this checkout has no main or master branch to diff the branch against, so its files cannot be checked against the contract's files_to_change. Fetch the default branch, then record ${stage} again.`;
		const diff = await pi.exec("git", ["-c", "core.quotePath=false", "diff", "--name-only", base, "HEAD"], { cwd });
		if (diff.code !== 0) return `${stage} is not recorded: \`git diff --name-only ${base} HEAD\` failed, so the branch's files cannot be checked against the contract's files_to_change: ${diff.stderr.trim()}`;
		return scopeRefusal(stage, contract, diff.stdout.split("\n").filter(Boolean), base);
	}
}
