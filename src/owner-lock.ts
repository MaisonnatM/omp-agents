/**
 * Ownership for the server's unattended work and short shared-file mutations.
 * A hard-linked file publishes its owner's pid and port whole. A dead owner can be replaced.
 * Stale removal holds the same kind of lock at `<file>.reap`, so competing reclaimers cannot unlink a new owner.
 * A process id reused by another program keeps the lock held until that file is deleted.
 */
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorText, isObject } from "./json";

export interface LockHolder {
	pid: number;
	port: number;
}

const pause = new Int32Array(new SharedArrayBuffer(4));

/** Whether process `pid` runs; a process that another user owns runs too. */
export function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

function parseHolder(text: string): LockHolder | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isObject(value) || !Number.isSafeInteger(value.pid) || !Number.isSafeInteger(value.port)) return null;
	return { pid: value.pid as number, port: value.port as number };
}

export class OwnerLock {
	readonly #file: string;
	readonly #self: LockHolder;
	readonly #running: (pid: number) => boolean;
	#held = false;

	constructor(file: string, port: number, running: (pid: number) => boolean = isRunning, pid = process.pid) {
		this.#file = file;
		this.#self = { pid, port };
		this.#running = running;
	}

	/** Whether this server owns the unattended work, as of the last {@link acquire}. */
	get held(): boolean {
		return this.#held;
	}

	/** Who holds the lock now, this server included, or `null` when no one does. */
	holder(): LockHolder | null {
		try {
			return parseHolder(readFileSync(this.#file, "utf8"));
		} catch {
			return null;
		}
	}

	/**
	 * Takes the lock when no live server holds it, and confirms it when this server does: a lock deleted or taken over
	 * behind this server's back is lost. Whether this server holds it now.
	 */
	acquire(): boolean {
		this.#held = this.#take();
		return this.#held;
	}

	/** Waits for a short file mutation to finish, or refuses it rather than writing without ownership. */
	wait(timeoutMs = 5000): void {
		const deadline = Date.now() + timeoutMs;
		while (!this.acquire()) {
			if (Date.now() >= deadline) throw new Error(`Timed out taking the lock ${this.#file}.`);
			Atomics.wait(pause, 0, 0, 10);
		}
	}

	/** Gives the lock up on shutdown, unless another server took it over. */
	release(): void {
		if (this.#held && this.#isMine(this.holder())) rmSync(this.#file, { force: true });
		this.#held = false;
	}

	#isMine(holder: LockHolder | null): boolean {
		return holder?.pid === this.#self.pid && holder.port === this.#self.port;
	}

	#take(): boolean {
		const created = this.#create();
		if (created !== "exists") return created === "made";
		const holder = this.holder();
		if (this.#isMine(holder)) return true;
		if (holder && this.#running(holder.pid)) return false;
		const recovery = new OwnerLock(`${this.#file}.reap`, this.#self.port, this.#running, this.#self.pid);
		if (!recovery.acquire()) return false;
		try {
			let text: string;
			try {
				text = readFileSync(this.#file, "utf8");
			} catch (error) {
				if (isObject(error) && error.code === "ENOENT") return this.#create() === "made";
				throw error;
			}
			const current = parseHolder(text);
			if (this.#isMine(current)) return true;
			if (current && this.#running(current.pid)) return false;
			rmSync(this.#file, { force: true });
			return this.#create() === "made";
		} finally {
			recovery.release();
		}
	}

	/** Creates the lock file whole. A file linked into place is complete when it first shows, and of several servers that start at once exactly one links it. */
	#create(): "made" | "exists" | "failed" {
		const draft = `${this.#file}.${this.#self.pid}.tmp`;
		try {
			mkdirSync(dirname(this.#file), { recursive: true });
			writeFileSync(draft, JSON.stringify(this.#self));
			linkSync(draft, this.#file);
			return "made";
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "EEXIST") return "exists";
			console.error(`omp-agents: cannot take the lock ${this.#file}: ${errorText(err)}`);
			return "failed";
		} finally {
			rmSync(draft, { force: true });
		}
	}
}
