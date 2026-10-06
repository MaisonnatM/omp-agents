/**
 * The pull requests each session submitted or worked on, read from its own tool calls and its subagents'.
 * A submission is a per-branch line `gt submit` prints, or the URL a `gh pr create` call prints. Work is a
 * `gh pr checkout|edit|comment|review|merge|ready` call that names a PR, a `git push` that updated a PR's head
 * branch, or an omp `pr://` read. A PR a session only quoted, listed, or was handed is not linked to it.
 *
 * The same scan collects the Linear issues a session worked on: the ones omp's Linear MCP tools read
 * (`get_issue`, `list_comments`), changed or opened (`save_issue`), or commented on (`save_comment`), and the
 * issue a /ship run records. An issue a search only listed is not linked.
 *
 * The session's own bash calls tell which linked worktree it works in: a session started in a repository's main
 * checkout often adds a worktree and runs its commands there with bash's `cwd`.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WorktreeAt } from "./git";
import { parseRemote } from "./github";
import { isObject, oneOf } from "./json";
import { LineReader } from "./line-reader";
import { HOME } from "./paths";
import { textOf, toolCallsOf, toolResultOf } from "./session-entries";
import { subagentFiles } from "./subagents";
import { headKey, type LinkedPullRequest, type PullRequest, type PullRequestLink, prKey, type Repo, SHIP_STAGES, SHIP_WORK, type SessionFacts, type ShipProgress, TICKET_ID } from "./shared";

/** `me/fe-trust-7: https://app.graphite.com/github/pr/acme/webapp/6596 (created)` */
const GT_SUBMITTED = /^\S+: https:\/\/app\.graphite\.com\/github\/pr\/([\w.-]+)\/([\w.-]+)\/(\d+)\S* \((?:created|updated)\)[ \t\r]*$/gm;
/** The line `gh pr create` ends with. */
const GH_CREATED = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)[ \t\r]*$/gm;
const GH_PR_CREATE = /\bgh\s+pr\s+create\b/;
/** A `gh pr` call that acts on one PR, with its arguments up to the end of that shell command; not one quoted in another command. */
const GH_PR_ACTION = /(?:^|[;&|(\n])\s*gh\s+pr\s+(?:checkout|co|edit|comment|review|merge|ready)\b([^\n;&|)]*)/g;
const GIT_PUSH = /\bgit\s+(?:-C\s+\S+\s+)?push\b/;
const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/;
const OWNER_REPO = /^([\w.-]+)\/([\w.-]+)$/;
/** omp's `pr://<n>` or `pr://<owner>/<repo>/<n>`, with or without `/diff/…` or `?comments=1` after it. */
const PR_URI = /^pr:\/\/(?:([\w.-]+)\/([\w.-]+)\/)?(\d+)(?:[/?#]|$)/;
/** `To github.com:acme/webapp.git`: git names the remote before the refs a push updated. */
const PUSH_REMOTE = /^To (\S+)\s*$/;
/** `   1a2b..3c4d  HEAD -> me/b`, ` * [new branch]  me/b -> me/b`, or ` + 1a2b...3c4d … (forced update)`; rejected and deleted refs do not match. */
const PUSHED_REF = /^\s*[+*]?\s*(?:\[new branch\]|[0-9a-f]{4,}\.\.\.?[0-9a-f]{4,})\s+\S+\s+->\s+(\S+)/;
/** Lines that can matter hold one of these; skipping the rest before `JSON.parse` is most of the startup scan. */
const MARKERS = ["github", "gh pr", "push", "pr://", "omp-ship.state", "mcp__linear_", '"cwd"'];
/** A Linear MCP tool called directly (`mcp__linear_get_issue`, or `xd_mcp__linear_get_issue`), or written to as an omp device. */
const LINEAR_TOOL = /^(?:xd_)?mcp__linear_(\w+)$/;
const LINEAR_DEVICE = /^xd:\/\/mcp__linear_(\w+)$/;
/** The Linear tools that act on one issue, and the argument that names it. */
const LINEAR_ISSUE_ARG = new Map([
	["get_issue", "id"],
	["save_issue", "id"],
	["list_comments", "issueId"],
	["save_comment", "issueId"],
]);
const isShipStage = oneOf(SHIP_STAGES);
const isShipWork = oneOf(SHIP_WORK);

/**
 * One pull request a transcript links to. `number` is a PR in the session's own repository, the one `origin`
 * names in its working directory. `branch` is a branch a push updated; it links to the PR whose head it is.
 */
export type PullRequestRef =
	| ({ kind: "pr"; link: PullRequestLink } & PullRequest)
	| { kind: "number"; number: number }
	| ({ kind: "branch"; branch: string } & Repo);

/** What a bash call's output can prove: the URL `gh pr create` prints, and the branches `git push` updated. */
interface Expected {
	created: boolean;
	pushed: boolean;
}

function refKey(ref: PullRequestRef): string {
	if (ref.kind === "pr") return prKey(ref);
	return ref.kind === "number" ? `#${ref.number}` : headKey(ref, ref.branch);
}

/** The PR a `gh pr` action names by number or URL, in its `-R`/`--repo` repository or else the session's. */
function actedOn(args: string): PullRequestRef | null {
	const tokens = args.trim().split(/\s+/).map(token => token.replace(/^["']|["']$/g, ""));
	let repoText = "";
	let target = "";
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token === "-R" || token === "--repo") repoText = tokens[++i] ?? "";
		else if (token.startsWith("--repo=")) repoText = token.slice("--repo=".length);
		else if (target === "" && !token.startsWith("-")) target = token;
	}
	const url = PR_URL.exec(target);
	if (url) return { kind: "pr", link: "worked", owner: url[1]!, repo: url[2]!, number: Number(url[3]) };
	// A branch name is left out: it does not say which PR it heads.
	const number = /^#?(\d+)$/.exec(target)?.[1];
	if (!number) return null;
	const repo = OWNER_REPO.exec(repoText);
	return repo ? { kind: "pr", link: "worked", owner: repo[1]!, repo: repo[2]!, number: Number(number) } : { kind: "number", number: Number(number) };
}

/** The branches `git push` output says it updated, with the GitHub repository it pushed to. */
function* pushedBranches(text: string): Generator<PullRequestRef> {
	let repo: Repo | null = null;
	for (const line of text.split("\n")) {
		const remote = PUSH_REMOTE.exec(line);
		if (remote) repo = parseRemote(remote[1]!);
		const ref = repo && PUSHED_REF.exec(line);
		if (repo && ref) yield { kind: "branch", ...repo, branch: ref[1]!.replace(/^refs\/heads\//, "") };
	}
}

/** A Linear MCP call's tool, without the server prefix, and its arguments; `null` for any other call. */
function linearCall(name: string, args: Record<string, unknown>): { tool: string; args: Record<string, unknown> } | null {
	const direct = LINEAR_TOOL.exec(name)?.[1];
	if (direct) return { tool: direct, args };
	const device = name === "write" && typeof args.path === "string" ? LINEAR_DEVICE.exec(args.path)?.[1] : undefined;
	if (!device || typeof args.content !== "string") return null;
	try {
		const content: unknown = JSON.parse(args.content);
		return isObject(content) ? { tool: device, args: content } : null;
	} catch {
		return null;
	}
}

/** A /ship run's progress as its `omp-ship.state` entry records it, or `null` when the entry names no known stage. */
export function parseShipProgress(data: unknown): ShipProgress | null {
	if (!isObject(data)) return null;
	const { stage, work, issue, pr } = data;
	if (!isShipStage(stage)) return null;
	return {
		stage,
		...(isShipWork(work) ? { work } : {}),
		...(typeof issue === "string" ? { issue } : {}),
		...(typeof pr === "number" && Number.isInteger(pr) && pr > 0 ? { pr } : {}),
	};
}

/** Folds one transcript's lines, in order, into the pull requests and Linear issues it links to, each once. */
export class SessionFactsScan {
	/** Bash calls, then their background jobs, whose output has not been read yet, and what it can prove. */
	readonly #pending = new Map<string, Expected>();
	/** `save_issue` calls that open an issue, whose result names it. */
	readonly #opening = new Set<string>();
	readonly found = new Map<string, PullRequestRef>();
	/** Linear issue identifiers, `ENG-123`, in the order the transcript first named them. */
	readonly tickets = new Set<string>();
	ship: ShipProgress | null = null;
	/** The `cwd` arguments of bash calls as written, each once, the most recently used last. */
	readonly workDirs = new Set<string>();

	applyLine(line: string): void {
		const backgrounding = this.#pending.size > 0 && line.includes('"jobId"');
		const opened = this.#opening.size > 0 && line.includes('"toolResult"');
		if (!backgrounding && !opened && !MARKERS.some(marker => line.includes(marker))) return;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			return;
		}
		if (!isObject(entry)) return;
		if (entry.type === "custom" && entry.customType === "omp-ship.state") {
			const ship = parseShipProgress(entry.data);
			if (ship) {
				this.ship = ship;
				if (ship.issue) this.#ticket(ship.issue);
			}
			return;
		}
		if (entry.type === "custom_message" && entry.customType === "async-result" && typeof entry.content === "string") {
			// One notice carries the output of every job it delivers; only a bash job's is what `gt`, `gh`, or `git` printed.
			const jobs = isObject(entry.details) && Array.isArray(entry.details.jobs) ? entry.details.jobs : [];
			if (jobs.length === 0 || !jobs.every(job => isObject(job) && job.type === "bash")) return;
			const expected = jobs.map(job => this.#take(String(job.jobId)));
			this.#output(entry.content, { created: expected.some(e => e?.created), pushed: expected.some(e => e?.pushed) });
			return;
		}
		if (entry.type !== "message" || !isObject(entry.message)) return;
		for (const call of toolCallsOf(entry.message)) {
			if (call.name === "bash" && typeof call.args.command === "string") this.#command(call.id, call.args.command);
			if (call.name === "bash" && typeof call.args.cwd === "string" && call.args.cwd) {
				this.workDirs.delete(call.args.cwd);
				this.workDirs.add(call.args.cwd);
			}
			if (call.name === "read" && typeof call.args.path === "string") this.#read(call.args.path);
			const linear = linearCall(call.name, call.args);
			if (linear) this.#linear(call.id, linear.tool, linear.args);
		}
		this.#toolResult(entry.message);
	}

	/** A tool result: it closes a `save_issue` that opened an issue, and a bash call or `wait` hands over what the command printed. */
	#toolResult(message: Record<string, unknown>): void {
		const result = toolResultOf(message);
		if (!result) return;
		const { callId, details } = result;
		if (callId !== undefined && this.#opening.delete(callId) && !result.isError) this.#opened(textOf(result.content));
		if (result.toolName === "bash") {
			const expected = callId === undefined ? undefined : this.#take(callId);
			const job = isObject(details.async) ? details.async.jobId : undefined;
			if (expected && typeof job === "string") this.#pending.set(job, expected);
			this.#output(textOf(result.content), expected);
		} else if (result.toolName === "wait" && Array.isArray(details.jobs)) {
			for (const job of details.jobs) {
				if (!isObject(job) || job.type !== "bash" || typeof job.resultText !== "string") continue;
				this.#output(job.resultText, this.#take(String(job.id)));
			}
		}
	}

	#take(id: string): Expected | undefined {
		const expected = this.#pending.get(id);
		this.#pending.delete(id);
		return expected;
	}

	#command(id: string, command: string): void {
		for (const [, args] of command.matchAll(GH_PR_ACTION)) {
			const ref = actedOn(args!);
			if (ref) this.#add(ref);
		}
		const expected = { created: GH_PR_CREATE.test(command), pushed: GIT_PUSH.test(command) };
		if (expected.created || expected.pushed) this.#pending.set(id, expected);
	}

	#read(path: string): void {
		const match = PR_URI.exec(path);
		if (!match) return;
		const [, owner, repo, number] = match;
		this.#add(owner && repo ? { kind: "pr", link: "worked", owner, repo, number: Number(number) } : { kind: "number", number: Number(number) });
	}

	#linear(callId: string, tool: string, args: Record<string, unknown>): void {
		const arg = LINEAR_ISSUE_ARG.get(tool);
		if (!arg) return;
		const named = args[arg];
		if (typeof named === "string") this.#ticket(named);
		else if (tool === "save_issue") this.#opening.add(callId);
	}

	/** `save_issue` answers the issue it opened as JSON, with its identifier as `id`. */
	#opened(text: string): void {
		try {
			const issue: unknown = JSON.parse(text);
			if (isObject(issue) && typeof issue.id === "string") this.#ticket(issue.id);
		} catch {}
	}

	/** Linear takes `eng-123` too; a UUID is left out, since the page opens an issue by its identifier. */
	#ticket(named: string): void {
		const id = named.toUpperCase();
		if (TICKET_ID.test(id)) this.tickets.add(id);
	}

	/** What a bash command printed, and what its command said the output can prove. */
	#output(text: string, expected: Expected | undefined): void {
		this.#submitted(text.matchAll(GT_SUBMITTED));
		if (expected?.created) this.#submitted(text.matchAll(GH_CREATED));
		if (expected?.pushed) for (const ref of pushedBranches(text)) this.#add(ref);
	}

	#submitted(matches: Iterable<RegExpMatchArray>): void {
		for (const [, owner, repo, number] of matches) this.#add({ kind: "pr", link: "submitted", owner: owner!, repo: repo!, number: Number(number) });
	}

	/** A submission outranks work on the same PR, and keeps the place the work had. */
	#add(ref: PullRequestRef): void {
		const key = refKey(ref);
		const known = this.found.get(key);
		if (!known || (ref.kind === "pr" && ref.link === "submitted" && known.kind === "pr" && known.link === "worked")) this.found.set(key, ref);
	}
}

/**
 * The pull requests `refs` name, each once, in order; a submission outranks work on the same PR. A bare number
 * needs the session's `repo`, and a pushed branch needs `heads`, the PRs the inbox listed by `owner/repo:branch`.
 */
export function resolveLinks(refs: Iterable<PullRequestRef>, repo: Repo | null, heads: ReadonlyMap<string, PullRequest>): LinkedPullRequest[] {
	const linked = new Map<string, LinkedPullRequest>();
	for (const ref of refs) {
		let pr: LinkedPullRequest | null = null;
		if (ref.kind === "pr") pr = { owner: ref.owner, repo: ref.repo, number: ref.number, link: ref.link };
		else if (ref.kind === "number") pr = repo && { ...repo, number: ref.number, link: "worked" };
		else {
			const head = heads.get(headKey(ref, ref.branch));
			pr = head ? { owner: head.owner, repo: head.repo, number: head.number, link: "worked" } : null;
		}
		if (!pr) continue;
		const key = prKey(pr);
		const known = linked.get(key);
		if (!known) linked.set(key, pr);
		else if (pr.link === "submitted") known.link = "submitted";
	}
	return [...linked.values()];
}

/** One transcript, read up to its last complete line. */
class TranscriptScan {
	scan = new SessionFactsScan();
	readonly #lines: LineReader;

	constructor(path: string) {
		this.#lines = new LineReader(path, () => {
			this.scan = new SessionFactsScan();
		});
	}

	/** Resolves `false` when the file could not be read; it reads again on the next call. */
	read(): Promise<boolean> {
		return this.#lines.read(line => this.scan.applyLine(line));
	}
}

interface SessionScan {
	modifiedAt: number;
	cwd: string;
	/** The session file first, then its subagents' files. */
	transcripts: Map<string, TranscriptScan>;
	/** Every transcript's refs, in transcript order. */
	refs: PullRequestRef[];
	/** The repository `origin` names in `cwd`, looked up once a bare PR number needs it; `null` until found. */
	repo: Repo | null;
	pullRequests: LinkedPullRequest[];
	/** Every transcript's Linear issues, each once, the session's own first. */
	tickets: string[];
	/** The `cwd` arguments of the session's own bash calls, absolute, the most recently used first. */
	workDirs: string[];
	/** The linked worktree it works in, when that is not the checkout `cwd` is in. */
	worktree: string | null;
}

/**
 * The linked worktree of `cwd`'s repository, other than the one `cwd` is in, that the most recent of `workDirs` in
 * one is in. Directories in `cwd`'s own checkout, outside git, or in another repository are passed over; a directory
 * that is gone ends the search with `null`, since it may be a worktree removed since, and an older one is stale.
 */
async function workingWorktree(cwd: string, workDirs: readonly string[], worktreeAt: (dir: string) => Promise<WorktreeAt | null>): Promise<string | null> {
	if (workDirs.length === 0) return null;
	const own = await worktreeAt(cwd);
	if (!own) return null;
	for (const dir of workDirs) {
		if (!existsSync(dir)) return null;
		const at = await worktreeAt(dir);
		if (at && at.top !== own.top && at.common === own.common) return at.top;
	}
	return null;
}

export interface ListedSession {
	path: string;
	cwd: string;
	modifiedAt: number;
}

/** Sessions a refresh reads at once. */
const SCAN_PARALLEL = 16;

export class SessionFactsIndex {
	readonly #sessions = new Map<string, SessionScan>();
	/** The PRs the inbox listed, by `owner/repo:branch` of their head. */
	readonly #heads = new Map<string, PullRequest>();
	readonly #repoOf: (cwd: string) => Promise<Repo | null>;
	readonly #worktreeAt: (dir: string) => Promise<WorktreeAt | null>;
	#chain: Promise<unknown> = Promise.resolve();

	/** `repoOf`: the GitHub repository `origin` names in a working directory. `worktreeAt`: the git worktree a directory is in. */
	constructor(repoOf: (cwd: string) => Promise<Repo | null>, worktreeAt: (dir: string) => Promise<WorktreeAt | null>) {
		this.#repoOf = repoOf;
		this.#worktreeAt = worktreeAt;
	}

	/**
	 * What the session in `sessionPath` and its subagents submitted, worked on, and linked, or none before its first scan.
	 * The /ship stage and the worktree are the session's own transcript's, not its subagents', which run in worktrees of their own.
	 */
	factsOf(sessionPath: string): SessionFacts {
		const session = this.#sessions.get(sessionPath);
		return {
			pullRequests: session?.pullRequests ?? [],
			tickets: session?.tickets ?? [],
			ship: session?.transcripts.get(sessionPath)?.scan.ship ?? null,
			worktree: session?.worktree ?? null,
		};
	}

	/**
	 * Read what the listed session files gained since the last refresh and forget unlisted ones.
	 * Resolves whether any session's pull requests, Linear issues, /ship stage, or worktree changed. Refreshes run one at a time.
	 */
	refresh(sessions: readonly ListedSession[]): Promise<boolean> {
		const run = this.#chain.then(() => this.#refresh(sessions));
		this.#chain = run.catch(() => {});
		return run;
	}

	/** Which branch heads which PR in `repo`, from the inbox's list of its PRs. Returns whether any session's pull requests changed. */
	learnHeads(repo: Repo, pullRequests: readonly (PullRequest & { head: string })[]): boolean {
		const prefix = headKey(repo, "");
		for (const key of this.#heads.keys()) if (key.startsWith(prefix)) this.#heads.delete(key);
		// The inbox lists open PRs before merged ones, so a reused branch name links to the open PR.
		for (const pr of pullRequests) {
			const key = headKey(pr, pr.head);
			if (!this.#heads.has(key)) this.#heads.set(key, { owner: pr.owner, repo: pr.repo, number: pr.number });
		}
		let changed = false;
		for (const session of this.#sessions.values()) {
			if (session.refs.some(ref => ref.kind === "branch") && this.#resolve(session)) changed = true;
		}
		return changed;
	}

	/** Recompute a session's pull requests; returns whether they changed. */
	#resolve(session: SessionScan): boolean {
		const pullRequests = resolveLinks(session.refs, session.repo, this.#heads);
		const before = session.pullRequests;
		const same = pullRequests.length === before.length && pullRequests.every((pr, i) => prKey(pr) === prKey(before[i]!) && pr.link === before[i]!.link);
		if (same) return false;
		session.pullRequests = pullRequests;
		return true;
	}

	/** Collect every transcript's refs and Linear issues into the session; returns whether its Linear issues changed. */
	#gather(session: SessionScan): boolean {
		const transcripts = [...session.transcripts.values()];
		session.refs = transcripts.flatMap(transcript => [...transcript.scan.found.values()]);
		const tickets = [...new Set(transcripts.flatMap(transcript => [...transcript.scan.tickets]))];
		const before = session.tickets;
		if (tickets.length === before.length && tickets.every((id, i) => id === before[i])) return false;
		session.tickets = tickets;
		return true;
	}

	async #refresh(sessions: readonly ListedSession[]): Promise<boolean> {
		const listed = new Set(sessions.map(session => session.path));
		for (const path of this.#sessions.keys()) if (!listed.has(path)) this.#sessions.delete(path);
		// A subagent's writes do not touch the session file, but its result does once it finishes.
		const stale = sessions.filter(({ path, modifiedAt }) => this.#sessions.get(path)?.modifiedAt !== modifiedAt);
		const scans: { session: SessionScan; changed: boolean; moved: boolean }[] = [];
		// The first refresh reads every transcript; a few sessions at a time keep the disk busy without opening every file at once.
		let next = 0;
		const worker = async (): Promise<void> => {
			while (next < stale.length) scans.push(await this.#scan(stale[next++]!));
		};
		await Promise.all(Array.from({ length: Math.min(SCAN_PARALLEL, stale.length) }, worker));
		let changed = scans.some(scan => scan.changed);
		const touched = scans.map(scan => scan.session);
		/** Sessions whose bash calls named a new `cwd`, or whose worktree is gone: the others keep theirs without asking git. */
		const moved = scans.filter(scan => scan.moved).map(scan => scan.session);
		// One `git` call per directory, all at once, and only for sessions that name a PR by number alone.
		await Promise.all(
			touched
				.filter(session => session.repo === null && session.refs.some(ref => ref.kind === "number"))
				.map(async session => {
					session.repo = await this.#repoOf(session.cwd);
				}),
		);
		for (const session of touched) if (this.#resolve(session)) changed = true;
		// Sessions share directories, so each is asked about once per refresh.
		const asked = new Map<string, Promise<WorktreeAt | null>>();
		const worktreeAt = (dir: string): Promise<WorktreeAt | null> => {
			let at = asked.get(dir);
			if (!at) asked.set(dir, (at = this.#worktreeAt(dir)));
			return at;
		};
		const worktrees = await Promise.all(moved.map(session => workingWorktree(session.cwd, session.workDirs, worktreeAt)));
		moved.forEach((session, i) => {
			if (worktrees[i] === session.worktree) return;
			session.worktree = worktrees[i]!;
			changed = true;
		});
		return changed;
	}

	/** Read what session `path` and its subagents appended: whether its /ship stage or Linear issues changed, and whether its worktree needs asking again. */
	async #scan({ path, cwd, modifiedAt }: ListedSession): Promise<{ session: SessionScan; changed: boolean; moved: boolean }> {
		let session = this.#sessions.get(path);
		const previousShip = session?.transcripts.get(path)?.scan.ship;
		session ??= { modifiedAt: Number.NaN, cwd, transcripts: new Map([[path, new TranscriptScan(path)]]), refs: [], repo: null, pullRequests: [], tickets: [], workDirs: [], worktree: null };
		this.#sessions.set(path, session);
		for (const file of await subagentFiles(path)) {
			if (!session.transcripts.has(file)) session.transcripts.set(file, new TranscriptScan(file));
		}
		const reads = await Promise.all([...session.transcripts.values()].map(transcript => transcript.read()));
		if (!reads.includes(false)) session.modifiedAt = modifiedAt;
		const own = session.transcripts.get(path)!.scan;
		const shipChanged = JSON.stringify(previousShip ?? null) !== JSON.stringify(own.ship ?? null);
		// omp resolves a bash `cwd` from the home directory after `~`, else from the session's directory.
		const workDirs = [...own.workDirs].reverse().map(dir => (dir === "~" || dir.startsWith("~/") ? HOME + dir.slice(1) : resolve(cwd, dir)));
		const before = session.workDirs;
		const same = workDirs.length === before.length && workDirs.every((dir, i) => dir === before[i]);
		const moved = !same || (session.worktree !== null && !existsSync(session.worktree));
		session.workDirs = workDirs;
		const ticketsChanged = this.#gather(session);
		return { session, changed: shipChanged || ticketsChanged, moved };
	}
}
