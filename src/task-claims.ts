/** Atomic task ownership shared by dashboard launches, while the live registry owns release. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRunning, OwnerLock } from "../templates/omp/agent/extensions/github/owner-lock";
import { atomicWriteTextSync } from "./fs";
import { isObject } from "./json";
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
	/** Inactive records retain a saved session's explicit identity without retaining ownership. */
	active: boolean;
}

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

function parseOwners(value: unknown): TaskClaim[] | null {
	if (!Array.isArray(value)) return null;
	const owners: TaskClaim[] = [];
	for (const owner of value) {
		if (!isObject(owner) || typeof owner.repository !== "string" || typeof owner.identity !== "string" || typeof owner.instanceId !== "string" || (owner.sessionId !== null && typeof owner.sessionId !== "string") || typeof owner.cwd !== "string" || typeof owner.keeperPidFile !== "string" || typeof owner.pid !== "number" || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.port !== "number" || !Number.isSafeInteger(owner.port) || typeof owner.active !== "boolean") return null;
		owners.push({ repository: owner.repository, identity: owner.identity, instanceId: owner.instanceId, sessionId: owner.sessionId, cwd: owner.cwd, keeperPidFile: owner.keeperPidFile, pid: owner.pid, port: owner.port, active: owner.active });
	}
	return owners;
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
		this.#change(owners => {
			const kept = owners.flatMap(owner => owner.active === false || this.#alive(owner) ? [owner] : owner.sessionId ? [{ ...owner, active: false }] : []);
			conflict = kept.find(owner => owner.active !== false && owner.repository === repository && owner.identity === identity) ?? null;
			return conflict ? kept : [...kept, { repository, identity, instanceId, sessionId: null, cwd, pid: process.pid, keeperPidFile: join(keepersDir, `${instanceId}.pid`), port: portFromEnv(), active: true }];
		});
		return conflict;
	}

	/** Once spawned, the session process, not the dashboard process, owns the task across dashboard restarts. */
	bind(instanceId: string, pid: number, sessionId: string, cwd: string): void {
		if (!existsSync(this.#file)) return;
		this.#change(owners => owners.some(owner => owner.instanceId === instanceId && owner.active)
			? owners.filter(owner => owner.active || owner.sessionId !== sessionId).map(owner => owner.instanceId === instanceId ? { ...owner, pid, sessionId, cwd } : owner)
			: owners);
	}

	release(instanceId: string): void {
		if (!existsSync(this.#file)) return;
		this.#change(owners => owners.some(owner => owner.instanceId === instanceId && owner.active !== false)
			? owners.flatMap(owner => owner.instanceId !== instanceId || owner.active === false ? [owner] : owner.sessionId ? [{ ...owner, active: false }] : [])
			: owners);
	}

	/** A saved session keeps its explicit independent or review identity when ended and later resumed. */
	identityForSession(sessionId: string): string | null {
		return this.#read().findLast(owner => owner.sessionId === sessionId)?.identity ?? null;
	}

	/** A reattached session's subject must not override its explicit independent or review identity. */
	identityForInstance(instanceId: string): string | null {
		return this.#read().findLast(owner => owner.instanceId === instanceId)?.identity ?? null;
	}

	/** Unlike editable lists, an unreadable claim file is never ignored or replaced: that could admit a second writer. */
	#change(next: (owners: TaskClaim[]) => TaskClaim[]): void {
		this.#lock.wait();
		try {
			const owners = this.#read();
			const changed = next(owners);
			if (changed !== owners) atomicWriteTextSync(this.#file, `${JSON.stringify(changed)}\n`, 0o600);
		} finally {
			this.#lock.release();
		}
	}

	#read(): TaskClaim[] {
		let text: string;
		try {
			text = readFileSync(this.#file, "utf8");
		} catch (error) {
			if (!isObject(error) || error.code !== "ENOENT") throw error;
			return [];
		}
		const owners = parseOwners(JSON.parse(text));
		if (!owners) throw new Error(`Cannot read active task owners in ${this.#file}.`);
		return owners;
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
