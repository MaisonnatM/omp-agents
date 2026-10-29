/**
 * The pull requests each session submitted or worked on, read from its own tool calls and its subagents'.
 * A submission is a per-branch line `gt submit` prints, the URL a `gh pr create` call prints, or the branch a
 * `gt submit` call submitted, which links even when the call printed nothing (`-q`). Work is a
 * `gh pr checkout|edit|comment|review|merge|ready` call that names a PR, a `git push` that updated a PR's head
 * branch, a PR link in the session's own prompt, an omp `pr://` read of a PR its own prompt names (`#7049`, `PR 7049`)
 * in its repository, or the branch the session works on, when a PR heads it: the one checked out in its linked
 * worktree, or in a main checkout one other than the default branch. A PR a session only read, quoted, listed, or
 * was handed is not linked to it; nor is the main checkout's default branch, which every session started there shares.
 * The branch a `gt submit` line names heads the PR it prints, before the pull request list names it.
 *
 * The same scan collects the Linear issues a session worked on: the ones omp's Linear MCP tools changed or opened
 * (`save_issue`) or commented on (`save_comment`), the issue a /ship run records, and the one a Linear link in the
 * session's own prompt names. Weaker evidence links an issue only once two kinds of it agree: a read (`get_issue`,
 * `list_comments`), its identifier in the session's own prompt, and the session's branch (`eng-123-fix`, `me/eng-123`).
 * An issue a search only listed is not linked. A subagent's prompt is its assignment, so it names nothing.
 *
 * The session's own bash calls tell which linked worktree it works in: a session started in a repository's main
 * checkout often adds a worktree and runs its commands there with bash's `cwd`.
 *
 * The read of a session's own file also feeds the `OwnFileFolds` the index is given, so another feature that folds
 * session files does not read them a second time.
 */
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { branchAt, type CheckoutReads, type HeadHistory, type WorktreeAt } from "./git";
import { parseRemote } from "./github";
import { isObject, oneOf } from "./json";
import { FoldedFile, type LineFold } from "./line-reader";
import { mapLimit, PROBE_PARALLEL } from "./map-limit";
import { expandHome } from "./paths";
import { textOf, toolCallsOf, toolResultOf } from "./session-entries";
import { subagentFiles } from "./subagents";
import { headKey, type LinkedPullRequest, type PullRequest, type PullRequestLink, prKey, pullRequestOfUrl, type Repo, repoKey } from "./shared/github";
import { ReplayFold } from "./replay";
import { taskText } from "./shared/routine-message";
import { SHIP_STAGES, SHIP_WORK, type SessionBranch, type SessionFacts, type ShipProgress } from "./shared/sessions";
import { TICKET_ID } from "./shared/tickets";
import { messageItemsOf } from "./transcript";
import { WorkspacePlacement } from "./workspace-placement";

/** `me/fe-trust-7: https://app.graphite.com/github/pr/acme/webapp/6596 (created)`: the branch, then its PR. */
const GT_SUBMITTED = /^(\S+): https:\/\/app\.graphite\.com\/github\/pr\/([\w.-]+)\/([\w.-]+)\/(\d+)\S* \((?:created|updated)\)[ \t\r]*$/gm;
/** The line `gh pr create` ends with. */
const GH_CREATED = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)[ \t\r]*$/gm;
const GH_PR_CREATE = /\bgh\s+pr\s+create\b/;
/** A `gh pr` call that acts on one PR, with its arguments up to the end of that shell command; not one quoted in another command. */
const GH_PR_ACTION = /(?:^|[;&|(\n])\s*gh\s+pr\s+(?:checkout|co|edit|comment|review|merge|ready)\b([^\n;&|)]*)/g;
const GIT_PUSH = /\bgit\s+(?:-C\s+\S+\s+)?push\b/;
/** A `gt submit` call, or `gt ss`, with its arguments up to the end of that shell command. */
const GT_SUBMIT = /(?:^|[;&|(\n])\s*gt\s+(?:submit|ss)\b([^\n;&|)]*)/g;
/** A `cd` in a shell command, which moves where the commands after it run. */
const CD = /(?:^|[;&|(\n])\s*cd\s+([^\s;&|)]+)/g;
const OWNER_REPO = /^([\w.-]+)\/([\w.-]+)$/;
/** omp's `pr://<n>` or `pr://<owner>/<repo>/<n>`, with or without `/diff/…` or `?comments=1` after it. */
const PR_URI = /^pr:\/\/(?:([\w.-]+)\/([\w.-]+)\/)?(\d+)(?:[/?#]|$)/;
/** A pull request's address in a prompt's prose. */
const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
/** A PR number as a prompt writes it, `#7049`, `PR 7049`, or `PR#7049`; not `acme/webapp#7049` or `&#39;`. */
const PR_NUMBER = /\bPR[ \t]*#?[ \t]*(\d+)\b|(?<![\w&/])#(\d+)\b/gi;
/** A Linear issue's address, `https://linear.app/acme/issue/ENG-123/its-title`. */
const LINEAR_URL = /https:\/\/linear\.app\/[\w.-]+\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)/gi;
/** A Linear issue identifier in a prompt's prose. */
const TICKET_TOKEN = /\b[A-Z][A-Z0-9_]*-\d+\b/g;
/** A branch name's `/`-separated segment that starts with a Linear issue identifier, `eng-123` or `eng-123-fix`. */
const BRANCH_TICKET = /^([A-Za-z][A-Za-z0-9_]*-\d+)(?=-|$)/;
/** `To github.com:acme/webapp.git`: git names the remote before the refs a push updated. */
const PUSH_REMOTE = /^To (\S+)\s*$/;
/** `   1a2b..3c4d  HEAD -> me/b`, ` * [new branch]  me/b -> me/b`, or ` + 1a2b...3c4d … (forced update)`; rejected and deleted refs do not match. */
const PUSHED_REF = /^\s*[+*]?\s*(?:\[new branch\]|[0-9a-f]{4,}\.\.\.?[0-9a-f]{4,})\s+\S+\s+->\s+(\S+)/;
/** Lines that can matter hold one of these; skipping the rest before `JSON.parse` is most of the startup scan. */
const MARKERS = ["github", "gh pr", "push", "gt submit", "gt ss", "pr://", "omp-ship.state", "omp-agents.headless", "mcp__linear_", '"cwd"'];
/** A Linear MCP tool called directly (`mcp__linear_get_issue`, or `xd_mcp__linear_get_issue`), or written to as an omp device. */
const LINEAR_TOOL = /^(?:xd_)?mcp__linear_(\w+)$/;
const LINEAR_DEVICE = /^xd:\/\/mcp__linear_(\w+)$/;
/** The Linear tools that act on one issue, the argument that names it, and whether the call reads the issue or works on it. */
const LINEAR_ISSUE_ARG = new Map<string, [arg: string, evidence: TicketEvidence]>([
	["get_issue", ["id", "read"]],
	["save_issue", ["id", "worked"]],
	["list_comments", ["issueId", "read"]],
	["save_comment", ["issueId", "worked"]],
]);
const isShipStage = oneOf(SHIP_STAGES);
const isShipWork = oneOf(SHIP_WORK);

/**
 * One pull request a transcript links to. `number` is a PR in the session's own repository, the one `origin`
 * names in its working directory. `branch` is a branch a push updated or a submit submitted; it links to the PR whose head it is.
 * `named` marks a PR the session's own prompt links or names, as opposed to one a call worked on.
 */
export type PullRequestRef =
	| ({ kind: "pr"; link: PullRequestLink; named?: true } & PullRequest)
	| { kind: "number"; number: number; named?: true }
	| ({ kind: "branch"; branch: string; link: PullRequestLink } & Repo);

/**
 * A `gt submit` call: the branch it names with `--branch`, else the one checked out at `at`, in ms, in the directory
 * `dirs` lead to from the session's, each relative to the one before. The index resolves it into a `branch` ref.
 */
interface SubmitRef {
	kind: "submit";
	dirs: string[];
	branch: string | null;
	at: number;
}

/** An omp `pr://` read of a PR in `repository`, or in the session's own when it names none; it links only a PR the session's own prompt names. */
interface ReadRef {
	kind: "read";
	repository: Repo | null;
	number: number;
}

type FoundRef = PullRequestRef | SubmitRef | ReadRef;

/**
 * What names a Linear issue in a transcript: work on it, a `save_issue`, a `save_comment`, a /ship run's issue, or a Linear link
 * in the session's own prompt; a read of it; or its identifier in the session's own prompt.
 */
export type TicketEvidence = "worked" | "read" | "named";

/** What a bash call's output can prove: the URL `gh pr create` prints, the branches `git push` updated, and a `gt submit` that finished. */
interface Expected {
	created: boolean;
	pushed: boolean;
	submitted: boolean;
}

function refKey(ref: FoundRef): string {
	if (ref.kind === "pr") return prKey(ref);
	if (ref.kind === "submit") return `submit:${ref.at}:${ref.dirs.join("\0")}:${ref.branch ?? ""}`;
	if (ref.kind === "read") return `read:${ref.repository ? repoKey(ref.repository) : ""}#${ref.number}`;
	return ref.kind === "number" ? `#${ref.number}` : headKey(ref, ref.branch);
}

const unquoted = (token: string): string => token.replace(/^["']|["']$/g, "");

/** The `gt submit` calls in a bash `command` run in `cwd` at `at`, other than a `--dry-run`. */
function* submits(command: string, cwd: string | null, at: number): Generator<SubmitRef> {
	for (const match of command.matchAll(GT_SUBMIT)) {
		const tokens = match[1]!.trim().split(/\s+/).map(unquoted);
		if (tokens.includes("--dry-run")) continue;
		const option = (name: string): string | null => {
			const i = tokens.indexOf(name);
			if (i >= 0) return tokens[i + 1] ?? null;
			return tokens.find(token => token.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
		};
		const cd = [...command.slice(0, match.index).matchAll(CD)].at(-1)?.[1];
		const dirs = [cwd, cd === undefined ? null : unquoted(cd), option("--cwd")].filter((dir): dir is string => Boolean(dir));
		yield { kind: "submit", dirs, branch: option("--branch"), at };
	}
}

/** The PR a `gh pr` action names by number or URL, in its `-R`/`--repo` repository or else the session's. */
function actedOn(args: string): PullRequestRef | null {
	const tokens = args.trim().split(/\s+/).map(unquoted);
	let repoText = "";
	let target = "";
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token === "-R" || token === "--repo") repoText = tokens[++i] ?? "";
		else if (token.startsWith("--repo=")) repoText = token.slice("--repo=".length);
		else if (target === "" && !token.startsWith("-")) target = token;
	}
	const url = pullRequestOfUrl(target);
	if (url) return { kind: "pr", link: "worked", ...url };
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
		if (repo && ref) yield { kind: "branch", ...repo, branch: ref[1]!.replace(/^refs\/heads\//, ""), link: "worked" };
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

/** Folds one transcript's lines, in order, into the pull requests and Linear issues it names, each once. */
export class SessionFactsScan {
	/** Bash calls, then their background jobs, whose output has not been read yet, and what it can prove. */
	readonly #pending = new Map<string, Expected>();
	/** `save_issue` calls that open an issue, whose result names it. */
	readonly #opening = new Set<string>();
	/** Whether the transcript's user prompts are the session's own: a subagent's is its assignment, which names what its parent worked on. */
	readonly #prompts: boolean;
	readonly found = new Map<string, FoundRef>();
	/** Linear issue identifiers, `ENG-123`, in the order the transcript first named them, with what named each. */
	readonly tickets = new Map<string, Set<TicketEvidence>>();
	/** The PR numbers the session's own prompts name, `#7049` or `PR 7049`. */
	readonly named = new Set<number>();
	/** The PR each branch heads, by `owner/repo:branch`, as a `gt submit` line printed it since the index last took them. */
	readonly heads = new Map<string, PullRequest>();
	/** How many `gt submit` calls finished: a quiet one prints no PR, yet its branch may head a new one. */
	submitsFinished = 0;
	ship: ShipProgress | null = null;
	/** omp ran the session as `omp -p` or `--mode json`, as the `headless-mark` extension records. */
	headless = false;
	/** The `cwd` arguments of bash calls as written, each once, the most recently used last. */
	readonly workDirs = new Set<string>();
	/** A candidate line could not be parsed, so its working-directory evidence is incomplete. */
	unreadableLines = false;
	readonly replay = new ReplayFold();

	/** `prompts`: whether the transcript is the session's own, whose user prompts name the work the user asked for. */
	constructor(prompts: boolean) {
		this.#prompts = prompts;
	}

	applyLine(line: string): void {
		const backgrounding = this.#pending.size > 0 && line.includes('"jobId"');
		// A call's result can matter even when it printed nothing: a `save_issue` names the issue it opened, and a quiet `gt submit` finished.
		const answering = (this.#pending.size > 0 || this.#opening.size > 0) && line.includes('"toolResult"');
		if (!backgrounding && !answering && !MARKERS.some(marker => line.includes(marker)) && !line.includes("omp-agents-replay") && !line.includes('"role":"user"') && !line.includes("skill-prompt")) return;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			this.unreadableLines = true;
			return;
		}
		if (!isObject(entry)) return;
		this.replay.applyEntry(entry);
		if (entry.type === "custom") {
			if (entry.customType === "omp-agents.headless") this.headless = isObject(entry.data) && entry.data.headless === true;
			else if (entry.customType === "omp-ship.state") {
				const ship = parseShipProgress(entry.data);
				if (ship) {
					this.ship = ship;
					if (ship.issue) this.#ticket(ship.issue, "worked");
				}
			}
			return;
		}
		if (entry.type === "custom_message" && entry.customType === "async-result" && typeof entry.content === "string") {
			// One notice carries the output of every job it delivers; only a bash job's is what `gt`, `gh`, or `git` printed.
			const jobs = isObject(entry.details) && Array.isArray(entry.details.jobs) ? entry.details.jobs : [];
			if (jobs.length === 0 || !jobs.every(job => isObject(job) && job.type === "bash")) return;
			const expected = jobs.map(job => this.#take(String(job.jobId)));
			this.#finished(entry.content, { created: expected.some(e => e?.created), pushed: expected.some(e => e?.pushed), submitted: expected.some(e => e?.submitted) });
			return;
		}
		if (this.#prompts && (entry.type === "message" ? isObject(entry.message) && entry.message.role === "user" : entry.type === "custom_message" && entry.customType === "skill-prompt")) {
			// The user's own words, and what a routine sent with the events that started it, whose links name the work: a skill's expanded instructions, a dashboard prompt, and a collaborator's are left out.
			for (const item of messageItemsOf(entry)) {
				if (item.kind === "user" && item.from === null) this.#prompt(item.text);
				else if (item.kind === "routine") {
					const { triggeredBy, sent } = item.message;
					const output = sent.kind === "command" && "output" in sent.run ? sent.run.output : "";
					this.#prompt([taskText(item.message), ...triggeredBy.flatMap(({ title, detail, url }) => [title, detail, url ?? ""]), output].join("\n"));
				}
			}
			return;
		}
		if (entry.type !== "message" || !isObject(entry.message)) return;
		for (const call of toolCallsOf(entry.message)) {
			const cwd = call.name === "bash" && typeof call.args.cwd === "string" && call.args.cwd ? call.args.cwd : null;
			if (call.name === "bash" && typeof call.args.command === "string") this.#command(call.id, call.args.command, cwd, Date.parse(String(entry.timestamp)));
			if (cwd) {
				this.workDirs.delete(cwd);
				this.workDirs.add(cwd);
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
			// A call omp moved to the background finishes once its job does.
			if (expected && typeof job === "string") {
				this.#pending.set(job, expected);
				this.#output(textOf(result.content), expected);
			} else this.#finished(textOf(result.content), expected);
		} else if (result.toolName === "wait" && Array.isArray(details.jobs)) {
			for (const job of details.jobs) {
				if (!isObject(job) || job.type !== "bash" || typeof job.resultText !== "string") continue;
				this.#finished(job.resultText, this.#take(String(job.id)));
			}
		}
	}

	#take(id: string): Expected | undefined {
		const expected = this.#pending.get(id);
		this.#pending.delete(id);
		return expected;
	}

	/** `cwd`: the bash call's own, raw. `at`: when it ran, `NaN` when the entry has no time, which leaves its `gt submit` out. */
	#command(id: string, command: string, cwd: string | null, at: number): void {
		for (const [, args] of command.matchAll(GH_PR_ACTION)) {
			const ref = actedOn(args!);
			if (ref) this.#add(ref);
		}
		const submitting = [...submits(command, cwd, at)];
		if (!Number.isNaN(at)) for (const ref of submitting) this.#add(ref);
		const expected = { created: GH_PR_CREATE.test(command), pushed: GIT_PUSH.test(command), submitted: submitting.length > 0 };
		if (expected.created || expected.pushed || expected.submitted) this.#pending.set(id, expected);
	}

	#read(path: string): void {
		const match = PR_URI.exec(path);
		if (!match) return;
		const [, owner, repo, number] = match;
		this.#add({ kind: "read", repository: owner && repo ? { owner, repo } : null, number: Number(number) });
	}

	/** The session's own prompt: a PR or Linear issue it links is work on it, and a PR number or issue identifier it writes names one. */
	#prompt(text: string): void {
		for (const [, owner, repo, number] of text.matchAll(PR_URL)) this.#add({ kind: "pr", link: "worked", named: true, owner: owner!, repo: repo!, number: Number(number) });
		for (const [, written, hashed] of text.matchAll(PR_NUMBER)) this.named.add(Number(written ?? hashed));
		for (const [, id] of text.matchAll(LINEAR_URL)) this.#ticket(id!, "worked");
		for (const [id] of text.matchAll(TICKET_TOKEN)) this.#ticket(id, "named");
	}

	#linear(callId: string, tool: string, args: Record<string, unknown>): void {
		const issueArg = LINEAR_ISSUE_ARG.get(tool);
		if (!issueArg) return;
		const [arg, evidence] = issueArg;
		const named = args[arg];
		if (typeof named === "string") this.#ticket(named, evidence);
		else if (tool === "save_issue") this.#opening.add(callId);
	}

	/** `save_issue` answers the issue it opened as JSON, with its identifier as `id`. */
	#opened(text: string): void {
		try {
			const issue: unknown = JSON.parse(text);
			if (isObject(issue) && typeof issue.id === "string") this.#ticket(issue.id, "worked");
		} catch {}
	}

	/** Linear takes `eng-123` too; a UUID is left out, since the page opens an issue by its identifier. */
	#ticket(named: string, evidence: TicketEvidence): void {
		const id = named.toUpperCase();
		if (!TICKET_ID.test(id)) return;
		const known = this.tickets.get(id);
		if (known) known.add(evidence);
		else this.tickets.set(id, new Set([evidence]));
	}

	/** What a bash command that finished printed: a `gt submit` among them counts. */
	#finished(text: string, expected: Expected | undefined): void {
		if (expected?.submitted) this.submitsFinished++;
		this.#output(text, expected);
	}

	/** What a bash command printed, and what its command said the output can prove. */
	#output(text: string, expected: Expected | undefined): void {
		for (const [, branch, owner, repo, number] of text.matchAll(GT_SUBMITTED)) {
			const pr = { owner: owner!, repo: repo!, number: Number(number) };
			this.#add({ kind: "pr", link: "submitted", ...pr });
			this.heads.set(headKey(pr, branch!), pr);
		}
		if (expected?.created) for (const [, owner, repo, number] of text.matchAll(GH_CREATED)) this.#add({ kind: "pr", link: "submitted", owner: owner!, repo: repo!, number: Number(number) });
		if (expected?.pushed) for (const ref of pushedBranches(text)) this.#add(ref);
	}

	/** A submission outranks work on the same PR, and work outranks the prompt naming it; either keeps the place the first had. */
	#add(ref: FoundRef): void {
		const key = refKey(ref);
		const known = this.found.get(key);
		if (!known || (ref.kind === "pr" && known.kind === "pr" && ((ref.link === "submitted" && known.link === "worked") || (known.named && !ref.named)))) this.found.set(key, ref);
	}
}

/**
 * The pull requests `refs` name, each once; a submission outranks work on the same PR. Those a call worked on come
 * before those the session's prompt only names, each in the order found, so the session details sidebar first shows
 * a PR the session opened over one its prompt links. A bare number needs the session's `repo`, and a branch needs
 * `heads`, the listed PRs by `owner/repo:branch`.
 */
export function resolveLinks(refs: Iterable<PullRequestRef>, repo: Repo | null, heads: ReadonlyMap<string, PullRequest>): LinkedPullRequest[] {
	const linked = new Map<string, LinkedPullRequest>();
	const worked = new Set<string>();
	for (const ref of refs) {
		let pr: LinkedPullRequest | null = null;
		if (ref.kind === "pr") pr = { owner: ref.owner, repo: ref.repo, number: ref.number, link: ref.link };
		else if (ref.kind === "number") pr = repo && { ...repo, number: ref.number, link: "worked" };
		else {
			const head = heads.get(headKey(ref, ref.branch));
			pr = head ? { owner: head.owner, repo: head.repo, number: head.number, link: ref.link } : null;
		}
		if (!pr) continue;
		const key = prKey(pr);
		if (ref.kind === "branch" || !ref.named) worked.add(key);
		const known = linked.get(key);
		if (!known) linked.set(key, pr);
		else if (pr.link === "submitted") known.link = "submitted";
	}
	const all = [...linked];
	return [...all.filter(([key]) => worked.has(key)), ...all.filter(([key]) => !worked.has(key))].map(([, pr]) => pr);
}

/**
 * Folds of each session's own file, not its subagents', that the index feeds from its own read of that file.
 * The index starts a fresh one whenever it reads the file from its first line again.
 */
export interface OwnFileFolds {
	/** An empty fold of session file `path`, in place of the one before. */
	start(path: string): LineFold;
	/** Session file `path` left the list. */
	forget(path: string): void;
}

/** A transcript's facts, and for a session's own file the other folds of it. `own`: whether it is the session's own file, not a subagent's. */
class TranscriptFold implements LineFold {
	readonly scan: SessionFactsScan;
	readonly #others: readonly LineFold[];

	constructor(own: boolean, others: readonly LineFold[]) {
		this.scan = new SessionFactsScan(own);
		this.#others = others;
	}

	applyLine(line: string): void {
		this.scan.applyLine(line);
		for (const fold of this.#others) fold.applyLine(line);
	}
}

interface SessionScan {
	modifiedAt: number;
	cwd: string;
	/** The session file first, then its subagents' files. */
	transcripts: Map<string, FoldedFile<TranscriptFold>>;
	/** Every transcript's refs, in transcript order. */
	refs: FoundRef[];
	/** The branch each of `refs`' `gt submit` calls submitted, by its `refKey`, once found. */
	submitted: Map<string, PullRequestRef>;
	/** The repository `origin` names in `cwd`, looked up once a bare PR number or `branch` needs it; `null` until found. */
	repo: Repo | null;
	/** The PR numbers the session's own prompts name, which link a `pr://` read of one. */
	named: ReadonlySet<number>;
	pullRequests: LinkedPullRequest[];
	/** Every transcript's Linear issues, each once, the session's own first, with what named each. */
	evidence: Map<string, Set<TicketEvidence>>;
	/** The Linear issues of `evidence` that link to the session, with its branch's. */
	tickets: string[];
	/** How many `gt submit` calls its transcripts finished. */
	submitsFinished: number;
	/** The `cwd` arguments of the session's own bash calls, absolute, the most recently used first. */
	workDirs: string[];
	/** The linked worktree it works in, when that is not the checkout `cwd` is in. */
	worktree: string | null;
	/** The branch it works on in `worktree`, else in `cwd`, as `SessionFacts.branch` describes it; only `#resolve` writes it, whole, from git's answer, the default branch, and the pull request it heads. */
	branch: SessionBranch | null;
}

/** What git says of the branch a session works on. */
type GitBranch = Pick<SessionBranch, "name" | "linked">;

/** The Linear issues a branch name names: each `/`-separated segment that starts with one, as `me/eng-123` or `eng-123-fix`. */
const branchTickets = (branch: string): string[] => branch.split("/").flatMap(segment => BRANCH_TICKET.exec(segment)?.[1]?.toUpperCase() ?? []);

/** An issue links on work alone, or once two kinds of weaker evidence agree: a read, the session's own prompt, and its branch. */
const linksTicket = (evidence: ReadonlySet<TicketEvidence>, onBranch: boolean): boolean => evidence.has("worked") || evidence.size + Number(onBranch) >= 2;

/** The directory whose checkout a session works on: its linked worktree, else `cwd`. */
const workDirOf = (session: SessionScan): string => session.worktree ?? session.cwd;

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/** `dir` as omp resolves a bash `cwd`: from the home directory after `~`, else from `base`. */
const absolute = (base: string, dir: string): string => resolve(base, expandHome(dir));

/** `ask`, asking about each directory once. */
function once<T>(ask: (dir: string) => Promise<T>): (dir: string) => Promise<T> {
	const asked = new Map<string, Promise<T>>();
	return dir => {
		let answer = asked.get(dir);
		if (!answer) asked.set(dir, (answer = ask(dir)));
		return answer;
	};
}

/**
 * What git says of the branch a session that last wrote at `at`, in ms, works on in `dir`: in a linked worktree the one
 * checked out now, in a main checkout the one checked out at `at`; `null` on a detached HEAD, outside git, or once `dir` is gone.
 */
async function gitBranch(
	dir: string,
	at: number,
	worktreeAt: (dir: string) => Promise<WorktreeAt | null>,
	historyOf: (dir: string) => Promise<HeadHistory | null>,
): Promise<GitBranch | null> {
	if (!(await exists(dir))) return null;
	const checkout = await worktreeAt(dir);
	if (!checkout) return null;
	if (checkout.linked) return checkout.branch === null ? null : { name: checkout.branch, linked: true };
	const history = await historyOf(dir);
	const name = history && branchAt(history, at);
	return name ? { name, linked: false } : null;
}

/**
 * The branch whose PR a session on `branch` links: a linked worktree's, or a main checkout's other than its default
 * branch `defaultBranch`, which every session there shares; `null` for none, and while git names no default.
 */
function linkingBranch(branch: GitBranch | null, defaultBranch: string | null): string | null {
	return branch && (branch.linked || (defaultBranch !== null && branch.name !== defaultBranch)) ? branch.name : null;
}

/** The branch a `gt submit` from session directory `cwd` submitted, in the repository `origin` names where it ran; `null` once that directory is gone. */
async function submittedBranch(
	ref: SubmitRef,
	cwd: string,
	repoOf: (dir: string) => Promise<Repo | null>,
	historyOf: (dir: string) => Promise<HeadHistory | null>,
): Promise<PullRequestRef | null> {
	const dir = ref.dirs.reduce(absolute, cwd);
	if (!(await exists(dir))) return null;
	const [repo, branch] = await Promise.all([repoOf(dir), ref.branch ?? historyOf(dir).then(history => history && branchAt(history, ref.at))]);
	return repo && branch ? { kind: "branch", ...repo, branch, link: "submitted" } : null;
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
		if (!(await exists(dir))) return null;
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

/** Sessions a refresh reads at once, and `git` calls it runs at once. */
const SCAN_PARALLEL = PROBE_PARALLEL;
/** How long GitHub waits to be asked again which PR a branch heads while the list names none for it. */
const ASK_AGAIN_MS = 60_000;

/** The facts of a session before its first scan: one value, so that a caller can tell by identity that they did not change. */
const NO_FACTS: SessionFacts = { pullRequests: [], tickets: [], ship: null, worktree: null, branch: null, workspace: null };

export class SessionFactsIndex {
	readonly #sessions = new Map<string, SessionScan>();
	/** The PRs the pull request list holds, by `owner/repo:branch` of their head. */
	readonly #heads = new Map<string, PullRequest>();
	/**
	 * What GitHub answered, or a `gt submit` printed, for a branch the list did not name yet, by the same key: search indexes a new PR
	 * some seconds late, and the list may not load at all once GitHub's GraphQL budget runs out, so it outlives list reads until one names the branch.
	 * It is provisional: GitHub is asked again about its branch, and its answer replaces it, or removes it when the branch heads no open or merged PR.
	 */
	readonly #answered = new Map<string, PullRequest>();
	/** When GitHub was last asked which PR a branch heads, in ms, by the same key. */
	readonly #asked = new Map<string, number>();
	/** Each directory's default branch as `origin/HEAD` last named it, read again whenever a session working there writes; `null` while git names none. */
	readonly #defaultBranches = new Map<string, string | null>();
	/** Which workspace each session directory counts in, which the server also asks about a live session's directory before its file names it. */
	readonly placement = new WorkspacePlacement();
	readonly #repoOf: (cwd: string) => Promise<Repo | null>;
	readonly #git: CheckoutReads;
	readonly #ownFileFolds: readonly OwnFileFolds[];
	readonly #branchPullRequest: (repo: Repo, branch: string) => Promise<PullRequest | null>;
	#chain: Promise<unknown> = Promise.resolve();
	/** The refresh queued behind the running one, which a later call hands its newer list to instead of queueing another. */
	#queued: { sessions: readonly ListedSession[]; run: Promise<boolean> } | null = null;

	/**
	 * `repoOf`: the GitHub repository `origin` names in a working directory. `git`: what git says of the checkout a directory is in.
	 * `ownFileFolds`: other folds of each session's own file, fed from the index's read of it.
	 * `branchPullRequest`: the newest open or merged PR whose head is a branch, as GitHub has it now; none when omitted.
	 */
	constructor(
		repoOf: (cwd: string) => Promise<Repo | null>,
		git: CheckoutReads,
		ownFileFolds: readonly OwnFileFolds[] = [],
		branchPullRequest: (repo: Repo, branch: string) => Promise<PullRequest | null> = async () => null,
	) {
		this.#repoOf = repoOf;
		this.#git = git;
		this.#ownFileFolds = ownFileFolds;
		this.#branchPullRequest = branchPullRequest;
	}

	/**
	 * What the session in `sessionPath` and its subagents submitted, worked on, and linked, or none before its first scan or without a file.
	 * The /ship stage, the worktree, and the branch are the session's own transcript's, not its subagents', which run in worktrees of their own.
	 * `workspace` is the one `cwd` counts in: the directory a live session runs in now, which omp writes to its file only with the first
	 * reply, and after a `/move` only with the next; the file's directory when omitted.
	 * Each field keeps its identity until a refresh changes it, so a caller can compare them with `===`.
	 */
	factsOf(sessionPath: string | null, cwd?: string): SessionFacts {
		const session = sessionPath === null ? undefined : this.#sessions.get(sessionPath);
		const dir = cwd ?? session?.cwd;
		const workspace = dir === undefined ? null : this.placement.at(dir);
		if (!session || sessionPath === null) return workspace ? { ...NO_FACTS, workspace } : NO_FACTS;
		const own = this.#own(sessionPath);
		const replay = own?.replay.facts();
		return {
			pullRequests: session.pullRequests, tickets: session.tickets, ship: own?.ship ?? null, worktree: session.worktree, branch: session.branch,
			workspace, ...(replay ? { replay } : {}),
		};
	}

	/** Whether omp last started session `sessionPath` as `omp -p` or `--mode json`; `false` before its first scan. */
	headless(sessionPath: string): boolean {
		return this.#own(sessionPath)?.headless ?? false;
	}

	/** The scan of session `path`'s own file, not its subagents'; `undefined` before its first scan. */
	#own(path: string): SessionFactsScan | undefined {
		return this.#sessions.get(path)?.transcripts.get(path)?.fold.scan;
	}

	/** Resolves once the refreshes asked for so far are done. */
	settled(): Promise<void> {
		return this.#chain.then(() => {});
	}

	/**
	 * Read what the listed session files gained since the last refresh and forget unlisted ones.
	 * Resolves whether any session's pull requests, Linear issues, /ship stage, headless mark, worktree, branch, or workspace changed.
	 * Refreshes run one at a time, and the calls made while one runs share a single next refresh of the newest list.
	 */
	refresh(sessions: readonly ListedSession[]): Promise<boolean> {
		if (this.#queued) {
			this.#queued.sessions = sessions;
			return this.#queued.run;
		}
		const queued: { sessions: readonly ListedSession[]; run: Promise<boolean> } = { sessions, run: Promise.resolve(false) };
		queued.run = this.#chain.then(() => {
			this.#queued = null;
			return this.#refresh(queued.sessions);
		});
		this.#queued = queued;
		this.#chain = queued.run.catch(() => {});
		return queued.run;
	}

	/** Which branch heads which PR in `repo`, from the pull request list's PRs of it. Returns whether any session's pull requests, or the PR its branch heads, changed. */
	learnHeads(repo: Repo, pullRequests: readonly (PullRequest & { head: string })[]): boolean {
		const prefix = headKey(repo, "");
		for (const key of this.#heads.keys()) if (key.startsWith(prefix)) this.#heads.delete(key);
		// The pull request list puts open PRs before merged ones, so a reused branch name links to the open PR.
		for (const pr of pullRequests) {
			const key = headKey(pr, pr.head);
			if (!this.#heads.has(key)) this.#heads.set(key, { owner: pr.owner, repo: pr.repo, number: pr.number });
		}
		for (const [key, pr] of this.#answered) {
			if (!key.startsWith(prefix)) continue;
			if (this.#heads.has(key)) this.#answered.delete(key);
			else this.#heads.set(key, pr);
		}
		let changed = false;
		for (const session of this.#sessions.values()) if (this.#resolve(session)) changed = true;
		return changed;
	}

	/**
	 * Recompute a session's pull requests, from its transcripts' refs and then its branch, its Linear issues, and its `branch` whole
	 * from `git`, what git last said of it, with its default branch and the PR it heads; returns whether any changed.
	 */
	#resolve(session: SessionScan, git: GitBranch | null = session.branch): boolean {
		const { repo } = session;
		const defaultBranch = this.#defaultBranches.get(workDirOf(session)) ?? null;
		const linking = repo ? linkingBranch(git, defaultBranch) : null;
		const headed = repo && linking ? (this.#heads.get(headKey(repo, linking)) ?? null) : null;
		const branch: SessionBranch | null = git && { name: git.name, linked: git.linked, defaultBranch, pullRequest: headed };
		const branchChanged = JSON.stringify(branch) !== JSON.stringify(session.branch);
		if (branchChanged) session.branch = branch;
		const onBranch = new Set(git ? branchTickets(git.name) : []);
		const tickets = [...session.evidence].flatMap(([id, evidence]) => (linksTicket(evidence, onBranch.has(id)) ? [id] : []));
		const ticketsChanged = tickets.length !== session.tickets.length || tickets.some((id, i) => id !== session.tickets[i]);
		if (ticketsChanged) session.tickets = tickets;
		const refs = session.refs.flatMap((ref): PullRequestRef[] => {
			if (ref.kind === "submit") {
				const submitted = session.submitted.get(refKey(ref));
				return submitted ? [submitted] : [];
			}
			if (ref.kind !== "read") return [ref];
			if (!session.named.has(ref.number)) return [];
			if (!ref.repository) return [{ kind: "number", number: ref.number, named: true }];
			return repo && repoKey(ref.repository) === repoKey(repo) ? [{ kind: "pr", link: "worked", named: true, ...ref.repository, number: ref.number }] : [];
		});
		const pullRequests = resolveLinks(repo && linking ? [...refs, { kind: "branch", ...repo, branch: linking, link: "worked" }] : refs, repo, this.#heads);
		const before = session.pullRequests;
		const same = pullRequests.length === before.length && pullRequests.every((pr, i) => prKey(pr) === prKey(before[i]!) && pr.link === before[i]!.link);
		if (!same) session.pullRequests = pullRequests;
		return branchChanged || ticketsChanged || !same;
	}

	/** Collect every transcript's refs, Linear issues, and finished `gt submit` calls into the session; returns whether one of those finished since. */
	#gather(session: SessionScan, own: SessionFactsScan): boolean {
		const scans = [...session.transcripts.values()].map(transcript => transcript.fold.scan);
		session.refs = scans.flatMap(scan => [...scan.found.values()]);
		session.named = own.named;
		session.evidence = new Map();
		for (const scan of scans) {
			for (const [id, evidence] of scan.tickets) {
				const known = session.evidence.get(id);
				if (known) for (const kind of evidence) known.add(kind);
				else session.evidence.set(id, new Set(evidence));
			}
		}
		const finished = scans.reduce((sum, scan) => sum + scan.submitsFinished, 0);
		const submitted = finished > session.submitsFinished;
		session.submitsFinished = finished;
		return submitted;
	}

	async #refresh(sessions: readonly ListedSession[]): Promise<boolean> {
		const listed = new Set(sessions.map(session => session.path));
		for (const path of this.#sessions.keys()) {
			if (listed.has(path)) continue;
			this.#sessions.delete(path);
			for (const folds of this.#ownFileFolds) folds.forget(path);
		}
		// A subagent's writes do not touch the session file, but its result does once it finishes.
		const stale = sessions.filter(({ path, modifiedAt }) => this.#sessions.get(path)?.modifiedAt !== modifiedAt);
		// The first refresh reads every transcript; a few sessions at a time keep the disk busy without opening every file at once.
		const scans = await mapLimit(stale, SCAN_PARALLEL, listed => this.#scan(listed));
		let changed = scans.some(scan => scan.changed);
		const touched = scans.map(scan => scan.session);
		/** Sessions whose bash calls named a new `cwd`, or whose worktree is gone: the others keep theirs without asking git. */
		const moved = scans.filter(scan => scan.moved).map(scan => scan.session);
		// Sessions share directories, so each is asked about once per refresh, and a few `git` calls run at a time.
		const worktreeAt = once(dir => this.#git.worktreeAt(dir));
		const repoOf = once(this.#repoOf);
		const historyOf = once(dir => this.#git.headHistory(dir));
		const worktrees = await mapLimit(moved, SCAN_PARALLEL, session => workingWorktree(session.cwd, session.workDirs, worktreeAt));
		moved.forEach((session, i) => {
			if (worktrees[i] === session.worktree) return;
			session.worktree = worktrees[i]!;
			changed = true;
		});
		// A session that wrote to its transcript may have switched branch since: `git` reads its directory's HEAD again, and a main checkout's HEAD reflog, once a checkout changed either.
		// The answers stay here until `#resolve` publishes each branch whole, since a roster push can read `branch` during the awaits below.
		const [placed, reads] = await Promise.all([
			this.placement.place(touched.map(session => session.cwd), worktreeAt),
			mapLimit(scans, SCAN_PARALLEL, ({ session, writtenAt }) => gitBranch(workDirOf(session), writtenAt, worktreeAt, historyOf)),
		]);
		if (placed) changed = true;
		const branches = new Map(scans.map(({ session }, i) => [session, reads[i]!]));
		const gitOf = (session: SessionScan): GitBranch | null => (branches.has(session) ? branches.get(session)! : session.branch);
		// `origin/HEAD` may have moved too, which `git` reads again for each writing session's directory with a branch once it changed.
		const dirs = [...new Set(touched.flatMap(session => (gitOf(session) ? [workDirOf(session)] : [])))];
		const defaults = await mapLimit(dirs, SCAN_PARALLEL, dir => this.#git.defaultBranchOf(dir));
		const redirected = new Set<string>();
		dirs.forEach((dir, i) => {
			if ((this.#defaultBranches.get(dir) ?? null) === defaults[i]) return;
			this.#defaultBranches.set(dir, defaults[i]!);
			redirected.add(dir);
		});
		// Every session working in a directory whose default branch moved resolves again, not only the ones that wrote.
		const resolving = new Set(touched);
		if (redirected.size > 0) for (const session of this.#sessions.values()) if (redirected.has(workDirOf(session))) resolving.add(session);
		// One `git` call per directory, and only for sessions that name a PR by number alone, read one their prompt names, or work on a branch that links the PR it heads.
		const unknownRepo = [...resolving].filter(
			session =>
				session.repo === null &&
				(linkingBranch(gitOf(session), this.#defaultBranches.get(workDirOf(session)) ?? null) !== null ||
					session.refs.some(ref => ref.kind === "number" || (ref.kind === "read" && session.named.has(ref.number)))),
		);
		await mapLimit(unknownRepo, SCAN_PARALLEL, async session => {
			session.repo = await repoOf(session.cwd);
		});
		// A submit's branch stays what it was at its time, so each is looked up once: one `git` call for its repository and two for its HEAD reflog per directory.
		const submits = touched.flatMap(session => session.refs.flatMap(ref => (ref.kind === "submit" && !session.submitted.has(refKey(ref)) ? [{ session, ref }] : [])));
		await mapLimit(submits, SCAN_PARALLEL, async ({ session, ref }) => {
			const submitted = await submittedBranch(ref, session.cwd, repoOf, historyOf);
			if (submitted) session.submitted.set(refKey(ref), submitted);
		});
		// The branch a `gt submit` line named heads the PR it printed until the list or GitHub names another; each line counts once, so a later answer stays.
		let printed = false;
		for (const session of touched) {
			for (const transcript of session.transcripts.values()) {
				const { heads } = transcript.fold.scan;
				for (const [key, pr] of heads) {
					if (this.#heads.has(key) && !this.#answered.has(key)) continue;
					this.#heads.set(key, pr);
					this.#answered.set(key, pr);
					printed = true;
				}
				heads.clear();
			}
		}
		const before = new Map([...resolving].map(session => [session, session.pullRequests]));
		for (const session of resolving) if (this.#resolve(session, gitOf(session))) changed = true;
		// The pull request list names a new PR only at the page's next read, up to a minute later, once GitHub's search has indexed it, and not at all
		// once GitHub's GraphQL budget runs out. A branch the list names no PR for is asked about at once when its session named a new PR or finished a
		// `gt submit`, which may have opened one without printing it, and else at most once a minute, as a printed PR may have closed since; one ask per branch.
		const submitted = new Set(scans.filter(scan => scan.submitted).map(scan => scan.session));
		const now = Date.now();
		const unlisted = new Map<string, { repo: Repo; branch: string }>();
		for (const session of resolving) {
			const linking = linkingBranch(session.branch, this.#defaultBranches.get(workDirOf(session)) ?? null);
			if (!session.repo || !linking) continue;
			const key = headKey(session.repo, linking);
			if (session.branch?.pullRequest !== null && !this.#answered.has(key)) continue;
			const known = new Set(before.get(session)!.map(prKey));
			const named = submitted.has(session) || session.pullRequests.some(pr => !known.has(prKey(pr)));
			if (named || now - (this.#asked.get(key) ?? Number.NEGATIVE_INFINITY) >= ASK_AGAIN_MS) unlisted.set(key, { repo: session.repo, branch: linking });
		}
		for (const key of unlisted.keys()) this.#asked.set(key, now);
		const asks = [...unlisted];
		const answers = await mapLimit(asks, SCAN_PARALLEL, ([, { repo, branch }]) => this.#branchPullRequest(repo, branch).then(pr => ({ pr }), () => null));
		let answered = false;
		asks.forEach(([key], i) => {
			const answer = answers[i];
			// A failed ask keeps what was known, and a list read during the ask wins over its answer.
			if (!answer || (this.#heads.has(key) && !this.#answered.has(key))) return;
			if (answer.pr) {
				this.#heads.set(key, answer.pr);
				this.#answered.set(key, answer.pr);
			} else if (this.#answered.delete(key)) {
				this.#heads.delete(key);
			}
			answered = true;
		});
		if (printed || answered) for (const session of this.#sessions.values()) if (this.#resolve(session)) changed = true;
		return changed;
	}

	/**
	 * Read what session `path` and its subagents appended: whether its /ship stage changed, whether a `gt submit` finished, whether
	 * its worktree needs asking again, and `writtenAt`, its listed last write, in ms.
	 */
	async #scan({ path, cwd, modifiedAt }: ListedSession): Promise<{ session: SessionScan; changed: boolean; submitted: boolean; moved: boolean; writtenAt: number }> {
		let session = this.#sessions.get(path);
		const before = this.#own(path);
		const previousShip = before?.ship ?? null;
		const wasHeadless = before?.headless ?? false;
		session ??= {
			modifiedAt: Number.NaN, cwd, transcripts: new Map([[path, new FoldedFile(path, () => new TranscriptFold(true, this.#ownFileFolds.map(folds => folds.start(path))))]]),
			refs: [], submitted: new Map(), repo: null, named: new Set(), pullRequests: [], evidence: new Map(), tickets: [], submitsFinished: 0, workDirs: [], worktree: null, branch: null,
		};
		this.#sessions.set(path, session);
		for (const file of await subagentFiles(path)) {
			if (!session.transcripts.has(file)) session.transcripts.set(file, new FoldedFile(file, () => new TranscriptFold(false, [])));
		}
		const reads = await Promise.all([...session.transcripts.values()].map(transcript => transcript.read()));
		if (reads.every(read => read.readable)) session.modifiedAt = modifiedAt;
		const own = session.transcripts.get(path)!.fold.scan;
		const shipChanged = JSON.stringify(previousShip) !== JSON.stringify(own.ship ?? null);
		const workDirs = [...own.workDirs].reverse().map(dir => absolute(cwd, dir));
		const dirsBefore = session.workDirs;
		const same = workDirs.length === dirsBefore.length && workDirs.every((dir, i) => dir === dirsBefore[i]);
		const moved = !same || (session.worktree !== null && !(await exists(session.worktree)));
		session.workDirs = workDirs;
		return { session, changed: shipChanged || own.headless !== wasHeadless, submitted: this.#gather(session, own), moved, writtenAt: modifiedAt };
	}
}
