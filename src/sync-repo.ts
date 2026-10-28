/**
 * The bare Git repository settings sync keeps in the dashboard's data directory: the remote's commits, fetched, and the
 * last one this machine applied. It never has a worktree; files go in and out through git's plumbing.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run, runChecked, type RunOptions } from "./proc";
import { MISSING_REPOSITORY } from "./shared/settings-sync";

/** A text file as the repository holds it. */
export interface RepoFile {
	text: string;
	executable: boolean;
}

const NETWORK_TIMEOUT_MS = 60_000;
const COMMITTER = "omp-agents <omp-agents@localhost>";

/** Sync never waits on a prompt: git asks for no password, and ssh for no passphrase or host key. */
const quiet = (): Record<string, string> => ({
	GIT_TERMINAL_PROMPT: "0",
	GCM_INTERACTIVE: "never",
	...(process.env.GIT_SSH_COMMAND || process.env.GIT_SSH ? {} : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" }),
});

/** Git's line saying the remote repository is missing, which comes before its advice, else its last line. */
function failure(stderr: string, what: string): Error {
	const lines = stderr.split("\n").map(line => line.trim()).filter(Boolean);
	return new Error(lines.find(line => MISSING_REPOSITORY.test(line)) ?? lines.at(-1) ?? `${what} failed`);
}

/**
 * Paths sync carries: none that git's fast-import would need quoted, and none with an empty, `.`, or `..` segment,
 * which would write outside the directory its item names. Sync leaves any other file where it is.
 */
export const plainPath = (path: string): boolean =>
	!/["\\\n\r\t]/.test(path) && !path.startsWith(" ") && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");

export class SyncRepo {
	readonly #dir: string;

	constructor(dir: string) {
		this.#dir = dir;
	}

	#git(args: string[], opts: RunOptions = {}): Promise<string> {
		return runChecked(["git", "--git-dir", this.#dir, ...args], { ...opts, env: { ...quiet(), ...opts.env } });
	}

	/** Creates the repository on first use and points `origin` at `remote`. */
	async prepare(remote: string): Promise<void> {
		if (!existsSync(join(this.#dir, "HEAD"))) await runChecked(["git", "init", "--bare", "--quiet", this.#dir]);
		const url = await run(["git", "--git-dir", this.#dir, "remote", "get-url", "origin"]);
		if (url.code !== 0) await this.#git(["remote", "add", "origin", remote]);
		else if (url.stdout.trim() !== remote) await this.#git(["remote", "set-url", "origin", remote]);
	}

	/** Fetches `branch` from the remote and names its head, or `null` while the remote has no such branch. */
	async fetch(branch: string): Promise<string | null> {
		const listed = await run(["git", "--git-dir", this.#dir, "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`], { env: quiet(), timeoutMs: NETWORK_TIMEOUT_MS });
		if (listed.code === 2) return null;
		if (listed.code !== 0) throw failure(listed.stderr, "git ls-remote");
		// A remote that someone else controls must not hand this repository a tree that names `..` or `.git`.
		await this.#git(["-c", "fetch.fsckObjects=true", "fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeoutMs: NETWORK_TIMEOUT_MS });
		return (await this.#git(["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`])).trim();
	}

	/** The ref that names the commit this machine last applied from `remote`'s `branch`; a new remote or branch starts with none. */
	static baseRef(remote: string, branch: string): string {
		return `refs/omp-agents/base/${createHash("sha256").update(`${remote}\n${branch}`).digest("hex").slice(0, 16)}`;
	}

	async resolve(ref: string): Promise<string | null> {
		const { stdout, code } = await run(["git", "--git-dir", this.#dir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
		return code === 0 ? stdout.trim() : null;
	}

	async setRef(ref: string, commit: string): Promise<void> {
		await this.#git(["update-ref", ref, commit]);
	}

	/** The text files `commit` holds, by path; anything else in it, such as a binary file or a link, is left out. */
	async files(commit: string): Promise<Map<string, RepoFile>> {
		const listing = await this.#git(["ls-tree", "-r", "-z", "--full-tree", commit]);
		const blobs: { path: string; oid: string; executable: boolean }[] = [];
		for (const entry of listing.split("\0")) {
			const tab = entry.indexOf("\t");
			if (tab < 0) continue;
			const [mode, type, oid] = entry.slice(0, tab).split(" ");
			if (type === "blob" && oid && (mode === "100644" || mode === "100755")) blobs.push({ path: entry.slice(tab + 1), oid, executable: mode === "100755" });
		}
		const files = new Map<string, RepoFile>();
		if (blobs.length === 0) return files;
		const child = Bun.spawn(["git", "--git-dir", this.#dir, "cat-file", "--batch"], { stdin: new Blob([blobs.map(blob => `${blob.oid}\n`).join("")]), stdout: "pipe", stderr: "pipe" });
		const [out, code] = await Promise.all([new Response(child.stdout).bytes(), child.exited]);
		if (code !== 0) throw failure(await new Response(child.stderr).text(), "git cat-file");
		const decoder = new TextDecoder("utf-8", { fatal: true });
		let at = 0;
		for (const blob of blobs) {
			const newline = out.indexOf(10, at);
			const size = Number(new TextDecoder().decode(out.subarray(at, newline)).split(" ")[2]);
			const body = out.subarray(newline + 1, newline + 1 + size);
			at = newline + 1 + size + 1;
			if (body.includes(0)) continue;
			try {
				files.set(blob.path, { text: decoder.decode(body), executable: blob.executable });
			} catch {}
		}
		return files;
	}

	/** A commit on `parent`, or a first commit, with `changes` made to its files: `null` deletes one. */
	async commit(parent: string | null, changes: ReadonlyMap<string, RepoFile | null>, message: string): Promise<string> {
		// A fresh ref each time: fast-import continues an existing ref when the commit names no parent.
		const ref = `refs/omp-agents/staged/${crypto.randomUUID()}`;
		const lines = [`commit ${ref}`, `committer ${COMMITTER} ${Math.floor(Date.now() / 1000)} +0000`, `data ${Buffer.byteLength(message)}`, message];
		if (parent) lines.push(`from ${parent}`);
		for (const [path, file] of changes) {
			if (file === null) lines.push(`D ${path}`);
			else lines.push(`M ${file.executable ? "100755" : "100644"} inline ${path}`, `data ${Buffer.byteLength(file.text)}`, file.text);
		}
		lines.push("done", "");
		await this.#git(["fast-import", "--quiet", "--done"], { input: lines.join("\n") });
		const commit = (await this.#git(["rev-parse", "--verify", ref])).trim();
		await this.#git(["update-ref", "-d", ref]);
		return commit;
	}

	/** Moves the remote's `branch` to `commit`, only as a fast-forward. */
	async push(commit: string, branch: string): Promise<void> {
		await this.#git(["push", "--quiet", "origin", `${commit}:refs/heads/${branch}`], { timeoutMs: NETWORK_TIMEOUT_MS });
	}
}
