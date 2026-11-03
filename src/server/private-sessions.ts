/**
 * Private sessions: each lives exactly as long as its omp process, in its own directory `<root>/<instanceId>`, which
 * also marks it private. Its end deletes the directory with every file omp wrote there, and what omp keeps of it
 * elsewhere; omp's memory and autolearn stay off for it, so nothing it says outlives it.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { forgetSessions } from "../omp/forget-sessions";
import { sessionPaths } from "../omp/modules";
import type { RpcLaunch } from "../omp/rpc";
import { readSessionHeader } from "../omp/sessions";

/** The settings overlay a private session's omp loads after the user's and the project's, so it outranks both. */
const PRIVATE_CONFIG = 'memory:\n  backend: "off"\nautolearn:\n  enabled: false\n';

export interface PrivateSessionsDeps {
	/** Where the private sessions' directories go, one per instance. */
	root: string;
	unpin(sessionIds: string[]): void;
}

export class PrivateSessions {
	readonly #deps: PrivateSessionsDeps;
	/** The purge under way of each session, which a second purge of it joins. */
	readonly #purging = new Map<string, Promise<void>>();

	constructor(deps: PrivateSessionsDeps) {
		this.#deps = deps;
	}

	/** Session `instanceId` is private and not purged yet; read from disk, for a server that did not start it. */
	has(instanceId: string): boolean {
		return existsSync(this.#dirOf(instanceId));
	}

	/** `sessionFile` belongs to a private session. */
	holds(sessionFile: string): boolean {
		return sessionFile.startsWith(`${this.#deps.root}/`);
	}

	/**
	 * `launch` for private session `instanceId` in `cwd`, its files in its own directory, made before omp can write one,
	 * and the `discard` that deletes the session when its start fails after this; a launch that fails deletes it itself.
	 */
	async launch<L extends RpcLaunch>(instanceId: string, cwd: string, launch: L): Promise<{ rpc: L; discard: () => Promise<void> }> {
		const dir = this.#dirOf(instanceId);
		const discard = (): Promise<void> => this.purge(instanceId);
		try {
			await mkdir(dir, { recursive: true });
			const config = join(dir, "private.yml");
			await writeFile(config, PRIVATE_CONFIG, { mode: 0o600 });
			// Named as under omp's own root, so omp's `/move` and `/wt` keep the session's files inside `dir`.
			return { rpc: { ...launch, args: [...launch.args, "--session-dir", sessionPaths.sessionDirForCwd(cwd, dir), "--config", config] }, discard };
		} catch (error) {
			await discard();
			throw error;
		}
	}

	/**
	 * Deletes private session `instanceId` with everything it wrote. Each step holds when repeated, and the directory,
	 * which marks the session private, goes last, so a purge cut short anywhere is finished by the next. A purge asked
	 * for while one of the same session runs, as by a failed start and its omp's exit, joins that one.
	 */
	purge(instanceId: string): Promise<void> {
		const running = this.#purging.get(instanceId);
		if (running) return running;
		const purge = this.#purge(instanceId).finally(() => this.#purging.delete(instanceId));
		this.#purging.set(instanceId, purge);
		return purge;
	}

	/** Purges every private session `isAlive` does not hold of, as one whose omp exited while no server ran. */
	async sweep(isAlive: (instanceId: string) => boolean): Promise<void> {
		const entries = await readdir(this.#deps.root).catch(() => []);
		await Promise.all(entries.filter(instanceId => !isAlive(instanceId)).map(instanceId => this.purge(instanceId)));
	}

	async #purge(instanceId: string): Promise<void> {
		const dir = this.#dirOf(instanceId);
		const files = await sessionFilesUnder(dir);
		const headers = await Promise.all(files.map(readSessionHeader));
		const ids = headers.flatMap(header => (header ? [header.id] : []));
		this.#deps.unpin(ids);
		await forgetSessions(ids, files);
		await rm(dir, { recursive: true, force: true });
	}

	#dirOf(instanceId: string): string {
		return join(this.#deps.root, instanceId);
	}
}

/** Every session file under `dir`, subagents' included; none when `dir` is gone. */
async function sessionFilesUnder(dir: string): Promise<string[]> {
	const names = await readdir(dir, { recursive: true }).catch(() => []);
	return names.filter(name => name.endsWith(".jsonl")).map(name => join(dir, name));
}
