/** Git worktree inventory and removal. Git remains the authority for what is registered. */
import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { canonical, commonDir, git, holderOf, repositoryAt, worktreeAt, worktreesOf, type Registration } from "./git";
import { errorText } from "./json";
import { mapLimit, PROBE_PARALLEL } from "./map-limit";
import { displayPath } from "./paths";
import { run } from "./proc";
import type { MergedPullRequest } from "./pull-requests";
import type { BranchRelease } from "./shared/git";
import type { WorktreeBlocker, WorktreeConfirmation, WorktreeEntry, WorktreeInventory, WorktreeMerge, WorktreeMetrics, WorktreeRemovalPlan, WorktreeRemovalResult, WorktreeTarget } from "./worktrees-shared";

export type WorktreeOccupant =
	| { kind: "located"; cwd: string; label: string }
	| { kind: "unlocated"; scopeCwd: string; label: string };

interface WorktreesEnv {
	knownCwds(): string[];
	activity(): { id: string; cwd: string; modifiedAt: number }[];
	live(): readonly WorktreeOccupant[] | Promise<readonly WorktreeOccupant[]>;
	serverCwd: string;
	/** The branches of `branches` whose newest pull request in `repository`'s GitHub repository merged. */
	mergedPullRequests(repository: string, branches: string[]): Promise<Map<string, MergedPullRequest>>;
}

type OccupantUse =
	| { kind: "located"; path: string; label: string }
	| { kind: "unlocated"; scopeCwd: string; repository: string | null; label: string };

interface UseSnapshot {
	occupants: OccupantUse[];
	activity: { id: string; path: string; modifiedAt: number }[];
}

/** A registered checkout before the inventory says whether its work merged. */
type Checkout = Omit<WorktreeEntry, "merged">;

/** A checkout's branch and commit, which decide whether its work merged. */
type Tip = Pick<WorktreeEntry, "path" | "branch" | "head">;

/** The merged checkouts of one repository, by path, and why GitHub could not say, when it could not. */
interface Merges {
	merged: Map<string, WorktreeMerge>;
	error: string | null;
}

/** Most checkouts read at once, each by a git call or a few. */
const READ_CONCURRENCY = 4;

/** A probe's value, or the error it failed with, kept for each caller to judge. */
type Probed<T> = { ok: true; value: T } | { ok: false; error: unknown };

const settle = <T>(probe: Promise<T>): Promise<Probed<T>> =>
	probe.then(
		(value): Probed<T> => ({ ok: true, value }),
		(error: unknown): Probed<T> => ({ ok: false, error }),
	);

/** The probe's value; its error rethrown when it failed. */
function unwrap<T>(probed: Probed<T> | undefined): T {
	if (!probed) throw new Error("No probe ran here.");
	if (!probed.ok) throw probed.error;
	return probed.value;
}

/**
 * `path` canonical as far as the server may look.
 * A session can name a path under a folder the server cannot read, such as one macOS guards; that path still marks the checkout it sits in, where `canonical` would throw and leave every preview unreadable.
 */
async function canonicalAsFarAsReadable(path: string): Promise<string> {
	try {
		return await canonical(path);
	} catch (error) {
		const parent = dirname(path);
		if (parent === path) throw error;
		return join(await canonicalAsFarAsReadable(parent), basename(path));
	}
}

/** `probe` of each distinct key once, at most `PROBE_PARALLEL` at once, by key: most sessions share a handful of directories. */
async function probeEach<T>(keys: Iterable<string>, probe: (key: string) => Promise<T>): Promise<Map<string, Probed<T>>> {
	const distinct = [...new Set(keys)];
	const probed = await mapLimit(distinct, PROBE_PARALLEL, key => settle(probe(key)));
	return new Map(distinct.map((key, index) => [key, probed[index]!]));
}

/** Whether `child` is `parent` or inside it, both canonical. */
export const beneath = (parent: string, child: string): boolean => {
	const suffix = relative(parent, child);
	return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
};

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
	const { stdout, stderr, code } = await run(["du", "-sk", path], { timeoutMs: 10000, signal });
	if (code !== 0) throw new Error(stderr.trim() || "Disk measurement exceeded its time limit.");
	const kilobytes = Number(stdout.split(/\s/, 1)[0]);
	if (!Number.isFinite(kilobytes) || kilobytes < 0) throw new Error("Disk measurement returned an invalid size.");
	return kilobytes * 1024;
}

class UnregisteredWorktree extends Error {
	constructor() {
		super("The worktree is no longer registered in this repository.");
	}
}

export class Worktrees {
	#chain: Promise<unknown> = Promise.resolve();
	#server: Promise<string> | null = null;
	#removing: Promise<unknown> | null = null;
	readonly #starting = new Set<Promise<unknown>>();
	constructor(private readonly env: WorktreesEnv) {}

	/** Only checkout and registry insertion exclude removal; independent session spawns stay parallel. */
	async checkout<T>(task: () => Promise<T>): Promise<T> {
		const next = this.#chain.then(task, task);
		this.#chain = next.catch(() => {});
		return next;
	}

	/** A start already underway finishes registering before removal snapshots; new starts wait only for removal. */
	async start<T>(task: () => Promise<T>, checkout: boolean): Promise<T> {
		// A removal queued while this waited would otherwise take the checkout chain ahead of this start and wait for it.
		while (this.#removing) await this.#removing;
		const pending = checkout ? this.checkout(task) : task();
		this.#starting.add(pending);
		try {
			return await pending;
		} finally {
			this.#starting.delete(pending);
		}
	}

	async #serverPath(): Promise<string> {
		return (this.#server ??= canonical(this.env.serverCwd));
	}

	/** Known actor directories and the repository scopes of actors whose location is still unresolved. */
	async #liveOccupants(): Promise<OccupantUse[]> {
		const live = await this.env.live();
		const locatedOf = await probeEach(live.flatMap(occupant => occupant.kind === "located" ? [occupant.cwd] : []), canonicalAsFarAsReadable);
		const canonicalOf = await probeEach(live.flatMap(occupant => occupant.kind === "unlocated" ? [occupant.scopeCwd] : []), canonical);
		const scopes = [...canonicalOf.values()].flatMap(probed => probed.ok ? [probed.value] : []);
		const repositoryOf = await probeEach(scopes, commonDir);
		return live.map((occupant): OccupantUse => {
			if (occupant.kind === "located") return { kind: "located", path: unwrap(locatedOf.get(occupant.cwd)), label: occupant.label };
			const path = canonicalOf.get(occupant.scopeCwd);
			const repository = path?.ok ? repositoryOf.get(path.value) : undefined;
			return { kind: "unlocated", scopeCwd: path?.ok ? path.value : occupant.scopeCwd, repository: repository?.ok ? repository.value : null, label: occupant.label };
		});
	}

	/** Every known live actor directory, idle and waiting ones included, each path a live session's tool calls named, and the server's own directory. */
	async inUse(): Promise<string[]> {
		const [occupants, server] = await Promise.all([this.#liveOccupants(), this.#serverPath()]);
		return [...new Set([...occupants.flatMap(occupant => occupant.kind === "located" ? [occupant.path] : []), server])];
	}

	/** One canonical view of live sessions and saved activity, reused for every worktree in the request. */
	async #snapshot(): Promise<UseSnapshot> {
		const occupants = await this.#liveOccupants();
		const sessions = this.env.activity().filter(session => session.cwd);
		const canonicalOf = await probeEach(sessions.map(session => session.cwd), canonical);
		// An unavailable saved directory is not activity in this checkout.
		const activity = sessions.flatMap(session => {
			const probed = canonicalOf.get(session.cwd);
			return probed?.ok ? [{ id: session.id, path: probed.value, modifiedAt: session.modifiedAt }] : [];
		});
		return { occupants, activity };
	}

	#occupancy(snapshot: UseSnapshot, repository: string, path: string): WorktreeBlocker[] {
		const located = new Map<string, Set<string>>();
		const unlocated = new Map<string, Set<string>>();
		for (const occupant of snapshot.occupants) {
			if (occupant.kind === "located") {
				if (!beneath(path, occupant.path)) continue;
				const paths = located.get(occupant.label) ?? new Set<string>();
				paths.add(occupant.path);
				located.set(occupant.label, paths);
			} else if (occupant.repository === null || occupant.repository === repository) {
				const scopes = unlocated.get(occupant.label) ?? new Set<string>();
				scopes.add(occupant.scopeCwd);
				unlocated.set(occupant.label, scopes);
			}
		}
		return [
			...[...located].map(([label, paths]): WorktreeBlocker => {
				// A session can name one path for each file it touched here, so name the shallowest and count the rest.
				const [first, ...rest] = [...paths].sort((a, b) => a.length - b.length);
				return { code: "occupied", message: `${label} uses ${first}${rest.length ? ` and ${rest.length} more ${rest.length === 1 ? "path" : "paths"} in this checkout` : ""}.` };
			}),
			...[...unlocated].map(([label, scopes]): WorktreeBlocker => ({ code: "unknown-agent-location", message: `Cannot locate ${label} from ${[...scopes].join(", ")}; its checkout may still be in use.` })),
		];
	}

	async #detachedLoss(entry: Checkout): Promise<boolean> {
		if (entry.branch !== null || !entry.head) return false;
		const cwd = entry.missing ? entry.repository : entry.path;
		const contains = entry.missing ? entry.head : "HEAD";
		const refs = await git(cwd, "for-each-ref", `--contains=${contains}`, "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes");
		return !refs.trim();
	}

	/** The repository a checkout belongs to and, unless it is bare, its top-level directory, from one git call. */
	async #identity(path: string, bare: boolean): Promise<{ common: string; top: string | null }> {
		if (bare) return { common: await commonDir(path), top: null };
		const lines = (await git(path, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel")).trim().split("\n");
		// A path that holds a newline cannot be told apart in the lines, so those ask git twice.
		if (lines.length !== 2) return { common: await commonDir(path), top: await canonical((await git(path, "rev-parse", "--show-toplevel")).trim()) };
		return { common: await canonical(lines[0]!.trim()), top: await canonical(lines[1]!.trim()) };
	}

	async #entry(repository: string, registration: Registration, mainPath: string, serverPath: string, snapshot: UseSnapshot | null): Promise<Checkout> {
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
			const { common, top } = await this.#identity(path, registration.bare);
			if (common !== repository || (top !== null && top !== path)) {
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

	/**
	 * Which of `tips`, all in `repository`, merged: a commit that `origin`'s default branch contains, or a branch whose newest
	 * pull request merged, which a squash merge leaves outside the default branch, unless the branch has a commit made after.
	 * `error` says why the rest could not be told, such as GitHub failing to answer; what was told before it stays.
	 */
	async #merges(repository: string, tips: Tip[]): Promise<Merges> {
		const merged = new Map<string, WorktreeMerge>();
		try {
			const trunk = await run(["git", "-C", repository, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
			if (trunk.code === 0) {
				const branch = trunk.stdout.trim();
				const contained = await probeEach(tips.flatMap(tip => (tip.head ? [tip.head] : [])), async head => (await run(["git", "-C", repository, "merge-base", "--is-ancestor", head, "refs/remotes/origin/HEAD"])).code === 0);
				for (const tip of tips) {
					const probed = contained.get(tip.head);
					if (probed?.ok && probed.value) merged.set(tip.path, { by: "default-branch", branch });
				}
			}
			const rest = tips.flatMap(tip => (tip.branch !== null && tip.head && !merged.has(tip.path) ? [{ path: tip.path, branch: tip.branch, head: tip.head }] : []));
			if (!rest.length) return { merged, error: null };
			const pulls = await this.env.mergedPullRequests(repository, [...new Set(rest.map(tip => tip.branch))]);
			const ended = rest.flatMap(tip => {
				const pull = pulls.get(tip.branch);
				return pull ? [{ ...tip, pull }] : [];
			});
			if (!ended.length) return { merged, error: null };
			const log = await git(repository, "log", "--no-walk=unsorted", "--format=%H %ct", ...new Set(ended.map(tip => tip.head)));
			const madeAt = new Map(log.trim().split("\n").map(line => {
				const [commit = "", seconds = ""] = line.split(" ");
				return [commit, Number(seconds) * 1000];
			}));
			for (const tip of ended) {
				const at = madeAt.get(tip.head);
				if (at !== undefined && at <= tip.pull.mergedAt) merged.set(tip.path, { by: "pull-request", number: tip.pull.number });
			}
			return { merged, error: null };
		} catch (err) {
			return { merged, error: errorText(err) };
		}
	}

	async inventory(scope: string | null): Promise<WorktreeInventory> {
		const result: WorktreeInventory = { repositories: [], errors: [] };
		const snapshot = await this.#snapshot();
		const serverPath = await this.#serverPath();
		const cwds = scope === null ? this.env.knownCwds() : [scope];
		const repositoryOf = await probeEach(cwds, repositoryAt);
		const repositories = new Set(cwds.flatMap(cwd => {
			const probed = repositoryOf.get(cwd);
			return probed?.ok && probed.value !== null ? [probed.value] : [];
		}));
		const listingOf = await probeEach(repositories, async repository => {
			const listed = await worktreesOf(repository);
			return { listed, mainPath: listed[0] ? await canonical(listed[0].path) : "" };
		});
		// Every repository's checkouts in one queue, so many repositories read no more checkouts at once than one does.
		const reads = [...listingOf].flatMap(([repository, probed]) => (probed.ok ? probed.value.listed.map(registration => ({ repository, registration, mainPath: probed.value.mainPath })) : []));
		const read = await mapLimit(reads, READ_CONCURRENCY, ({ repository, registration, mainPath }) => settle(this.#entry(repository, registration, mainPath, serverPath, snapshot)));
		const entriesOf = Map.groupBy(read, (_, index) => reads[index]!.repository);
		const mergesOf = await probeEach(repositories, repository =>
			this.#merges(repository, (entriesOf.get(repository) ?? []).flatMap(probed => (probed.ok && !probed.value.main && !probed.value.bare ? [probed.value] : []))),
		);
		const known = new Set<string>();
		for (const cwd of cwds) {
			try {
				const repository = unwrap(repositoryOf.get(cwd));
				// A directory sessions ran in that is gone or outside git has no worktrees; only a path asked for says so.
				if (repository === null) {
					if (scope !== null) result.errors.push({ path: cwd, error: "Not in a Git repository." });
					continue;
				}
				if (known.has(repository)) continue;
				known.add(repository);
				const { listed } = unwrap(listingOf.get(repository));
				const path = listed[0]?.path ?? cwd;
				const { merged, error } = unwrap(mergesOf.get(repository));
				if (error) result.errors.push({ path, error: `Cannot tell which worktrees merged: ${error}` });
				const worktrees = (entriesOf.get(repository) ?? []).map(unwrap).map(entry => ({ ...entry, merged: merged.get(entry.path) ?? null }));
				result.repositories.push({ repository, path, name: basename(path), worktrees });
			} catch (err) {
				result.errors.push({ path: cwd, error: errorText(err) });
			}
		}
		return result;
	}

	async #find(target: WorktreeTarget, snapshot: UseSnapshot | null): Promise<Checkout> {
		const repository = await canonical(target.repository);
		if ((await commonDir(repository)) !== repository) throw new Error("Repository identity changed.");
		const listed = await worktreesOf(repository);
		const main = listed.find(item => item.main);
		const mainPath = main ? await canonical(main.path) : "";
		const path = await canonical(target.path);
		const serverPath = await this.#serverPath();
		for (const registration of listed) {
			if ((await canonical(registration.path)) === path) return this.#entry(repository, registration, mainPath, serverPath, snapshot);
		}
		throw new UnregisteredWorktree();
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

	/**
	 * The plans for `targets`, in their order, read concurrently from one snapshot of what uses them. `merged` blocks each
	 * target whose work has not merged; the confirmation pins the branch and commit this checked, so removal need not ask again.
	 */
	async previewAll(targets: WorktreeTarget[], merged: boolean): Promise<WorktreeRemovalPlan[]> {
		const snapshot = await this.#snapshot();
		const plans = await mapLimit(targets, READ_CONCURRENCY, target => this.preview(target, snapshot));
		if (!merged) return plans;
		const readable = plans.flatMap(plan => (plan.kind === "unreadable" ? [] : [plan]));
		const mergesOf = await probeEach(readable.map(plan => plan.repository), repository => this.#merges(repository, readable.filter(plan => plan.repository === repository)));
		return plans.map(plan => {
			if (plan.kind === "unreadable") return plan;
			const { merged: done, error } = unwrap(mergesOf.get(plan.repository));
			if (done.has(plan.path)) return plan;
			const message = error ? `Cannot tell whether this worktree merged: ${error}` : "Not merged: the default branch lacks this commit, and no merged pull request took it.";
			return { ...plan, blockers: [...plan.blockers, { code: "unmerged", message }] };
		});
	}

	async preview(target: WorktreeTarget, snapshot?: UseSnapshot): Promise<WorktreeRemovalPlan> {
		try {
			const entry = await this.#find(target, snapshot ?? await this.#snapshot());
			const blockers = [...entry.blockers];
			let ignored: string[] = [];
			let nested: string[] = [];
			let identity = "missing";
			let detachedCommitLoss = false;
			const identityBlocked = blockers.some(blocker => blocker.code === "foreign" || blocker.code === "unreadable");
			if (!entry.missing && !identityBlocked) {
				const [status, flags] = await Promise.all([
					git(entry.path, "-c", "core.filemode=true", "status", "--porcelain=v1", "-z", "--untracked-files=all"),
					git(entry.path, "ls-files", "-v", "-z"),
				]);
				if (flags.split("\0").some(file => /^[a-zS] /.test(file))) throw new Error("The index hides worktree changes with assume-unchanged or skip-worktree flags.");
				if (status) blockers.push({ code: "changed", message: "Tracked modifications or untracked files must be preserved before removal." });
				const files = await git(entry.path, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z");
				ignored = [...new Set(files.split("\0").filter(Boolean).map(path => path.split("/")[0] ?? path))].sort();
				nested = await nestedRepositories(entry.path, ignored);
				if (nested.length) blockers.push({ code: "nested-repository", message: "This checkout contains a nested repository, possibly ignored. Move it out before removal." });
				const stat = await lstat(entry.path);
				identity = `${stat.dev}:${stat.ino}`;
			}
			if (entry.missing || !identityBlocked) {
				try {
					detachedCommitLoss = await this.#detachedLoss(entry);
				} catch (err) {
					blockers.push({ code: "unreadable", message: `Cannot check whether the detached commit is reachable: ${errorText(err)}` });
				}
			}
			const kind = entry.missing ? "registration" : "remove";
			const confirmation = createHash("sha256")
				.update(JSON.stringify({ repository: entry.repository, path: entry.path, kind, branch: entry.branch, head: entry.head, ignored, nested, detachedCommitLoss, identity, locked: entry.locked }))
				.digest("hex");
			return { repository: entry.repository, path: entry.path, kind, branch: entry.branch, head: entry.head, ignored, detachedCommitLoss, savedSessionIds: entry.savedSessionIds, blockers, confirmation };
		} catch (err) {
			const message = errorText(err);
			return { repository: target.repository, path: target.path, kind: "unreadable", blockers: [{ code: err instanceof UnregisteredWorktree ? "unregistered" : "unreadable", message }] };
		}
	}

	/** Removes each of `plans` its fresh preview still confirms, and logs each removal as asked for by `by`, such as "ended session <id>". */
	async remove(plans: WorktreeConfirmation[], by: string): Promise<WorktreeRemovalResult[]> {
		const removal = this.checkout(async () => {
			await Promise.allSettled([...this.#starting]);
			const snapshot = await this.#snapshot();
			const results: WorktreeRemovalResult[] = [];
			for (const confirmed of plans) {
				const current = await this.preview(confirmed, snapshot);
				const blockers = [...current.blockers];
				if (current.kind !== "unreadable" && current.confirmation !== confirmed.confirmation) blockers.push({ code: "drift", message: "The checkout or loss plan changed. Review a new confirmation." });
				const result: WorktreeRemovalResult = { repository: confirmed.repository, path: confirmed.path, removed: false, blockers, error: null };
				if (!blockers.length && current.kind !== "unreadable") {
					try {
						const removed = await run(["git", "-C", current.repository, "worktree", "remove", "--", current.path], { timeoutMs: 30000 });
						if (removed.code !== 0) throw new Error(removed.stderr.trim() || "Git refused removal.");
						result.removed = true;
						console.log(`omp-agents: removed the worktree ${displayPath(current.path)} for ${by}`);
					} catch (err) {
						result.error = errorText(err);
					}
				}
				results.push(result);
			}
			return results;
		});
		this.#removing = removal;
		try {
			return await removal;
		} finally {
			if (this.#removing === removal) this.#removing = null;
		}
	}

	/**
	 * Removes the linked worktree that `cwd` is in, with the checks **Delete** makes, once no live session uses it; `null`
	 * when `cwd` is in none, such as a main checkout or a directory outside git.
	 * A session that was just ended takes a moment to leave, so an `occupied` checkout is tried again until `waitMs` passes.
	 */
	async removeCheckout(cwd: string, by: string, waitMs = 15000): Promise<WorktreeRemovalResult | null> {
		const at = await worktreeAt(cwd);
		if (!at?.linked) return null;
		const target = { repository: await canonical(at.common), path: await canonical(at.top) };
		const until = Date.now() + waitMs;
		// Only live sessions decide this wait, so the checkout is read in full once, after they leave or the time is up.
		while (Date.now() < until && this.#occupancy({ occupants: await this.#liveOccupants(), activity: [] }, target.repository, target.path).some(blocker => blocker.code === "occupied")) await Bun.sleep(500);
		const plan = await this.preview(target);
		// An unreadable plan always names its blocker.
		if (plan.blockers.length || plan.kind === "unreadable") return { ...target, removed: false, blockers: plan.blockers, error: null };
		const [result] = await this.remove([{ ...target, confirmation: plan.confirmation }], by);
		if (!result) throw new Error("Git worktree removal returned no result.");
		return result;
	}

	/**
	 * Removes the linked worktree of `cwd`'s repository that has `branch` checked out, as {@link removeCheckout} does but without
	 * waiting for a session to leave, so the branch can be checked out elsewhere. A main checkout is never one.
	 */
	async releaseBranch(cwd: string, branch: string): Promise<BranchRelease> {
		const holder = await holderOf(cwd, branch);
		const result = holder && !holder.main ? await this.removeCheckout(holder.path, `releasing branch ${branch}`, 0) : null;
		if (!result) return { kind: "none" };
		if (result.removed) return { kind: "removed", path: result.path };
		return { kind: "kept", path: result.path, why: result.error ?? result.blockers.map(blocker => blocker.message).join(" ") };
	}

	/**
	 * Deletes local branch `branch` of the repository whose git directory is `gitDir` when its last commit is `head`, the one
	 * its pull request merged, or one `head` contains, as after the merge queue updated the branch on GitHub, and no worktree
	 * has it checked out; whether it deleted it. A branch with a commit the merge did not take, or one a kept worktree still
	 * holds, stays.
	 */
	async deleteMergedBranch(gitDir: string, branch: string, head: string): Promise<boolean> {
		if ((await worktreesOf(gitDir)).some(registration => registration.branch === branch)) return false;
		const ref = `refs/heads/${branch}`;
		const tip = await run(["git", "-C", gitDir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
		if (tip.code !== 0) return false;
		const local = tip.stdout.trim();
		if (local !== head) {
			// GitHub may hold `head` alone, such as the merge of the base the queue made into the branch.
			await run(["git", "-C", gitDir, "fetch", "--quiet", "--no-tags", "origin", head], { timeoutMs: 60_000 });
			if ((await run(["git", "-C", gitDir, "merge-base", "--is-ancestor", local, head])).code !== 0) return false;
		}
		// `update-ref` deletes only while the branch still points at the commit checked, so a commit made meanwhile keeps it.
		return (await run(["git", "-C", gitDir, "update-ref", "-d", ref, local])).code === 0;
	}
}
