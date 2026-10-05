/**
 * The pull requests each session submitted or worked on, read from its own tool calls and its subagents'.
 * A submission is a per-branch line `gt submit` prints, or the URL a `gh pr create` call prints. Work is a
 * `gh pr checkout|edit|comment|review|merge|ready` call that names a PR, a `git push` that updated a PR's head
 * branch, or an omp `pr://` read. A PR a session only quoted, listed, or was handed is not linked to it.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseRemote, type Repo } from "./inbox";
import { isObject } from "./json";
import { LineReader } from "./line-reader";
import type { LinkedPullRequest, PullRequest, PullRequestLink, ShipProgress } from "./shared";
import { textOf } from "./transcript";

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
const MARKERS = ["github", "gh pr", "push", "pr://", "omp-ship.state"];
const SHIP_STAGES: Record<ShipProgress["stage"], true> = {
	ticket: true, implement: true, draft_pr: true, thermonuclear: true, ready_gate: true, live: true, merged: true,
};
const SHIP_WORK: Record<NonNullable<ShipProgress["work"]>, true> = { rebase: true, fix_comments: true, fix_ci: true };

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

const prKey = (pr: PullRequest): string => `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
const headKey = (repo: Repo, branch: string): string => `${repo.owner}/${repo.repo}`.toLowerCase() + `:${branch}`;

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

/** Folds one transcript's lines, in order, into the pull requests it links to, each once. */
export class PullRequestScan {
	/** Bash calls, then their background jobs, whose output has not been read yet, and what it can prove. */
	readonly #pending = new Map<string, Expected>();
	readonly found = new Map<string, PullRequestRef>();
	ship: ShipProgress | null = null;

	applyLine(line: string): void {
		const backgrounding = this.#pending.size > 0 && line.includes('"jobId"');
		if (!backgrounding && !MARKERS.some(marker => line.includes(marker))) return;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			return;
		}
		if (!isObject(entry)) return;
		if (entry.type === "custom" && entry.customType === "omp-ship.state" && isObject(entry.data)) {
			const data = entry.data;
			if (typeof data.stage !== "string" || !Object.hasOwn(SHIP_STAGES, data.stage)) return;
			this.ship = {
				stage: data.stage as ShipProgress["stage"],
				...(typeof data.work === "string" && Object.hasOwn(SHIP_WORK, data.work) ? { work: data.work as ShipProgress["work"] } : {}),
				...(typeof data.issue === "string" ? { issue: data.issue } : {}),
				...(typeof data.pr === "number" && Number.isInteger(data.pr) && data.pr > 0 ? { pr: data.pr } : {}),
			};
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
		const message = entry.message;
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (!isObject(block) || block.type !== "toolCall" || typeof block.id !== "string") continue;
				const args = isObject(block.arguments) ? block.arguments : {};
				if (block.name === "bash" && typeof args.command === "string") this.#command(block.id, args.command);
				if (block.name === "read" && typeof args.path === "string") this.#read(args.path);
			}
			return;
		}
		if (message.role !== "toolResult") return;
		const details = isObject(message.details) ? message.details : {};
		if (message.toolName === "bash") {
			const expected = typeof message.toolCallId === "string" ? this.#take(message.toolCallId) : undefined;
			const job = isObject(details.async) ? details.async.jobId : undefined;
			if (expected && typeof job === "string") this.#pending.set(job, expected);
			this.#output(textOf(message.content), expected);
		} else if (message.toolName === "wait" && Array.isArray(details.jobs)) {
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
	scan = new PullRequestScan();
	readonly #lines: LineReader;

	constructor(path: string) {
		this.#lines = new LineReader(path, () => {
			this.scan = new PullRequestScan();
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
}

/** Subagent transcripts sit, at any depth, in the directory named after the session file. */
async function subagentFiles(sessionPath: string): Promise<string[]> {
	const dir = sessionPath.replace(/\.jsonl$/, "");
	const names = await readdir(dir, { recursive: true }).catch(() => []);
	return names
		.filter(name => name.endsWith(".jsonl"))
		.sort()
		.map(name => join(dir, name));
}

export interface ListedSession {
	path: string;
	cwd: string;
	modifiedAt: number;
}

export class PullRequestIndex {
	readonly #sessions = new Map<string, SessionScan>();
	/** The PRs the inbox listed, by `owner/repo:branch` of their head. */
	readonly #heads = new Map<string, PullRequest>();
	readonly #repoOf: (cwd: string) => Promise<Repo | null>;
	#chain: Promise<unknown> = Promise.resolve();

	/** `repoOf`: the GitHub repository `origin` names in a working directory. */
	constructor(repoOf: (cwd: string) => Promise<Repo | null>) {
		this.#repoOf = repoOf;
	}

	/** What the session in `sessionPath` and its subagents submitted or worked on, or none before its first scan. */
	of(sessionPath: string): LinkedPullRequest[] {
		return this.#sessions.get(sessionPath)?.pullRequests ?? [];
	}

	/** The latest /ship stage from the session's own transcript, not its subagents'. */
	shipOf(sessionPath: string): ShipProgress | null {
		return this.#sessions.get(sessionPath)?.transcripts.get(sessionPath)?.scan.ship ?? null;
	}

	/**
	 * Read what the listed session files gained since the last refresh and forget unlisted ones.
	 * Resolves whether any session's pull requests changed. Refreshes run one at a time.
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

	async #refresh(sessions: readonly ListedSession[]): Promise<boolean> {
		const listed = new Set(sessions.map(session => session.path));
		for (const path of this.#sessions.keys()) if (!listed.has(path)) this.#sessions.delete(path);
		let changed = false;
		const touched: SessionScan[] = [];
		for (const { path, cwd, modifiedAt } of sessions) {
			let session = this.#sessions.get(path);
			// A subagent's writes do not touch the session file, but its result does once it finishes.
			if (session?.modifiedAt === modifiedAt) continue;
			const previousShip = session?.transcripts.get(path)?.scan.ship;
			session ??= { modifiedAt: Number.NaN, cwd, transcripts: new Map([[path, new TranscriptScan(path)]]), refs: [], repo: null, pullRequests: [] };
			this.#sessions.set(path, session);
			for (const file of await subagentFiles(path)) {
				if (!session.transcripts.has(file)) session.transcripts.set(file, new TranscriptScan(file));
			}
			let complete = true;
			for (const transcript of session.transcripts.values()) if (!(await transcript.read())) complete = false;
			if (complete) session.modifiedAt = modifiedAt;
			if (JSON.stringify(previousShip ?? null) !== JSON.stringify(session.transcripts.get(path)?.scan.ship ?? null)) changed = true;
			session.refs = [...session.transcripts.values()].flatMap(transcript => [...transcript.scan.found.values()]);
			touched.push(session);
		}
		// One `git` call per directory, all at once, and only for sessions that name a PR by number alone.
		await Promise.all(
			touched
				.filter(session => session.repo === null && session.refs.some(ref => ref.kind === "number"))
				.map(async session => {
					session.repo = await this.#repoOf(session.cwd);
				}),
		);
		for (const session of touched) if (this.#resolve(session)) changed = true;
		return changed;
	}
}
