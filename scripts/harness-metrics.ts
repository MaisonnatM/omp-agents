/**
 * Measures the agent harness per period from records that already exist: the ship trace, the target branch's git history, and omp-stats' spend.
 * Usage: `bun run metrics [--json] [--period-days 7] [--periods 4] [--repo <path>]... [--branch main] [--trace <file>] [--stats <db>]`.
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
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

/** The fields this script reads from a ship trace line (`TraceLine` in templates/omp/agent/extensions/ship.ts, which root typecheck cannot import). */
interface TraceLine {
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

/** `periods` back-to-back periods of `periodDays` each, oldest first, the last ending at `now`. */
export function report(sources: Sources, now: number, periodDays: number, periods: number, editDays: number): PeriodReport[] {
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
		};
	});
}

export function readTrace(file: string): TraceLine[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as TraceLine);
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
	const result = report(sources, now, periodDays, periods, Number(values["edit-days"]));
	console.log(values.json ? JSON.stringify(result, null, 2) : formatTable(result));
}
