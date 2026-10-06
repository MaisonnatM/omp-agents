/** Git worktree inventory and removal. Git remains the authority for what is registered. */
import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { errorText } from "./json";
import { run, runChecked } from "./proc";
import type { WorktreeBlocker, WorktreeConfirmation, WorktreeEntry, WorktreeInventory, WorktreeMetrics, WorktreeRemovalPlan, WorktreeRemovalResult, WorktreeTarget } from "./worktrees-shared";

interface Registration {
	path: string;
	head: string;
	branch: string | null;
	locked: string | null;
	prunable: string | null;
	main: boolean;
	bare: boolean;
}

interface Occupant {
	cwd: string;
	unknownAgents: boolean;
}

interface WorktreesEnv {
	knownCwds(): string[];
	activity(): { id: string; cwd: string; modifiedAt: number }[];
	live(): Promise<Occupant[]>;
	serverCwd: string;
}

interface HostUse {
	path: string;
	unknownAgents: boolean;
	repository: string | null;
	unknownRepository: boolean;
}

interface UseSnapshot {
	hosts: HostUse[];
	activity: { id: string; path: string; modifiedAt: number }[];
}

const git = (cwd: string, ...args: string[]) => runChecked(["git", "-C", cwd, ...args], { timeoutMs: 10000 });

const beneath = (parent: string, child: string): boolean => {
	const suffix = relative(parent, child);
	return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
};

async function canonical(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		const parent = dirname(resolve(path));
		if (parent === resolve(path)) throw err;
		return join(await canonical(parent), basename(path));
	}
}

async function commonDir(cwd: string): Promise<string> {
	return canonical((await git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim());
}

function registrations(text: string): Registration[] {
	return text
		.split("\0\0")
		.filter(Boolean)
		.map((block, index) => {
			const fields = block.split("\0");
			const value = (name: string) => fields.find(field => field === name || field.startsWith(`${name} `))?.slice(name.length + 1) ?? null;
			const path = value("worktree");
			if (!path) throw new Error("Git returned an unreadable worktree registration.");
			return {
				path,
				head: value("HEAD") ?? "",
				branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null,
				locked: value("locked"),
				prunable: value("prunable"),
				main: index === 0,
				bare: fields.includes("bare"),
			};
		});
}

/** Looks one level into ignored directories, so a dependency tree is not hashed file by file, and still sees a repository placed there. */
async function nestedRepositories(root: string, ignoredTop: readonly string[]): Promise<string[]> {
	const ignored = new Set(ignoredTop);
	const found: string[] = [];
	let visits = 0;
	const visit = async (dir: string, ignoredDepth: number | null): Promise<void> => {
		if (++visits > 20000) throw new Error("Nested repository scan did not finish. Removal is blocked.");
		const names = (await readdir(dir)).sort();
		const bare = names.includes("HEAD") && names.includes("objects") && names.includes("refs");
		if (dir !== root && (names.includes(".git") || bare)) found.push(relative(root, dir));
		if (ignoredDepth !== null && ignoredDepth >= 2) return;
		for (const name of names) {
			if (name === ".git") continue;
			const child = join(dir, name);
			const stat = await lstat(child);
			if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
			const nextIgnored = ignoredDepth === null ? (dir === root && ignored.has(name) ? 0 : null) : ignoredDepth + 1;
			await visit(child, nextIgnored);
		}
	};
	await visit(root, null);
	return found;
}

async function allocatedUsage(path: string, signal?: AbortSignal): Promise<number> {
	signal?.throwIfAborted();
	const child = Bun.spawn(["du", "-sk", path], { stdout: "pipe", stderr: "pipe", timeout: 10000 });
	const stop = () => child.kill();
	signal?.addEventListener("abort", stop, { once: true });
	try {
		const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		signal?.throwIfAborted();
		if (code !== 0) throw new Error(stderr.trim() || "Disk measurement exceeded its time limit.");
		const kilobytes = Number(stdout.split(/\s/, 1)[0]);
		if (!Number.isFinite(kilobytes) || kilobytes < 0) throw new Error("Disk measurement returned an invalid size.");
		return kilobytes * 1024;
	} finally {
		signal?.removeEventListener("abort", stop);
	}
}

export class Worktrees {
	#chain: Promise<unknown> = Promise.resolve();
	#server: Promise<string> | null = null;
	constructor(private readonly env: WorktreesEnv) {}

	/** Checkout starts and removals share one queue, through insertion in the live registry. */
	async lifecycle<T>(task: () => Promise<T>): Promise<T> {
		const next = this.#chain.then(task, task);
		this.#chain = next.catch(() => {});
		return next;
	}

	async #serverPath(): Promise<string> {
		return (this.#server ??= canonical(this.env.serverCwd));
	}

	async #registered(repository: string): Promise<Registration[]> {
		return registrations(await git(repository, "worktree", "list", "--porcelain", "-z"));
	}

	/** One canonical view of live sessions and saved activity, reused for every worktree in the request. */
	async #snapshot(): Promise<UseSnapshot> {
		const hosts: HostUse[] = [];
		for (const host of await this.env.live()) {
			const path = await canonical(host.cwd);
			let repository: string | null = null;
			let unknownRepository = false;
			if (host.unknownAgents) {
				try {
					repository = await commonDir(path);
				} catch {
					unknownRepository = true;
				}
			}
			hosts.push({ path, unknownAgents: host.unknownAgents, repository, unknownRepository });
		}
		const activity: UseSnapshot["activity"] = [];
		for (const session of this.env.activity()) {
			if (!session.cwd) continue;
			try {
				activity.push({ id: session.id, path: await canonical(session.cwd), modifiedAt: session.modifiedAt });
			} catch {
				/* An unavailable saved directory is not activity in this checkout. */
			}
		}
		return { hosts, activity };
	}

	#occupancy(snapshot: UseSnapshot, repository: string, path: string): WorktreeBlocker[] {
		const blockers: WorktreeBlocker[] = [];
		let unknown = false;
		for (const host of snapshot.hosts) {
			if (beneath(path, host.path)) blockers.push({ code: "occupied", message: `A live omp session uses ${host.path}, including idle or waiting sessions.` });
			if (host.unknownAgents && (host.unknownRepository || host.repository === repository)) unknown = true;
		}
		if (unknown) blockers.push({ code: "unknown-agent-location", message: "This repository has resident subagents whose checkout locations are unknown." });
		return blockers;
	}

	async #detachedLoss(entry: WorktreeEntry): Promise<boolean> {
		if (entry.branch !== null || !entry.head) return false;
		const cwd = entry.missing ? entry.repository : entry.path;
		const contains = entry.missing ? entry.head : "HEAD";
		const refs = await git(cwd, "for-each-ref", `--contains=${contains}`, "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes");
		return !refs.trim();
	}

	async #entry(repository: string, registration: Registration, mainPath: string, serverPath: string, snapshot: UseSnapshot | null): Promise<WorktreeEntry> {
		const path = await canonical(registration.path);
		const blockers: WorktreeBlocker[] = [];
		if (registration.main || registration.bare) blockers.push({ code: "main", message: "The main or bare worktree cannot be removed here." });
		if (!registration.main && mainPath && beneath(path, mainPath)) blockers.push({ code: "main", message: "This worktree contains the main worktree." });
		if (registration.locked !== null) blockers.push({ code: "locked", message: `Git locked this worktree${registration.locked ? `: ${registration.locked}` : "."}` });
		if (beneath(path, serverPath)) blockers.push({ code: "server", message: "This worktree contains the dashboard server." });
		let missing = false;
		try {
			const stat = await lstat(registration.path);
			if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The registered path is not a real checkout directory.");
			if ((await commonDir(path)) !== repository || (!registration.bare && (await canonical((await git(path, "rev-parse", "--show-toplevel")).trim())) !== path)) {
				blockers.push({ code: "foreign", message: "The checkout does not belong to this Git registration." });
			}
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") missing = true;
			else blockers.push({ code: "unreadable", message: errorText(err) });
		}
		if (snapshot) blockers.push(...this.#occupancy(snapshot, repository, path));
		const here = snapshot?.activity.filter(session => beneath(path, session.path)) ?? [];
		return {
			...registration,
			repository,
			path,
			missing,
			lastActivity: here.length ? Math.max(...here.map(session => session.modifiedAt)) : null,
			savedSessionIds: here.map(session => session.id),
			blockers,
		};
	}

	async inventory(scope: string | null): Promise<WorktreeInventory> {
		const result: WorktreeInventory = { repositories: [], errors: [] };
		const snapshot = await this.#snapshot();
		const serverPath = await this.#serverPath();
		const known = new Set<string>();
		for (const cwd of scope === null ? this.env.knownCwds() : [scope]) {
			try {
				const repository = await commonDir(cwd);
				if (known.has(repository)) continue;
				known.add(repository);
				const listed = await this.#registered(repository);
				const mainPath = listed[0] ? await canonical(listed[0].path) : "";
				const worktrees = [];
				for (const registration of listed) worktrees.push(await this.#entry(repository, registration, mainPath, serverPath, snapshot));
				result.repositories.push({ repository, path: listed[0]?.path ?? cwd, name: basename(listed[0]?.path ?? cwd), worktrees });
			} catch (err) {
				result.errors.push({ path: cwd, error: errorText(err) });
			}
		}
		return result;
	}

	async #find(target: WorktreeTarget, snapshot: UseSnapshot | null): Promise<WorktreeEntry> {
		const repository = await canonical(target.repository);
		if ((await commonDir(repository)) !== repository) throw new Error("Repository identity changed.");
		const listed = await this.#registered(repository);
		const main = listed.find(item => item.main);
		const mainPath = main ? await canonical(main.path) : "";
		const path = await canonical(target.path);
		const serverPath = await this.#serverPath();
		for (const registration of listed) {
			if ((await canonical(registration.path)) === path) return this.#entry(repository, registration, mainPath, serverPath, snapshot);
		}
		throw new Error("The worktree is no longer registered in this repository.");
	}

	async metrics(target: WorktreeTarget, signal?: AbortSignal): Promise<WorktreeMetrics> {
		const result: WorktreeMetrics = { ...target, allocatedBytes: null, lastCommit: null, modified: null, untracked: null, errors: [] };
		try {
			const entry = await this.#find(target, null);
			if (entry.missing || entry.blockers.some(blocker => blocker.code === "foreign" || blocker.code === "unreadable")) throw new Error("Checkout is missing or its identity cannot be verified.");
			await Promise.all([
				allocatedUsage(entry.path, signal).then(
					bytes => {
						result.allocatedBytes = bytes;
					},
					(err: unknown) => result.errors.push(errorText(err)),
				),
				git(entry.path, "log", "-1", "--format=%ct")
					.then(stdout => {
						const date = Number(stdout.trim());
						result.lastCommit = Number.isFinite(date) ? date * 1000 : null;
					})
					.catch((err: unknown) => result.errors.push(errorText(err))),
				git(entry.path, "status", "--porcelain=v1", "-z", "--untracked-files=all")
					.then(status => {
						let modified = 0;
						let untracked = 0;
						const fields = status.split("\0");
						for (let index = 0; index < fields.length; index++) {
							const field = fields[index];
							if (!field) continue;
							if (field.startsWith("??")) untracked++;
							else {
								modified++;
								if (field.slice(0, 2).includes("R") || field.slice(0, 2).includes("C")) index++;
							}
						}
						result.modified = modified;
						result.untracked = untracked;
					})
					.catch((err: unknown) => result.errors.push(errorText(err))),
			]);
		} catch (err) {
			result.errors.push(errorText(err));
		}
		return result;
	}

	async preview(target: WorktreeTarget): Promise<WorktreeRemovalPlan> {
		const plan: WorktreeRemovalPlan = {
			...target,
			kind: "remove",
			branch: null,
			head: "",
			ignored: [],
			detachedCommitLoss: false,
			savedSessionIds: [],
			blockers: [],
			confirmation: "",
		};
		try {
			const entry = await this.#find(target, await this.#snapshot());
			Object.assign(plan, {
				repository: entry.repository,
				path: entry.path,
				kind: entry.missing ? "registration" : "remove",
				branch: entry.branch,
				head: entry.head,
				savedSessionIds: entry.savedSessionIds,
				blockers: entry.blockers,
			});
			let nested: string[] = [];
			let identity = "missing";
			const identityBlocked = entry.blockers.some(blocker => blocker.code === "foreign" || blocker.code === "unreadable");
			if (!entry.missing && !identityBlocked) {
				const status = await git(entry.path, "status", "--porcelain=v1", "-z", "--untracked-files=all");
				if (status) plan.blockers.push({ code: "changed", message: "Tracked modifications or untracked files must be preserved before removal." });
				const ignored = await git(entry.path, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z");
				plan.ignored = [...new Set(ignored.split("\0").filter(Boolean).map(path => path.split("/")[0] ?? path))].sort();
				nested = await nestedRepositories(entry.path, plan.ignored);
				if (nested.length) plan.blockers.push({ code: "nested-repository", message: "This checkout contains a nested repository, possibly ignored. Move it out before removal." });
				const stat = await lstat(entry.path);
				identity = `${stat.dev}:${stat.ino}`;
			}
			if (entry.missing || !identityBlocked) {
				try {
					plan.detachedCommitLoss = await this.#detachedLoss(entry);
				} catch (err) {
					plan.blockers.push({ code: "unreadable", message: `Cannot check whether the detached commit is reachable: ${errorText(err)}` });
				}
			}
			const fresh = this.#occupancy(await this.#snapshot(), entry.repository, entry.path);
			plan.blockers = [...plan.blockers.filter(blocker => blocker.code !== "occupied" && blocker.code !== "unknown-agent-location"), ...fresh];
			plan.confirmation = createHash("sha256")
				.update(JSON.stringify({ repository: plan.repository, path: plan.path, kind: plan.kind, branch: plan.branch, head: plan.head, ignored: plan.ignored, nested, detachedCommitLoss: plan.detachedCommitLoss, identity, locked: entry.locked }))
				.digest("hex");
		} catch (err) {
			const message = errorText(err);
			plan.blockers.push({ code: message.includes("no longer registered") ? "unregistered" : "unreadable", message });
		}
		return plan;
	}

	async remove(plans: WorktreeConfirmation[]): Promise<WorktreeRemovalResult[]> {
		return this.lifecycle(async () => {
			const results: WorktreeRemovalResult[] = [];
			for (const confirmed of plans) {
				const current = await this.preview(confirmed);
				let blockers = [...current.blockers];
				if (current.confirmation !== confirmed.confirmation) blockers.push({ code: "drift", message: "The checkout or loss plan changed. Review a new confirmation." });
				else if (current.confirmation) {
					const fresh = this.#occupancy(await this.#snapshot(), current.repository, current.path);
					blockers = [...blockers.filter(blocker => blocker.code !== "occupied" && blocker.code !== "unknown-agent-location"), ...fresh];
				}
				const result: WorktreeRemovalResult = { repository: confirmed.repository, path: confirmed.path, removed: false, blockers, error: null };
				if (!result.blockers.length) {
					try {
						const removed = await run(["git", "-C", current.repository, "worktree", "remove", "--", current.path], { timeoutMs: 30000 });
						if (removed.code !== 0) throw new Error(removed.stderr.trim() || "Git refused removal.");
						result.removed = true;
					} catch (err) {
						result.error = errorText(err);
					}
				}
				results.push(result);
			}
			return results;
		});
	}

	/**
	 * Removes the linked worktree that `cwd` is in, with the checks **Delete** makes, once no live session uses it.
	 * A session that was just ended takes a moment to leave, so an `occupied` checkout is tried again until `waitMs` passes.
	 */
	async removeCheckout(cwd: string, waitMs = 15000): Promise<WorktreeRemovalResult> {
		const target = { repository: await commonDir(cwd), path: await canonical((await git(cwd, "rev-parse", "--show-toplevel")).trim()) };
		const until = Date.now() + waitMs;
		for (;;) {
			const plan = await this.preview(target);
			if (plan.blockers.some(blocker => blocker.code === "occupied") && Date.now() < until) {
				await Bun.sleep(500);
				continue;
			}
			if (plan.blockers.length) return { ...target, removed: false, blockers: plan.blockers, error: null };
			const [result] = await this.remove([{ ...target, confirmation: plan.confirmation }]);
			if (!result) throw new Error("Git worktree removal returned no result.");
			return result;
		}
	}
}
