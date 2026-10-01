/**
 * The pull requests each session submitted, read from its transcript and its subagents'.
 * Only submissions count: the per-branch lines `gt submit` prints, and the URL a
 * `gh pr create` call prints. A PR a session only read, quoted, or was handed is not its own.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PullRequest } from "./shared";
import { isObject, textOf } from "./transcript";

const NEWLINE = 0x0a;
const decoder = new TextDecoder();

/** `me/fe-trust-7: https://app.graphite.com/github/pr/acme/webapp/6596 (created)` */
const GT_SUBMITTED = /^\S+: https:\/\/app\.graphite\.com\/github\/pr\/([\w.-]+)\/([\w.-]+)\/(\d+)\S* \((?:created|updated)\)[ \t\r]*$/gm;
/** The line `gh pr create` ends with. */
const GH_CREATED = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)[ \t\r]*$/gm;
const GH_PR_CREATE = /\bgh\s+pr\s+create\b/;

const keyOf = (pr: PullRequest): string => `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();

/** Folds one transcript's lines, in order, into the pull requests it submitted. */
export class SubmissionScan {
	/** `gh pr create` bash calls, then their background jobs, whose output has not been read yet. */
	readonly #creating = new Set<string>();
	readonly found = new Map<string, PullRequest>();

	applyLine(line: string): void {
		// Nearly every line names neither; skipping them before JSON.parse is most of the startup scan.
		const backgrounding = this.#creating.size > 0 && line.includes('"jobId"');
		if (!backgrounding && !line.includes("github") && !line.includes("pr create")) return;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			return;
		}
		if (!isObject(entry)) return;
		if (entry.type === "custom_message" && entry.customType === "async-result" && typeof entry.content === "string") {
			// One notice carries the output of every job it delivers; only a bash job's is what `gt` or `gh` printed.
			const jobs = isObject(entry.details) && Array.isArray(entry.details.jobs) ? entry.details.jobs : [];
			if (jobs.length === 0 || !jobs.every(job => isObject(job) && job.type === "bash")) return;
			const created = jobs.filter(job => this.#creating.delete(String(job.jobId))).length > 0;
			this.#output(entry.content, created);
			return;
		}
		if (entry.type !== "message" || !isObject(entry.message)) return;
		const message = entry.message;
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (!isObject(block) || block.type !== "toolCall" || block.name !== "bash" || typeof block.id !== "string") continue;
				const command = isObject(block.arguments) ? block.arguments.command : undefined;
				if (typeof command === "string" && GH_PR_CREATE.test(command)) this.#creating.add(block.id);
			}
			return;
		}
		if (message.role !== "toolResult") return;
		const details = isObject(message.details) ? message.details : {};
		if (message.toolName === "bash") {
			const created = typeof message.toolCallId === "string" && this.#creating.delete(message.toolCallId);
			const job = isObject(details.async) ? details.async.jobId : undefined;
			if (created && typeof job === "string") this.#creating.add(job);
			this.#output(textOf(message.content), created);
		} else if (message.toolName === "wait" && Array.isArray(details.jobs)) {
			for (const job of details.jobs) {
				if (!isObject(job) || job.type !== "bash" || typeof job.resultText !== "string") continue;
				this.#output(job.resultText, this.#creating.delete(String(job.id)));
			}
		}
	}

	/** What a bash command printed; `created` when the command ran `gh pr create`. */
	#output(text: string, created: boolean): void {
		this.#add(text.matchAll(GT_SUBMITTED));
		if (created) this.#add(text.matchAll(GH_CREATED));
	}

	#add(matches: Iterable<RegExpMatchArray>): void {
		for (const [, owner, repo, number] of matches) {
			const pr = { owner: owner!, repo: repo!, number: Number(number) };
			const key = keyOf(pr);
			if (!this.found.has(key)) this.found.set(key, pr);
		}
	}
}

/** One transcript, read up to its last complete line. */
class TranscriptScan {
	scan = new SubmissionScan();
	#offset = 0;

	constructor(readonly path: string) {}

	/** Resolves `false` when the file could not be read; it reads again on the next call. */
	async read(): Promise<boolean> {
		const file = Bun.file(this.path);
		const size = await file.stat().then(
			stat => stat.size,
			() => 0,
		);
		if (size < this.#offset) {
			this.scan = new SubmissionScan();
			this.#offset = 0;
		}
		if (size === this.#offset) return true;
		const bytes = await file
			.slice(this.#offset, size)
			.bytes()
			.catch(() => null);
		if (!bytes) return false;
		const end = bytes.lastIndexOf(NEWLINE) + 1;
		this.#offset += end;
		for (const line of decoder.decode(bytes.subarray(0, end)).split("\n")) this.scan.applyLine(line);
		return true;
	}
}

interface SessionScan {
	modifiedAt: number;
	/** The session file first, then its subagents' files. */
	transcripts: Map<string, TranscriptScan>;
	pullRequests: PullRequest[];
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

export class PullRequestIndex {
	readonly #sessions = new Map<string, SessionScan>();
	#chain: Promise<unknown> = Promise.resolve();

	/** What the session in `sessionPath` and its subagents submitted, or none before its first scan. */
	of(sessionPath: string): PullRequest[] {
		return this.#sessions.get(sessionPath)?.pullRequests ?? [];
	}

	/**
	 * Read what the listed session files gained since the last refresh and forget unlisted ones.
	 * Resolves whether any session's pull requests changed. Refreshes run one at a time.
	 */
	refresh(sessions: readonly { path: string; modifiedAt: number }[]): Promise<boolean> {
		const run = this.#chain.then(() => this.#refresh(sessions));
		this.#chain = run.catch(() => {});
		return run;
	}

	async #refresh(sessions: readonly { path: string; modifiedAt: number }[]): Promise<boolean> {
		const listed = new Set(sessions.map(session => session.path));
		for (const path of this.#sessions.keys()) if (!listed.has(path)) this.#sessions.delete(path);
		let changed = false;
		for (const { path, modifiedAt } of sessions) {
			let session = this.#sessions.get(path);
			// A subagent's writes do not touch the session file, but its result does once it finishes.
			if (session?.modifiedAt === modifiedAt) continue;
			session ??= { modifiedAt: Number.NaN, transcripts: new Map([[path, new TranscriptScan(path)]]), pullRequests: [] };
			this.#sessions.set(path, session);
			for (const file of await subagentFiles(path)) {
				if (!session.transcripts.has(file)) session.transcripts.set(file, new TranscriptScan(file));
			}
			const merged = new Map<string, PullRequest>();
			let complete = true;
			for (const transcript of session.transcripts.values()) {
				if (!(await transcript.read())) complete = false;
				for (const [key, pr] of transcript.scan.found) if (!merged.has(key)) merged.set(key, pr);
			}
			if (complete) session.modifiedAt = modifiedAt;
			if ([...merged.keys()].join() !== session.pullRequests.map(keyOf).join()) {
				session.pullRequests = [...merged.values()];
				changed = true;
			}
		}
		return changed;
	}
}
