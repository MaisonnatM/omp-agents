/**
 * Measures the agent harness per period from records that already exist: the ship trace, the target branch's git history, omp-stats' spend, and, with `--github`, a repository's merged pull requests.
 * Usage: `bun run metrics [--json] [--period-days 7] [--periods 4] [--repo <path>]... [--branch main] [--trace <file>] [--stats <db>] [--github <owner/repo>]`.
 *
 * - Cost per landed change: landed changes are the branch's first-parent commits carrying an `Omp-Session` trailer or the `land` tool's `Land <branch>` subject, plus ship traces' first recorded `merged` stage per PR.
 *   A landing without a trailer, from before the trailer hook or a session outside omp, has no session to price.
 *   Each landing session's whole spend, subagents included, comes from omp-stats, or from its trace lines when omp-stats has none; a session that landed twice in a period counts its spend once.
 * - Stage pass rate: the share of `ship_stage` calls naming a stage that the stage's gate recorded, overall and per stage.
 * - Escalation accuracy, a proxy: an escalation is a fix round ship_stage refused for budget or stall, which tells the agent to ask the user.
 *   The user acted on it when the PR's next recorded stage is a different one, such as merged or a rebase; they dismissed it when it is the same fix again, since only approving more rounds lets it record.
 *   With no later recorded stage it stays open.
 * - Human edits, a proxy: agents' branch commits carry no `Omp-Session` trailer either, so only the branch's first-parent commits that are not landings count as a person's.
 *   A landing counts as edited when such a commit touches one of its files within `--edit-days` after it.
 *
 * With `--github <owner/repo>`, for the pull requests GitHub merged in each period, fetched with `gh` and cached under `~/.cache/omp-agents/harness-metrics/`:
 * - Cost per merged PR: the PR's sessions are those of the ship trace lines naming the repository and its number; each session's spend counts once per period, as above.
 * - CI first-pass rate: only required checks count, as GitHub's `isRequired` for the PR says today; a gate such as `human-review` that no rule requires does not.
 *   The PR's first CI commit is its earliest commit that has a required check run that was not cancelled.
 *   It passed first time when, for each required check (a name within a check suite), the earliest non-cancelled run concluded success, neutral, or skipped; reruns after it do not count.
 *   A PR none of whose commits ran a required check is counted apart, as having no required checks; a PR with more than 100 commits is read from its first 100, and a force push hides the commits it replaced.
 * - Review rounds: `CHANGES_REQUESTED` reviews plus the trace's recorded `fix_comments` rounds, per merged PR.
 * - Human edits, a proxy: a merged PR is edited when one of its commits carries no `Omp-Session` trailer.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

/** The fields this script reads from a ship trace line (`TraceLine` in templates/omp/agent/extensions/ship.ts, which root typecheck cannot import). */
export interface TraceLine {
	ts: string;
	session: string;
	repo?: string;
	pr?: number;
	stage: string;
	model?: string;
	tokens: number;
	cost: number;
	round?: number;
	recorded: boolean;
	refusal?: string;
}

const DAY = 86_400_000;
const FIXES: Record<string, true> = { fix_ci: true, fix_comments: true };

/** A first-parent commit of the target branch, with the files it changed against its first parent. */
export interface Commit {
	sha: string;
	at: number;
	/** Its `Omp-Session` trailers. */
	sessions: string[];
	/** A trailer or a `Land <branch>` subject made it a landing; any other commit is a person's. */
	landed: boolean;
	files: string[];
}

export interface Sources {
	trace: TraceLine[];
	/** Each repository's first-parent commits. */
	repos: Commit[][];
	/** Each session's whole spend with its subagents, as omp-stats recorded it. */
	spend: Map<string, number>;
}

export interface PeriodReport {
	start: string;
	end: string;
	cost: { landings: number; priced: number; usd: number; perLanding: number | null };
	stagePass: { calls: number; recorded: number; rate: number | null; byStage: Record<string, { calls: number; recorded: number }> };
	escalations: { total: number; actedOn: number; dismissed: number; open: number; accuracy: number | null };
	humanEdits: { personCommits: number; landings: number; edited: number; rate: number | null; withinDays: number };
	github?: GithubReport;
}

/** One check run on a commit; `suite` tells apart same-named checks of different workflows, and `required` is whether a rule requires it for the PR. */
export interface CheckRun {
	name: string;
	suite: number;
	startedAt: string;
	conclusion: string | null;
	required: boolean;
}

/** A pull request GitHub merged. */
export interface MergedPr {
	number: number;
	mergedAt: number;
	changesRequested: number;
	/** Its commits, oldest first, with each one's `Omp-Session` trailers. */
	commits: { sha: string; sessions: string[] }[];
	/** The check runs of its first CI commit, required or not, or of its first commit with any check run when none ran a required one; undefined when no commit had any. */
	firstCi?: CheckRun[];
}

export interface GithubReport {
	repo: string;
	merged: number;
	cost: { priced: number; usd: number; perPr: number | null };
	ciFirstPass: { judged: number; passed: number; rate: number | null; noRequired: number };
	reviewRounds: { changesRequested: number; fixRounds: number; perPr: number | null };
	humanEdits: { edited: number; rate: number | null };
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);
const time = (line: TraceLine) => Date.parse(line.ts);

/** Every landed change: landing commits, then each PR's first recorded merge in the trace. */
export function landings(sources: Sources): { at: number; session?: string }[] {
	const out: { at: number; session?: string }[] = [];
	for (const commits of sources.repos) for (const c of commits) if (c.landed) out.push({ at: c.at, session: c.sessions[0] });
	const merged = new Set<string>();
	for (const line of sources.trace.toSorted((a, b) => time(a) - time(b))) {
		const pr = `${line.repo}#${line.pr}`;
		if (line.stage !== "merged" || !line.recorded || merged.has(pr)) continue;
		merged.add(pr);
		out.push({ at: time(line), session: line.session });
	}
	return out;
}

/** Each session's spend: omp-stats when it has any, else the sum of its trace lines. */
function spendOf(sources: Sources): (session: string) => number | undefined {
	const traced = new Map<string, number>();
	for (const line of sources.trace) traced.set(line.session, (traced.get(line.session) ?? 0) + line.cost);
	return session => sources.spend.get(session) ?? traced.get(session);
}

function costReport(landed: { at: number; session?: string }[], spend: (session: string) => number | undefined): PeriodReport["cost"] {
	let priced = 0;
	let usd = 0;
	const counted = new Set<string>();
	for (const { session } of landed) {
		const cost = session === undefined ? undefined : spend(session);
		if (cost === undefined || session === undefined) continue;
		priced++;
		if (counted.has(session)) continue;
		counted.add(session);
		usd += cost;
	}
	return { landings: landed.length, priced, usd, perLanding: ratio(usd, priced) };
}

function stagePassReport(lines: TraceLine[]): PeriodReport["stagePass"] {
	const byStage: Record<string, { calls: number; recorded: number }> = {};
	for (const line of lines) {
		const stage = (byStage[line.stage] ??= { calls: 0, recorded: 0 });
		stage.calls++;
		if (line.recorded) stage.recorded++;
	}
	const recorded = lines.filter(l => l.recorded).length;
	return { calls: lines.length, recorded, rate: ratio(recorded, lines.length), byStage };
}

/** Judges each escalation in [from, to) by the PR's next recorded stage, which may come after `to`. */
function escalationReport(trace: TraceLine[], from: number, to: number): PeriodReport["escalations"] {
	const lines = trace.toSorted((a, b) => time(a) - time(b));
	const counts = { total: 0, actedOn: 0, dismissed: 0, open: 0 };
	const asked = new Set<string>();
	lines.forEach((line, i) => {
		const fix = `${line.repo}#${line.pr}#${line.stage}`;
		if (line.recorded) asked.delete(fix);
		// A refused fix round carries its round; a repeat of the same refusal before anything records is the same escalation.
		if (line.recorded || !FIXES[line.stage] || line.round === undefined || asked.has(fix)) return;
		asked.add(fix);
		if (time(line) < from || time(line) >= to) return;
		counts.total++;
		const next = lines.slice(i + 1).find(l => l.recorded && l.repo === line.repo && l.pr === line.pr);
		if (!next) counts.open++;
		else if (next.stage === line.stage) counts.dismissed++;
		else counts.actedOn++;
	});
	return { ...counts, accuracy: ratio(counts.actedOn, counts.actedOn + counts.dismissed) };
}

function humanEditReport(repos: Commit[][], from: number, to: number, withinDays: number): PeriodReport["humanEdits"] {
	const report = { personCommits: 0, landings: 0, edited: 0, withinDays };
	for (const commits of repos) {
		const person = commits.filter(c => !c.landed);
		report.personCommits += person.filter(c => c.at >= from && c.at < to).length;
		for (const landing of commits) {
			if (!landing.landed || landing.at < from || landing.at >= to) continue;
			report.landings++;
			const files = new Set(landing.files);
			const until = landing.at + withinDays * DAY;
			if (person.some(c => c.at > landing.at && c.at <= until && c.files.some(f => files.has(f)))) report.edited++;
		}
	}
	return { ...report, rate: ratio(report.edited, report.landings) };
}

/** `periods` back-to-back periods of `periodDays` each, oldest first, the last ending at `now`; `github` adds the merged pull requests of that repository. */
export function report(sources: Sources, now: number, periodDays: number, periods: number, editDays: number, github?: { repo: string; prs: MergedPr[] }): PeriodReport[] {
	const landed = landings(sources);
	const spend = spendOf(sources);
	return Array.from({ length: periods }, (_, i) => {
		const to = now - (periods - 1 - i) * periodDays * DAY;
		const from = to - periodDays * DAY;
		const within = (at: number) => at >= from && at < to;
		return {
			start: new Date(from).toISOString(),
			end: new Date(to).toISOString(),
			cost: costReport(
				landed.filter(l => within(l.at)),
				spend,
			),
			stagePass: stagePassReport(sources.trace.filter(l => within(time(l)))),
			escalations: escalationReport(sources.trace, from, to),
			humanEdits: humanEditReport(sources.repos, from, to, editDays),
			...(github && { github: githubReport(github.repo, github.prs, sources.trace, spend, from, to) }),
		};
	});
}

const PASSED: Record<string, true> = { success: true, neutral: true, skipped: true };

/** Whether a commit's checks passed first time: each check's earliest non-cancelled run passed; undefined when no run counts. */
export function firstPass(runs: CheckRun[]): boolean | undefined {
	const first = new Map<string, CheckRun>();
	for (const run of runs) {
		if (run.conclusion === "cancelled") continue;
		const key = `${run.suite}/${run.name}`;
		const seen = first.get(key);
		if (!seen || Date.parse(run.startedAt) < Date.parse(seen.startedAt)) first.set(key, run);
	}
	if (first.size === 0) return undefined;
	return [...first.values()].every(run => run.conclusion !== null && PASSED[run.conclusion]);
}

function githubReport(repo: string, prs: MergedPr[], trace: TraceLine[], spend: (session: string) => number | undefined, from: number, to: number): GithubReport {
	const merged = prs.filter(pr => pr.mergedAt >= from && pr.mergedAt < to);
	const counted = new Set<string>();
	const out = { priced: 0, usd: 0, judged: 0, passed: 0, noRequired: 0, changesRequested: 0, fixRounds: 0, edited: 0 };
	for (const pr of merged) {
		const lines = trace.filter(l => l.repo === repo && l.pr === pr.number);
		const priced = [...new Set(lines.map(l => l.session))].filter(s => spend(s) !== undefined);
		if (priced.length > 0) out.priced++;
		for (const session of priced) {
			if (counted.has(session)) continue;
			counted.add(session);
			out.usd += spend(session) ?? 0;
		}
		const required = pr.firstCi?.filter(run => run.required);
		if (pr.firstCi && required?.length === 0) out.noRequired++;
		const passed = required && firstPass(required);
		if (passed !== undefined) out.judged++;
		if (passed) out.passed++;
		out.changesRequested += pr.changesRequested;
		out.fixRounds += lines.filter(l => l.stage === "fix_comments" && l.recorded).length;
		if (pr.commits.some(c => c.sessions.length === 0)) out.edited++;
	}
	return {
		repo,
		merged: merged.length,
		cost: { priced: out.priced, usd: out.usd, perPr: ratio(out.usd, out.priced) },
		ciFirstPass: { judged: out.judged, passed: out.passed, rate: ratio(out.passed, out.judged), noRequired: out.noRequired },
		reviewRounds: { changesRequested: out.changesRequested, fixRounds: out.fixRounds, perPr: ratio(out.changesRequested + out.fixRounds, merged.length) },
		humanEdits: { edited: out.edited, rate: ratio(out.edited, merged.length) },
	};
}

export function readTrace(file: string): TraceLine[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as TraceLine);
}

/** A merged pull request as `MERGED_PRS_QUERY` returns it. */
interface PrNode {
	number: number;
	mergedAt: string;
	reviews: { nodes: { state: string }[] };
	commits: { nodes: { commit: { oid: string; message: string } }[] };
}

const TRAILER = /^Omp-Session:\s*(\S+)\s*$/gm;

/** Reads `gh api graphql --paginate --jq '.data.search.nodes[]'` output, one pull request per line. */
export function parseMergedPrs(text: string): MergedPr[] {
	return text
		.split("\n")
		.filter(Boolean)
		.map(line => {
			const node = JSON.parse(line) as PrNode;
			return {
				number: node.number,
				mergedAt: Date.parse(node.mergedAt),
				changesRequested: node.reviews.nodes.filter(r => r.state === "CHANGES_REQUESTED").length,
				commits: node.commits.nodes.map(({ commit }) => ({ sha: commit.oid, sessions: [...commit.message.matchAll(TRAILER)].map(m => m[1]!) })),
			};
		});
}

const MERGED_PRS_QUERY = `query($q: String!, $endCursor: String) {
  search(query: $q, type: ISSUE, first: 50, after: $endCursor) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number mergedAt
      reviews(first: 100) { nodes { state } }
      commits(first: 100) { nodes { commit { oid message } } } } }
  }
}`;

const CACHE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "omp-agents", "harness-metrics");
const HOUR = 3_600_000;

async function gh(args: string[]): Promise<string> {
	const child = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${err.trim()}`);
	return out;
}

/** `fetch`'s text, cached at `file` when it says to keep it; a cached copy older than `maxAge` milliseconds is fetched again. */
async function cached(file: string, maxAge: number, fetch: () => Promise<{ text: string; keep: boolean }>): Promise<string> {
	if (existsSync(file) && Date.now() - statSync(file).mtimeMs < maxAge) return readFileSync(file, "utf8");
	const { text, keep } = await fetch();
	if (keep) {
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, text);
	}
	return text;
}

const CHECK_RUNS_QUERY = `query($owner: String!, $name: String!, $oid: GitObjectID!, $pr: Int!) {
  repository(owner: $owner, name: $name) { object(oid: $oid) { ... on Commit {
    checkSuites(first: 100) { nodes { databaseId
      checkRuns(first: 100, filterBy: { checkType: ALL }) { nodes { name startedAt status conclusion isRequired(pullRequestNumber: $pr) } } } } } } }
}`;

/** A commit's check runs, reruns included, each marked required or not for pull request `pr`; cached for good once every run completed. */
async function checkRuns(repo: string, pr: number, sha: string): Promise<CheckRun[]> {
	const [owner = "", name = ""] = repo.split("/");
	const text = await cached(join(CACHE, repo.replace("/", "_"), "check-runs", `${pr}-${sha}.jsonl`), Number.POSITIVE_INFINITY, async () => {
		const text = await gh([
			"api",
			"graphql",
			"-f",
			`query=${CHECK_RUNS_QUERY}`,
			"-f",
			`owner=${owner}`,
			"-f",
			`name=${name}`,
			"-f",
			`oid=${sha}`,
			"-F",
			`pr=${pr}`,
			"--jq",
			".data.repository.object.checkSuites.nodes[] | .databaseId as $suite | .checkRuns.nodes[] | {name, suite: $suite, startedAt, status: (.status | ascii_downcase), conclusion: (.conclusion | if . then ascii_downcase else null end), required: .isRequired}",
		]);
		return { text, keep: !/"status":"(?!completed")/.test(text) };
	});
	return text
		.split("\n")
		.filter(Boolean)
		.map(line => {
			const { status: _, ...run } = JSON.parse(line) as CheckRun & { status: string };
			return run;
		});
}

/** The pull requests `repo` merged since `since`, each with its first CI commit's check runs; the list is cached for an hour. */
export async function fetchMergedPrs(repo: string, since: number): Promise<MergedPr[]> {
	const day = new Date(since).toISOString().slice(0, 10);
	const text = await cached(join(CACHE, repo.replace("/", "_"), `merged-since-${day}.jsonl`), HOUR, async () => ({
		text: await gh(["api", "graphql", "--paginate", "-f", `query=${MERGED_PRS_QUERY}`, "-f", `q=repo:${repo} is:pr is:merged merged:>=${day}`, "--jq", ".data.search.nodes[]"]),
		keep: true,
	}));
	const prs = parseMergedPrs(text).filter(pr => pr.mergedAt >= since);
	const queue = [...prs];
	const worker = async () => {
		for (let pr = queue.shift(); pr; pr = queue.shift()) {
			let anyRuns: CheckRun[] | undefined;
			for (const { sha } of pr.commits) {
				const runs = await checkRuns(repo, pr.number, sha);
				if (firstPass(runs.filter(run => run.required)) !== undefined) {
					pr.firstCi = runs;
					break;
				}
				if (!anyRuns && firstPass(runs) !== undefined) anyRuns = runs;
			}
			pr.firstCi ??= anyRuns;
		}
	};
	await Promise.all(Array.from({ length: 8 }, worker));
	return prs;
}

/** The `git log` format `parseGitLog` reads; `--name-only` lists each commit's files after it. */
export const LOG_FORMAT = "--format=%x1e%H%x1f%at%x1f%(trailers:key=Omp-Session,valueonly,separator=%x2c)%x1f%s";

export function parseGitLog(text: string): Commit[] {
	return text
		.split("\x1e")
		.filter(Boolean)
		.map(record => {
			const [head = "", ...files] = record.split("\n");
			const [sha = "", at = "0", trailers = "", subject = ""] = head.split("\x1f");
			const sessions = trailers.split(",").filter(Boolean);
			return { sha, at: Number(at) * 1000, sessions, landed: sessions.length > 0 || subject.startsWith("Land "), files: files.filter(Boolean) };
		});
}

/** `branch`'s first-parent commits since `since`, each with its files against its first parent. */
export function readRepo(repo: string, branch: string, since: number): Commit[] {
	const done = Bun.spawnSync(["git", "-C", repo, "log", branch, "--first-parent", "--diff-merges=first-parent", "--name-only", `--since=@${Math.floor(since / 1000)}`, LOG_FORMAT]);
	if (done.exitCode !== 0) throw new Error(`git log in ${repo}: ${done.stderr.toString().trim()}`);
	return parseGitLog(done.stdout.toString());
}

/** Each session's spend in omp-stats' database; a subagent's file sits under its session's directory, so the path's first session id names the session. */
export function readSpend(dbPath: string): Map<string, number> {
	const spend = new Map<string, number>();
	if (!existsSync(dbPath)) return spend;
	const db = new Database(dbPath, { readonly: true });
	for (const row of db.query<{ file: string; usd: number }, []>("SELECT session_file AS file, TOTAL(cost_total) AS usd FROM messages GROUP BY session_file").all()) {
		const session = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(row.file)?.[1];
		if (session) spend.set(session, (spend.get(session) ?? 0) + row.usd);
	}
	db.close();
	return spend;
}

const pct = (rate: number | null) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);

export function formatTable(periods: PeriodReport[]): string {
	const rows: [string, (p: PeriodReport) => string][] = [
		["Landed changes", p => String(p.cost.landings)],
		["Cost per landed change", p => (p.cost.perLanding === null ? "n/a" : `$${p.cost.perLanding.toFixed(2)} (${p.cost.priced} priced)`)],
		["Stage pass rate", p => `${pct(p.stagePass.rate)} (${p.stagePass.recorded}/${p.stagePass.calls})`],
		["Escalation accuracy", p => `${pct(p.escalations.accuracy)} (${p.escalations.actedOn}/${p.escalations.actedOn + p.escalations.dismissed}, ${p.escalations.open} open)`],
		["Person commits", p => String(p.humanEdits.personCommits)],
		[`Landings a person edited within ${periods[0]?.humanEdits.withinDays ?? 0}d`, p => `${pct(p.humanEdits.rate)} (${p.humanEdits.edited}/${p.humanEdits.landings})`],
	];
	const repo = periods[0]?.github?.repo;
	if (repo) {
		const of = (cell: (g: GithubReport) => string) => (p: PeriodReport) => (p.github ? cell(p.github) : "n/a");
		rows.push(
			[`Merged PRs in ${repo}`, of(g => String(g.merged))],
			["Cost per merged PR", of(g => (g.cost.perPr === null ? "n/a" : `$${g.cost.perPr.toFixed(2)} (${g.cost.priced} priced)`))],
			["CI first-pass rate (required checks)", of(g => `${pct(g.ciFirstPass.rate)} (${g.ciFirstPass.passed}/${g.ciFirstPass.judged}${g.ciFirstPass.noRequired > 0 ? `, ${g.ciFirstPass.noRequired} with no required checks` : ""})`)],
			[
				"Review rounds per merged PR",
				of(g => (g.reviewRounds.perPr === null ? "n/a" : `${g.reviewRounds.perPr.toFixed(2)} (${g.reviewRounds.changesRequested} changes requested, ${g.reviewRounds.fixRounds} fix rounds)`)),
			],
			["Merged PRs with a person's commit", of(g => `${pct(g.humanEdits.rate)} (${g.humanEdits.edited}/${g.merged})`)],
		);
	}
	const table = [["Metric", ...periods.map(p => `${p.start.slice(0, 10)}..${p.end.slice(0, 10)}`)], ...rows.map(([label, cell]) => [label, ...periods.map(cell)])];
	const widths = table[0]!.map((_, i) => Math.max(...table.map(r => r[i]!.length)));
	return table.map(r => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd()).join("\n");
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			json: { type: "boolean", default: false },
			"period-days": { type: "string", default: "7" },
			periods: { type: "string", default: "4" },
			"edit-days": { type: "string", default: "7" },
			repo: { type: "string", multiple: true, default: [process.cwd()] },
			branch: { type: "string", default: "main" },
			trace: { type: "string", default: join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "ship-trace.jsonl") },
			stats: { type: "string", default: join(homedir(), ".omp", "stats.db") },
			github: { type: "string" },
		},
	});
	const periodDays = Number(values["period-days"]);
	const periods = Number(values.periods);
	const now = Date.now();
	const since = now - periodDays * periods * DAY;
	const sources: Sources = {
		trace: readTrace(values.trace),
		repos: values.repo.map(repo => readRepo(repo, values.branch, since)),
		spend: readSpend(values.stats),
	};
	const github = values.github ? { repo: values.github, prs: await fetchMergedPrs(values.github, since) } : undefined;
	const result = report(sources, now, periodDays, periods, Number(values["edit-days"]), github);
	console.log(values.json ? JSON.stringify(result, null, 2) : formatTable(result));
}
