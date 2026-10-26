/** Atomic task ownership shared by dashboard launches, while the live registry owns release. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRunning, OwnerLock } from "../templates/omp/agent/extensions/github/owner-lock";
import { atomicWriteTextSync } from "./fs";
import { arrayOf, fields, type Guard, isObject, isSafeInteger, isString, nullable, recordOf } from "./json";
import { keepersDir, taskClaimsFile } from "./paths";
import { portFromEnv } from "./server/address";
import type { PullRequest } from "./shared/github";
import { hashForSession, type NewSessionRequest } from "./shared/sessions";

export interface TaskClaim {
	repository: string;
	identity: string;
	instanceId: string;
	sessionId: string | null;
	cwd: string;
	pid: number;
	keeperPidFile: string;
	port: number;
}

/** Live ownership, plus the explicit identity each ended session keeps for its resume, by session id. */
interface ClaimsFile {
	claims: TaskClaim[];
	saved: Record<string, string>;
}

const isPositiveInteger: Guard<number> = (value): value is number => isSafeInteger(value) && value > 0;

const isClaimsFile = fields<ClaimsFile>({
	claims: arrayOf(fields<TaskClaim>({ repository: isString, identity: isString, instanceId: isString, sessionId: nullable(isString), cwd: isString, pid: isPositiveInteger, keeperPidFile: isString, port: isSafeInteger })),
	saved: recordOf(isString),
});

/** The claim identity of Linear issue `id`. */
export const ticketTask = (id: string): string => `ticket:${id.toUpperCase()}`;

/** The claim identity of pull request `pr`; a review draft is a separate task from the implementation. */
export const pullRequestTask = (pr: PullRequest, review = false): string => `${review ? "review:" : ""}pr:${pr.owner.toLowerCase()}/${pr.repo.toLowerCase()}#${pr.number}`;

/**
 * Only explicit launch subjects, a Linear or pull request URL leading the prompt, or a `/ship`, `/ticket`, `/review`, or
 * `/fix-pr` argument count; never a ticket-like word in prose, such as `S3` or `EC2`.
 */
export function taskIdentity(request: NewSessionRequest): string | null {
	if (request.taskId) return `task:${request.taskId}`;
	if (request.subject?.kind === "ticket") return ticketTask(request.subject.id);
	if (request.subject?.kind === "pull-request") return pullRequestTask(request.subject.pr, request.reviewDraft);
	if (request.todoId) return `todo:${request.todoId}`;
	const prompt = request.prompt.trim();
	const command = /^\/(?:ship|ticket|review|fix-pr)\s+(\S+)/i.exec(prompt);
	const argument = command?.[1] ?? prompt.split(/\s/, 1)[0] ?? "";
	const ticket = (command ? /^(?:https:\/\/linear\.app\/[^/]+\/issue\/)?([A-Z][A-Z0-9]*?)-?(\d+)(?:\/\S*)?$/i : /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]*)-(\d+)(?:\/\S*)?$/i).exec(argument);
	if (ticket) return ticketTask(`${ticket[1]}-${ticket[2]}`);
	const pr = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(argument);
	return pr ? pullRequestTask({ owner: pr[1]!, repo: pr[2]!, number: Number(pr[3]) }) : null;
}

export class TaskClaims {
	readonly #file: string;
	readonly #lock: OwnerLock;
	readonly #running: (pid: number) => boolean;

	constructor(path = taskClaimsFile, running = isRunning) {
		this.#file = path;
		this.#lock = new OwnerLock(`${path}.lock`, 0);
		this.#running = running;
	}

	/** Reserves before checkout or spawn. A surviving keeper holds ownership even if its launching server crashed. */
	claim(repository: string, identity: string, instanceId: string, cwd: string): TaskClaim | null {
		let conflict: TaskClaim | null = null;
		this.#change(({ claims, saved }) => {
			const kept: ClaimsFile = { claims: [], saved: { ...saved } };
			for (const claim of claims) {
				if (this.#alive(claim)) kept.claims.push(claim);
				else if (claim.sessionId) kept.saved[claim.sessionId] = claim.identity;
			}
			conflict = kept.claims.find(claim => claim.repository === repository && claim.identity === identity) ?? null;
			if (!conflict) kept.claims.push({ repository, identity, instanceId, sessionId: null, cwd, pid: process.pid, keeperPidFile: join(keepersDir, `${instanceId}.pid`), port: portFromEnv() });
			return kept;
		});
		return conflict;
	}

	/** Once spawned, the session process, not the dashboard process, owns the task across dashboard restarts. */
	bind(instanceId: string, pid: number, sessionId: string, cwd: string): void {
		if (!existsSync(this.#file)) return;
		this.#change(file => {
			if (!file.claims.some(claim => claim.instanceId === instanceId)) return file;
			const { [sessionId]: _, ...saved } = file.saved;
			return { claims: file.claims.map(claim => claim.instanceId === instanceId ? { ...claim, pid, sessionId, cwd } : claim), saved };
		});
	}

	/** Releases a failed launch or an ended session, which keeps its identity for a later resume. */
	release(instanceId: string): void {
		if (!existsSync(this.#file)) return;
		this.#change(file => {
			const released = file.claims.find(claim => claim.instanceId === instanceId);
			if (!released) return file;
			return {
				claims: file.claims.filter(claim => claim !== released),
				saved: released.sessionId ? { ...file.saved, [released.sessionId]: released.identity } : file.saved,
			};
		});
	}

	/** A saved session keeps its explicit independent or review identity when ended and later resumed. */
	identityForSession(sessionId: string): string | null {
		const { claims, saved } = this.#read();
		return claims.find(claim => claim.sessionId === sessionId)?.identity ?? saved[sessionId] ?? null;
	}

	/** A reattached session's subject must not override its explicit independent or review identity. */
	identityForInstance(instanceId: string): string | null {
		return this.#read().claims.find(claim => claim.instanceId === instanceId)?.identity ?? null;
	}

	/** Unlike editable lists, an unreadable claim file is never ignored or replaced: that could admit a second writer. */
	#change(next: (file: ClaimsFile) => ClaimsFile): void {
		this.#lock.wait();
		try {
			const file = this.#read();
			const changed = next(file);
			if (changed !== file) atomicWriteTextSync(this.#file, `${JSON.stringify(changed)}\n`, 0o600);
		} finally {
			this.#lock.release();
		}
	}

	#read(): ClaimsFile {
		let text: string;
		try {
			text = readFileSync(this.#file, "utf8");
		} catch (error) {
			if (!isObject(error) || error.code !== "ENOENT") throw error;
			return { claims: [], saved: {} };
		}
		const file: unknown = JSON.parse(text);
		if (!isClaimsFile(file)) throw new Error(`Cannot read task claims in ${this.#file}.`);
		return file;
	}

	#alive(owner: TaskClaim): boolean {
		if (this.#running(owner.pid)) return true;
		try {
			const pid = Number(readFileSync(owner.keeperPidFile, "utf8").trim());
			return Number.isSafeInteger(pid) && pid > 0 && this.#running(pid);
		} catch {
			return false;
		}
	}
}

export function taskConflict(owner: Pick<TaskClaim, "identity" | "instanceId" | "sessionId" | "cwd" | "port">): string {
	const link = owner.sessionId ? hashForSession(owner.sessionId) : `instance ${owner.instanceId} (starting)`;
	return `${owner.identity} is already claimed by ${link}, dashboard port ${owner.port}, directory ${owner.cwd}. Focus that session or end it before starting the same task again. Use a distinct explicit taskId only for intentional independent work.`;
}
