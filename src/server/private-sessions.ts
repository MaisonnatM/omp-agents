/**
 * Private sessions: each lives exactly as long as its omp process, in its own directory `<root>/<instanceId>`, which
 * also marks it private. Its end deletes the directory with every file omp wrote there, and what omp keeps of it
 * elsewhere; omp's memory and autolearn stay off for it, so nothing it says outlives it.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionPaths } from "../omp/modules";
import type { RpcLaunch } from "../omp/rpc";

/** The settings overlay a private session's omp loads after the user's and the project's, so it outranks both. */
const PRIVATE_CONFIG = 'memory:\n  backend: "off"\nautolearn:\n  enabled: false\n';

export interface PrivateSessionsDeps {
	/** Where the private sessions' directories go, one per instance. */
	root: string;
	unpin(sessionIds: string[]): void;
	/** Removes what omp keeps of these sessions outside their files. */
	forgetInOmp(sessionIds: string[], sessionFiles: string[]): Promise<void>;
	readSessionId(sessionFile: string): Promise<string | null>;
}

export class PrivateSessions {
	readonly #deps: PrivateSessionsDeps;

	constructor(deps: PrivateSessionsDeps) {
		this.#deps = deps;
	}

	/** Session `instanceId` is private and not purged yet. */
	has(instanceId: string): boolean {
		return existsSync(this.#dirOf(instanceId));
	}

	/** `sessionFile` belongs to a private session. */
	holds(sessionFile: string): boolean {
		return sessionFile.startsWith(`${this.#deps.root}/`);
	}

	/** `launch` for private session `instanceId` in `cwd`: its files go in its own directory, made before omp can write one. */
	async launch<L extends RpcLaunch>(instanceId: string, cwd: string, launch: L): Promise<L> {
		const dir = this.#dirOf(instanceId);
		await mkdir(dir, { recursive: true });
		const config = join(dir, "private.yml");
		await writeFile(config, PRIVATE_CONFIG, { mode: 0o600 });
		// Named as under omp's own root, so omp's `/move` and `/wt` keep the session's files inside `dir`.
		return { ...launch, args: [...launch.args, "--session-dir", sessionPaths.sessionDirForCwd(cwd, dir), "--config", config] };
	}

	/**
	 * Deletes private session `instanceId` with everything it wrote. Each step holds when repeated, and the directory,
	 * which marks the session private, goes last, so a purge cut short anywhere is finished by the next.
	 */
	async purge(instanceId: string): Promise<void> {
		const dir = this.#dirOf(instanceId);
		const files = await sessionFilesUnder(dir);
		const ids = (await Promise.all(files.map(file => this.#deps.readSessionId(file)))).filter(id => id !== null);
		this.#deps.unpin(ids);
		await this.#deps.forgetInOmp(ids, files);
		await rm(dir, { recursive: true, force: true });
	}

	/** Purges every private session `isAlive` does not hold of, as one whose omp exited while no server ran. */
	async sweep(isAlive: (instanceId: string) => boolean): Promise<void> {
		const entries = await readdir(this.#deps.root).catch(() => []);
		for (const instanceId of entries) if (!isAlive(instanceId)) await this.purge(instanceId);
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
