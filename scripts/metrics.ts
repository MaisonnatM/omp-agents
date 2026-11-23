/**
 * Measures how well agents ship, over the last 7 and 30 days, from records that already exist:
 * the `land` tool's results in omp's session files, the ship trace, git history, and omp-stats' `~/.omp/stats.db`.
 * Usage: `bun run metrics [--json] [--days 7,30] [--human-days 7] [--repo <path>]... [--branch main]`.
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const DAY = 86_400_000;

/** The `kind` of a `LandResult` from `templates/omp/agent/extensions/land/lander.ts`. */
type LandKind = "landed" | "nothing" | "refused" | "conflict" | "failed" | "rejected";

/** The fields read here of a ship trace line, which `TraceLine` in `templates/omp/agent/extensions/ship.ts` writes; that file is outside the typecheck. */
export interface TraceLine {
	ts: string;
	session: string;
	repo?: string;
	pr?: number;
	stage: string;
	round?: number;
	recorded: boolean;
}

/** One `land` tool call, from its result in a main session's file. */
export interface LandAttempt {
	at: number;
	session: string;
	kind: LandKind;
}

/** A commit of the target branch, with the files it changed. */
export interface Commit {
	sha: string;
	parents: string[];
	at: number;
	/** Its `Omp-Session` trailers, or those of the merge that landed it; none means a person made it. */
	sessions: string[];
	files: string[];
}

export interface Sources {
	attempts: LandAttempt[];
	trace: TraceLine[];
	/** Per repository: the branch's first-parent commits, and every non-merge commit reachable from it. */
	repos: { firstParent: Commit[]; commits: Commit[] }[];
	/** A session's whole spend with its subagents, or null when omp-stats recorded none of it. */
	costOf: (session: string) => number | null;
}

export interface WindowReport {
	days: number;
	/** `land` results that pushed, plus ship traces that reached the merged stage. */
	cost: { landings: number; priced: number; usd: number; perLanding: number | null };
	/** Runs of `land` calls in one session up to a landing: did the first call land? `nothing` results are not attempts. */
	landPass: { runs: number; firstTry: number; rate: number | null };
	/**
	 * ship_stage refusals of a fix round, budget or stall, by what the PR did next:
	 * merged without the agent getting more rounds (the escalation was needed),
	 * merged after the user approved more rounds (the agent could have finished), or not merged yet.
	 */
	escalations: { total: number; needed: number; agentFinished: number; unresolved: number; accuracy: number | null };
	/** Agent landings on the branch followed, within `withinDays`, by a person's commit to one of the same files. */
	humanEdits: { landings: number; edited: number; rate: number | null; withinDays: number };
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function landings(sources: Sources, since: number): { at: number; session: string }[] {
	const seen = new Set<string>();
	const out: { at: number; session: string }[] = [];
	for (const a of sources.attempts) if (a.kind === "landed" && a.at >= since) out.push(a);
	for (const t of sources.trace) {
		const at = Date.parse(t.ts);
		const key = `${t.repo}#${t.pr}`;
		if (t.stage !== "merged" || !t.recorded || at < since || seen.has(key)) continue;
		seen.add(key);
		out.push({ at, session: t.session });
	}
	return out;
}

function costReport(sources: Sources, since: number): WindowReport["cost"] {
	const landed = landings(sources, since);
	let priced = 0;
	let usd = 0;
	const counted = new Set<string>();
	for (const { session } of landed) {
		const cost = sources.costOf(session);
		if (cost === null) continue;
		priced++;
		if (counted.has(session)) continue;
		counted.add(session);
		usd += cost;
	}
	return { landings: landed.length, priced, usd, perLanding: ratio(usd, priced) };
}

function landPassReport(attempts: LandAttempt[], since: number): WindowReport["landPass"] {
	let runs = 0;
	let firstTry = 0;
	const bySession = Map.groupBy(
		attempts.filter(a => a.kind !== "nothing"),
		a => a.session,
	);
	for (const list of bySession.values()) {
		let fresh = true;
		for (const a of list.toSorted((x, y) => x.at - y.at)) {
			if (fresh && a.at >= since) {
				runs++;
				if (a.kind === "landed") firstTry++;
			}
			fresh = a.kind === "landed";
		}
	}
	return { runs, firstTry, rate: ratio(firstTry, runs) };
}

function escalationReport(trace: TraceLine[], since: number): WindowReport["escalations"] {
	const lines = trace.toSorted((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
	const counts = { total: 0, needed: 0, agentFinished: 0, unresolved: 0 };
	const open = new Set<string>();
	lines.forEach((line, i) => {
		const fix = `${line.repo}#${line.pr}#${line.stage}`;
		if (line.recorded) open.delete(fix);
		// startFix is the only refusal that carries a round: the fix ran out of rounds or stalled.
		if (line.recorded || line.round === undefined || open.has(fix)) return;
		open.add(fix);
		if (Date.parse(line.ts) < since) return;
		const later = lines.slice(i + 1).filter(l => l.repo === line.repo && l.pr === line.pr && l.recorded);
		const resumed = later.some(l => l.stage === line.stage && l.round === 1);
		const merged = later.some(l => l.stage === "merged");
		counts.total++;
		if (!merged) counts.unresolved++;
		else if (resumed) counts.agentFinished++;
		else counts.needed++;
	});
	return { ...counts, accuracy: ratio(counts.needed, counts.needed + counts.agentFinished) };
}

function humanEditReport(repos: Sources["repos"], since: number, withinDays: number): WindowReport["humanEdits"] {
	let total = 0;
	let edited = 0;
	for (const { firstParent, commits } of repos) {
		const human = commits.filter(c => c.sessions.length === 0);
		for (const landing of firstParent) {
			if (landing.sessions.length === 0 || landing.at < since) continue;
			total++;
			const files = new Set(landing.files);
			const until = landing.at + withinDays * DAY;
			if (human.some(c => c.at > landing.at && c.at <= until && c.files.some(f => files.has(f)))) edited++;
		}
	}
	return { landings: total, edited, rate: ratio(edited, total), withinDays };
}

export function report(sources: Sources, now: number, days: number[], humanDays: number): WindowReport[] {
	return days.map(d => {
		const since = now - d * DAY;
		return {
			days: d,
			cost: costReport(sources, since),
			landPass: landPassReport(sources.attempts, since),
			escalations: escalationReport(sources.trace, since),
			humanEdits: humanEditReport(sources.repos, since, humanDays),
		};
	});
}

/** The `land` results in every main session file under `root` written since `since`; subagents cannot land. */
export function readLandAttempts(root: string, since: number): LandAttempt[] {
	if (!existsSync(root)) return [];
	const out: LandAttempt[] = [];
	for (const project of readdirSync(root, { withFileTypes: true })) {
		if (!project.isDirectory()) continue;
		const dir = join(root, project.name);
		for (const name of readdirSync(dir)) {
			const session = /_([0-9a-f-]+)\.jsonl$/.exec(name)?.[1];
			const file = join(dir, name);
			if (!session || statSync(file).mtimeMs < since) continue;
			const text = readFileSync(file, "utf8");
			if (!text.includes('"toolName":"land"')) continue;
			for (const line of text.split("\n")) {
				if (!line.includes('"toolResult"') || !line.includes('"toolName":"land"')) continue;
				const entry = JSON.parse(line) as { timestamp?: string; message?: { toolName?: string; details?: { result?: { kind?: LandKind } } } };
				const kind = entry.message?.details?.result?.kind;
				if (entry.message?.toolName !== "land" || !kind || !entry.timestamp) continue;
				out.push({ at: Date.parse(entry.timestamp), session, kind });
			}
		}
	}
	return out;
}

export function readTrace(file: string): TraceLine[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as TraceLine);
}

function gitLog(repo: string, args: string[]): Commit[] {
	const done = Bun.spawnSync(["git", "-C", repo, "log", ...args, "--name-only", "--format=%x1e%H%x1f%P%x1f%at%x1f%(trailers:key=Omp-Session,valueonly,separator=%x2c)"]);
	if (done.exitCode !== 0) throw new Error(`git log in ${repo}: ${done.stderr.toString().trim()}`);
	return done.stdout
		.toString()
		.split("\x1e")
		.filter(Boolean)
		.map(record => {
			const [head = "", ...files] = record.split("\n");
			const [sha = "", parents = "", at = "0", trailers = ""] = head.split("\x1f");
			return { sha, parents: parents.split(" ").filter(Boolean), at: Number(at) * 1000, sessions: trailers.split(",").filter(Boolean), files: files.filter(Boolean) };
		});
}

/**
 * `branch`'s first-parent commits since `since`, each with its changes against its first parent, and every non-merge commit since then.
 * A commit an agent made without a trailer, as subagents and worktree commits do, takes the sessions of the trailered merge that landed it,
 * so only a commit made on the branch itself or landed by an untrailered merge counts as a person's.
 */
export function readRepo(repo: string, branch: string, since: number): Sources["repos"][number] {
	const after = `--since=@${Math.floor(since / 1000)}`;
	const firstParent = gitLog(repo, [branch, "--first-parent", "--diff-merges=first-parent", after]);
	const all = gitLog(repo, [branch, after]);
	const bySha = new Map(all.map(c => [c.sha, c]));
	const visited = new Set(firstParent.map(c => c.sha));
	for (const landing of firstParent) {
		if (landing.sessions.length === 0) continue;
		const stack = landing.parents.slice(1);
		for (let sha = stack.pop(); sha !== undefined; sha = stack.pop()) {
			const commit = bySha.get(sha);
			if (!commit || visited.has(sha)) continue;
			visited.add(sha);
			if (commit.sessions.length === 0) commit.sessions = landing.sessions;
			stack.push(...commit.parents);
		}
	}
	return { firstParent, commits: all.filter(c => c.parents.length < 2) };
}

const SESSION_ID = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl|\/)/;

/** Each session's spend from omp-stats' database, its subagents' files included, which sit in a directory named like the session's file. */
export function statsCost(dbPath: string): Sources["costOf"] {
	if (!existsSync(dbPath)) return () => null;
	const db = new Database(dbPath, { readonly: true });
	const files = db.query<{ file: string; usd: number }, []>("SELECT session_file AS file, TOTAL(cost_total) AS usd FROM messages GROUP BY session_file").all();
	db.close();
	const bySession = new Map<string, number>();
	for (const { file, usd } of files) {
		const session = SESSION_ID.exec(file)?.[1];
		if (session) bySession.set(session, (bySession.get(session) ?? 0) + usd);
	}
	return session => bySession.get(session) ?? null;
}

const pct = (rate: number | null) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);

export function formatTable(windows: WindowReport[]): string {
	const rows: [string, (w: WindowReport) => string][] = [
		["Landed changes", w => String(w.cost.landings)],
		["Cost per landed change", w => (w.cost.perLanding === null ? "n/a" : `$${w.cost.perLanding.toFixed(2)} (${w.cost.priced} priced)`)],
		["Land first-try pass rate", w => `${pct(w.landPass.rate)} (${w.landPass.firstTry}/${w.landPass.runs})`],
		["Escalation accuracy", w => `${pct(w.escalations.accuracy)} (${w.escalations.needed}/${w.escalations.needed + w.escalations.agentFinished}, ${w.escalations.unresolved} open)`],
		[`Landings a person edited within ${windows[0]?.humanEdits.withinDays ?? 0}d`, w => `${pct(w.humanEdits.rate)} (${w.humanEdits.edited}/${w.humanEdits.landings})`],
	];
	const table = [["Metric", ...windows.map(w => `Last ${w.days} days`)], ...rows.map(([label, cell]) => [label, ...windows.map(cell)])];
	const widths = table[0]!.map((_, i) => Math.max(...table.map(r => r[i]!.length)));
	return table.map(r => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd()).join("\n");
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			json: { type: "boolean", default: false },
			days: { type: "string", default: "7,30" },
			"human-days": { type: "string", default: "7" },
			repo: { type: "string", multiple: true, default: [process.cwd()] },
			branch: { type: "string", default: "main" },
			sessions: { type: "string", default: join(homedir(), ".omp", "agent", "sessions") },
			trace: { type: "string", default: join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "ship-trace.jsonl") },
			stats: { type: "string", default: join(homedir(), ".omp", "stats.db") },
		},
	});
	const days = values.days.split(",").map(Number);
	const now = Date.now();
	const since = now - Math.max(...days) * DAY;
	const sources: Sources = {
		attempts: readLandAttempts(values.sessions, since),
		trace: readTrace(values.trace),
		repos: values.repo.map(repo => readRepo(repo, values.branch, since)),
		costOf: statsCost(values.stats),
	};
	const windows = report(sources, now, days, Number(values["human-days"]));
	console.log(values.json ? JSON.stringify(windows, null, 2) : formatTable(windows));
}
