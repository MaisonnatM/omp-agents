/**
 * The requests omp's `end_session` tool leaves for the server, one `<session id>.json` each in a directory: end that
 * session as **End session** does, then, when it asked, remove the git worktree it works in. The tool writes its request
 * once the turn that asked is over, and deletes it when the session starts another turn or stops, so a request always
 * names a session that idles after asking. One whose session the server does not follow yet waits for the next drain.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch } from "node:fs";
import { join } from "node:path";
import { errorText, isObject } from "../json";
import { displayPath } from "../paths";

export interface EndRequest {
	sessionId: string;
	removeWorktree: boolean;
}

export interface EndInboxEnv {
	/**
	 * Live session `sessionId`, or `null` while the server does not follow it. `workDir` is where it works: the linked
	 * worktree its bash calls last ran in, else its own directory.
	 */
	session(sessionId: string): { workDir: string; end(): Promise<void> } | null;
	/** Removes the worktree `dir` is in: why it stayed, or `null` once it is gone. */
	removeWorktree(dir: string): Promise<string | null>;
	/** Leaves the user a todo for what an ended session could not finish. */
	report(sessionId: string, text: string, body: string): void;
}

export function parseEndRequest(value: unknown): EndRequest | null {
	if (!isObject(value) || typeof value.sessionId !== "string" || !value.sessionId || typeof value.removeWorktree !== "boolean") return null;
	return { sessionId: value.sessionId, removeWorktree: value.removeWorktree };
}

export class EndInbox {
	readonly #dir: string;
	readonly #env: EndInboxEnv;

	constructor(dir: string, env: EndInboxEnv) {
		this.#dir = dir;
		this.#env = env;
	}

	/** Ends the session of every request whose session runs, deleting the request first; settles once each has ended and its worktree is handled. */
	async drain(): Promise<void> {
		let names: string[];
		try {
			names = readdirSync(this.#dir).filter(name => name.endsWith(".json"));
		} catch {
			return;
		}
		const ending: Promise<void>[] = [];
		for (const name of names) {
			const path = join(this.#dir, name);
			let request: EndRequest | null = null;
			let why = "it is not an end request";
			try {
				request = parseEndRequest(JSON.parse(readFileSync(path, "utf8")));
			} catch (err) {
				// The tool deleted it between the listing and the read.
				if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
				why = errorText(err);
			}
			if (!request || `${request.sessionId}.json` !== name) {
				console.error(`omp-agents: set aside ${path}: ${request ? "its name is not its session id" : why}`);
				renameSync(path, `${path}.invalid`);
				continue;
			}
			const session = this.#env.session(request.sessionId);
			if (!session) continue;
			rmSync(path, { force: true });
			ending.push(this.#end(request, session));
		}
		await Promise.all(ending);
	}

	async #end(request: EndRequest, session: { workDir: string; end(): Promise<void> }): Promise<void> {
		try {
			await session.end();
		} catch (err) {
			console.error(`omp-agents: could not end session ${request.sessionId}: ${errorText(err)}`);
			return;
		}
		if (!request.removeWorktree) return;
		let why: string | null;
		try {
			why = await this.#env.removeWorktree(session.workDir);
		} catch (err) {
			why = errorText(err);
		}
		if (why) this.#env.report(request.sessionId, `Remove the worktree ${displayPath(session.workDir)}`, `The session asked to end and to remove its worktree, which stayed: ${why}`);
	}

	/** Drains now and on every change to the directory, which it creates. */
	watch(): void {
		mkdirSync(this.#dir, { recursive: true });
		watch(this.#dir, () => void this.drain());
		void this.drain();
	}
}
