/**
 * **Keep rebased**: after each read of the pull requests, the server that holds the owner lock rebases your pull
 * requests that fell behind their base, in the repositories with it on, one at a time and bottom of each stack first,
 * through the same rebase as **Rebase on**. `keep-rebased.json` keeps the switch and each rebase that stopped, by the
 * commits it stopped on, so a restart neither forgets a stop nor tries it again until the pull request's head or its
 * base moves. Every pass starts from GitHub's read, so one a crash cut short is taken up by the next.
 */
import { ReducerFile } from "../fs";
import { errorText } from "../json";
import type { PullRequestList, PullRequestRebase, RebasedPullRequest } from "../shared/github";
import { prKey, pullRequestName, repoKey } from "../shared/github";
import { applyKeepRebased, EMPTY_KEEP_REBASED, type KeepRebasedChange, type KeepRebasedEdit, keepRebasedRuns, type KeepRebasedState, parseKeepRebased, type RebaseStop } from "../shared/keep-rebased";
import { SerialLane } from "../serial-lane";

export interface KeepRebasedDeps {
	/** `keep-rebased.json`, which the servers beside each other share. */
	path: string;
	/** The rebase **Rebase on** runs; rejects with why it failed. */
	rebase(request: PullRequestRebase): Promise<RebasedPullRequest>;
	/** Whether this server rebases: the one that holds the owner lock, so only one server pushes. */
	active(): boolean;
	now(): number;
	/** The switch or the stops changed. */
	onChange(): void;
}

export class KeepRebased {
	readonly #deps: KeepRebasedDeps;
	readonly #file: ReducerFile<KeepRebasedState, [KeepRebasedEdit]>;
	/** One pass at a time; a read while one runs, whose rebases may run a repository's pre-push hook for minutes, starts none. */
	readonly #lane = new SerialLane();

	constructor(deps: KeepRebasedDeps) {
		this.#deps = deps;
		this.#file = new ReducerFile(deps.path, { parse: parseKeepRebased, holds: "the Keep rebased repositories and stops", empty: EMPTY_KEEP_REBASED, reduce: applyKeepRebased, shared: true });
	}

	/** The repositories with **Keep rebased** on, by `repoKey`. */
	get repos(): readonly string[] {
		return this.#file.value.repos;
	}

	get stops(): RebaseStop[] {
		return Object.values(this.#file.value.stops);
	}

	/** Turns **Keep rebased** on or off for one repository. */
	apply(change: KeepRebasedChange): void {
		this.#edit({ op: "switch", ...change });
	}

	/** Reads `keep-rebased.json` again, for what a server beside this one saved. */
	reload(): void {
		const before = this.#file.value;
		this.#file.reload();
		if (JSON.stringify(this.#file.value) !== JSON.stringify(before)) this.#deps.onChange();
	}

	/**
	 * After a read of `list`: forgets each stop it ends and, on the server that holds the owner lock, rebases what
	 * {@link keepRebasedRuns} chooses, in order. A pull request stacked on one this pass rebased or stopped waits for the
	 * next read, which shows the commits it is on.
	 */
	read(list: PullRequestList): void {
		if (this.#lane.busy) return;
		void this.#lane.run(async () => {
			this.reload();
			this.#edit({ op: "read", list });
			if (!this.#deps.active()) return;
			/** The branches this pass rebased or stopped, by `repoKey:branch`, whose pull requests stacked above wait for the next read. */
			const held = new Set<string>();
			for (const { pr, cwd, head, base } of keepRebasedRuns(list, this.#file.value)) {
				const branch = `${repoKey(pr)}:${pr.head}`;
				if (pr.stackedOn !== null && held.has(`${repoKey(pr)}:${pr.stackedOn}`)) {
					held.add(branch);
					continue;
				}
				// The user may turn it off, or a server beside this one take the owner lock, while a rebase runs.
				this.reload();
				if (!this.#deps.active() || !this.#file.value.repos.includes(repoKey(pr))) continue;
				let stopped: Pick<RebaseStop, "outcome" | "why"> | null = null;
				try {
					const outcome = await this.#deps.rebase({ owner: pr.owner, repo: pr.repo, number: pr.number, cwd });
					if (outcome.kind === "conflict") stopped = { outcome: "conflict", why: outcome.files.join("\n") };
					if (outcome.kind !== "current") held.add(branch);
				} catch (error) {
					stopped = { outcome: "failed", why: errorText(error) };
					held.add(branch);
					console.error(`omp-agents: Keep rebased could not rebase ${pullRequestName(pr)}: ${stopped.why}`);
				}
				if (stopped) this.#edit({ op: "stop", stop: { owner: pr.owner, repo: pr.repo, number: pr.number, title: pr.title, branch: pr.head, onto: pr.base, head, base, ...stopped, at: this.#deps.now() } });
				else this.#edit({ op: "forget", key: prKey(pr) });
			}
		});
	}

	#edit(edit: KeepRebasedEdit): void {
		if (this.#file.apply(edit)) this.#deps.onChange();
	}
}
