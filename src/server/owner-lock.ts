/**
 * Which server runs the unattended work. Every server of one user shares `~/.config/omp-agents`, and a smoke run on
 * another port runs beside the app's own server, so something has to decide which of them starts routines and applies the
 * todo inbox, or each would do it. The server that holds this lock does; the others wait and try again, and one of them
 * takes over once the owner exits. The lock is a file naming its owner's pid and port.
 * A lock whose process is gone is stale and is taken over. A crash that leaves a pid another process now uses keeps the
 * others waiting until that file is deleted.
 */
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorText, isObject } from "../json";

export interface LockHolder {
	pid: number;
	port: number;
}

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

	/** Gives the lock up on shutdown, unless another server took it over. */
	release(): void {
		if (this.#held && this.#isMine(this.holder())) rmSync(this.#file, { force: true });
		this.#held = false;
	}

	#isMine(holder: LockHolder | null): boolean {
		return holder?.pid === this.#self.pid && holder.port === this.#self.port;
	}

	#take(): boolean {
		for (let attempt = 0; attempt < 2; attempt++) {
			const created = this.#create();
			if (created !== "exists") return created === "made";
			const holder = this.holder();
			if (this.#isMine(holder)) return true;
			if (holder && this.#running(holder.pid)) return false;
			// A stale lock names a process that is gone. The holder may have changed since the read; only the file read as stale goes.
			if (JSON.stringify(this.holder()) === JSON.stringify(holder)) rmSync(this.#file, { force: true });
		}
		return false;
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
