/**
 * Merges that wait until GitHub allows them, kept in `merges.json` so they survive the page and the server: one pull
 * request, or a stack merged bottom first, each pull request retargeted onto the stack's base, marked ready, and its
 * branch updated as GitHub requires, then merged once its checks pass, by GitHub's auto-merge where the repository
 * allows it. Each tick reads where the pull request under way stands and takes one step, so a restart picks up where
 * the last server stopped. A merge stops at its first failure, with the reason, until it is cancelled.
 */
import { JsonFile } from "../fs";
import { errorText } from "../json";
import { type MergeStatus } from "../pull-request-merge";
import { mergesNow, type PullRequest, pullRequestName, samePullRequest } from "../shared/github";
import { isQueuedMerge, type MergeQueueChange, type QueuedMerge, type QueuedPullRequest, queuedMergeOf } from "../shared/merge-queue";
import type { MergeMethod } from "../shared/source-control";
import { SerialLane } from "../serial-lane";

/** How long GitHub may still report a branch the queue updated as behind, before the queue updates it again. */
const UPDATE_SETTLE_MS = 60_000;
/** The most steps one look takes, so a change GitHub has not shown yet, such as a retarget, is not made again and again. */
const STEPS_PER_LOOK = 6;

/** What the queue asks of GitHub; each mutation names the pull request by its node id. */
export interface MergeGitHub {
	status(pr: PullRequest): Promise<MergeStatus>;
	merge(id: string, method: MergeMethod, head: string): Promise<void>;
	/** Asks GitHub to merge the base into the branch, only while its head is `head`; GitHub makes the commit after it answers. */
	update(id: string, head: string): Promise<void>;
	arm(id: string, method: MergeMethod, head: string): Promise<void>;
	disarm(id: string): Promise<void>;
	retarget(id: string, base: string): Promise<void>;
	ready(id: string): Promise<void>;
}

export interface MergeQueueDeps {
	/** `merges.json`; `null` keeps the merges in memory only. */
	path: string | null;
	github: MergeGitHub;
	now(): number;
	newId(): string;
	/** Whether this server carries out the merges: the one that owns the unattended work. */
	active(): boolean;
	/** The list changed. */
	onChange(): void;
	/** `pr` merged through the queue. */
	onMerged(pr: QueuedPullRequest): void;
}

/** The one step a queued merge takes next, from where its first pull request stands now. */
export type MergeStep = { kind: "merged" } | { kind: "fail"; why: string } | { kind: "wait"; why: string } | { kind: "retarget" | "ready" | "update" | "merge" | "arm" | "adopt" };

/** The step `merge` takes next, given where its first pull request stands at `now`. */
export function nextStep(merge: QueuedMerge, status: MergeStatus, now: number): MergeStep {
	const [pr] = merge.prs;
	if (!pr) return { kind: "merged" };
	const name = `#${pr.number}`;
	if (status.state === "merged") return { kind: "merged" };
	if (status.state === "closed") return { kind: "fail", why: `${name} was closed.` };
	// GitHub writes the queue's update of the branch later, as a merge commit whose first parent is the head pinned before it.
	if (status.head !== pr.head) return merge.updatedAt !== null && status.parents[0] === pr.head ? { kind: "adopt" } : { kind: "fail", why: `${name}'s branch moved after the merge was queued; review it and merge again.` };
	if (status.base !== merge.base) return { kind: "retarget" };
	if (status.draft) return { kind: "ready" };
	if (status.mergeState === "dirty") return { kind: "fail", why: `${name} conflicts with ${merge.base}.` };
	if (status.checks === "failing") return { kind: "fail", why: `${name}'s checks failed.` };
	if (status.mergeState === "behind") return merge.updatedAt !== null && now - merge.updatedAt < UPDATE_SETTLE_MS ? { kind: "wait", why: "Updating the branch" } : { kind: "update" };
	if (status.autoArmed) return { kind: "wait", why: "GitHub merges it once it is ready" };
	if (mergesNow(status)) return { kind: "merge" };
	if (status.mergeState === "unknown") return { kind: "wait", why: "GitHub is checking whether it can merge" };
	if (status.autoAllowed) return { kind: "arm" };
	return { kind: "wait", why: status.checks === "pending" ? "Waiting for checks" : "Waiting for a review or a rule of the base branch" };
}

/** `prs` ordered bottom first, each one's base the branch of the one before; `null` when they do not form one chain. */
export function stackOrder<T extends { branch: string; base: string }>(prs: readonly T[]): T[] | null {
	const byBase = new Map(prs.map(pr => [pr.base, pr]));
	if (byBase.size !== prs.length) return null;
	const bottom = prs.filter(pr => !prs.some(other => other.branch === pr.base));
	if (bottom.length !== 1) return null;
	const order = [bottom[0]!];
	for (let next = byBase.get(order[0]!.branch); next && order.length < prs.length; next = byBase.get(next.branch)) order.push(next);
	return order.length === prs.length ? order : null;
}

export class MergeQueue {
	readonly #deps: MergeQueueDeps;
	readonly #file: JsonFile<QueuedMerge[]> | null;
	#merges: QueuedMerge[];
	/** Adds, cancels, and ticks, one at a time, so two never step the same merge. */
	readonly #lane = new SerialLane();

	constructor(deps: MergeQueueDeps) {
		this.#deps = deps;
		this.#file =
			deps.path === null
				? null
				: new JsonFile(deps.path, { parse: value => (Array.isArray(value) && value.every(isQueuedMerge) ? value : null), holds: "a list of queued merges", onInvalid: "aside", indent: "\t" });
		this.#merges = this.#file?.load() ?? [];
	}

	get list(): readonly QueuedMerge[] {
		return this.#merges;
	}

	/** Applies `change`; rejects with the reason it refuses one. */
	apply(change: MergeQueueChange): Promise<void> {
		switch (change.op) {
			case "add":
				return this.#lane.run(() => this.#add(change.method, change.prs));
			case "cancel":
				return this.#lane.run(() => this.#cancel(change.id));
			default: {
				const unhandled: never = change;
				return unhandled;
			}
		}
	}

	/**
	 * Takes one step of every merge still waiting, when this server carries them out: it first reads `merges.json` again, so
	 * it adopts a merge another server beside it queued.
	 */
	tick(): Promise<void> {
		return this.#lane.run(async () => {
			if (!this.#deps.active()) return;
			const saved = this.#file?.load();
			if (saved && JSON.stringify(saved) !== JSON.stringify(this.#merges)) {
				this.#merges = saved;
				this.#deps.onChange();
			}
			for (const merge of this.#merges) if (merge.state.kind === "waiting") await this.#step(merge.id);
		});
	}

	async #add(method: MergeMethod, requested: (PullRequest & { head: string | null })[]): Promise<void> {
		if (requested.length === 0) throw new Error("Name a pull request to merge.");
		for (const pr of requested) if (queuedMergeOf(this.#merges, pr)) throw new Error(`${pullRequestName(pr)} is already queued to merge.`);
		const read: (QueuedPullRequest & { base: string })[] = [];
		for (const pr of requested) {
			const status = await this.#deps.github.status(pr);
			if (status.state !== "open") throw new Error(`${pullRequestName(pr)} is ${status.state}, not open.`);
			if (pr.head !== null && pr.head !== status.head) throw new Error(`${pullRequestName(pr)}'s branch moved since you looked; review it and merge again.`);
			read.push({ owner: pr.owner, repo: pr.repo, number: pr.number, title: status.title, branch: status.branch, head: status.head, base: status.base });
		}
		const order = stackOrder(read);
		if (!order) throw new Error("These pull requests do not form one stack.");
		const prs = order.map(({ base: _, ...pr }) => pr);
		const merge: QueuedMerge = { id: this.#deps.newId(), method, base: order[0]!.base, prs, merged: 0, auto: false, updatedAt: null, state: { kind: "waiting", why: "Queued" } };
		this.#merges = [...this.#merges, merge];
		this.#changed();
		// The first step runs at once on whichever server queued it, so a pull request GitHub merges now merges with the click.
		await this.#step(merge.id);
	}

	async #cancel(id: string): Promise<void> {
		const merge = this.#merges.find(candidate => candidate.id === id);
		if (!merge) return;
		this.#merges = this.#merges.filter(candidate => candidate !== merge);
		this.#changed();
		const [pr] = merge.prs;
		if (!merge.auto || !pr) return;
		// The merge is gone either way; an auto-merge left armed only merges what the user already confirmed.
		await this.#deps.github
			.status(pr)
			.then(status => (status.autoArmed ? this.#deps.github.disarm(status.id) : undefined))
			.catch((error: unknown) => console.error(`omp-agents: cannot turn off auto-merge of ${pullRequestName(pr)}: ${errorText(error)}`));
	}

	/** Takes merge `id`'s next step, and the steps after it that need no wait, such as the next of a stack once one merges. */
	async #step(id: string): Promise<void> {
		for (let steps = 0; steps < STEPS_PER_LOOK; steps++) {
			const merge = this.#merges.find(candidate => candidate.id === id);
			const pr = merge?.prs[0];
			if (!merge || !pr || merge.state.kind === "failed") return;
			const { github } = this.#deps;
			let status: MergeStatus;
			try {
				status = await github.status(pr);
			} catch (error) {
				// A read that fails, such as offline, is tried again at the next tick.
				this.#update(id, { state: { kind: "waiting", why: `Cannot read ${pullRequestName(pr)}: ${errorText(error)}` } });
				return;
			}
			const step = nextStep(merge, status, this.#deps.now());
			try {
				switch (step.kind) {
					case "wait":
						this.#update(id, { state: { kind: "waiting", why: step.why } });
						return;
					case "fail":
						this.#update(id, { state: { kind: "failed", why: step.why } });
						return;
					case "merged":
						this.#merged(merge, pr);
						continue;
					case "merge":
						await github.merge(status.id, merge.method, pr.head);
						this.#merged(merge, pr);
						continue;
					case "retarget":
						await github.retarget(status.id, merge.base);
						this.#update(id, { state: { kind: "waiting", why: `Retargeted onto ${merge.base}` } });
						continue;
					case "ready":
						await github.ready(status.id);
						this.#update(id, { state: { kind: "waiting", why: "Marked ready for review" } });
						continue;
					case "update":
						await github.update(status.id, pr.head);
						this.#update(id, { updatedAt: this.#deps.now(), state: { kind: "waiting", why: "Updating the branch" } });
						return;
					case "adopt":
						this.#update(id, { prs: [{ ...pr, head: status.head }, ...merge.prs.slice(1)] });
						continue;
					case "arm":
						await github.arm(status.id, merge.method, pr.head);
						this.#update(id, { auto: true, state: { kind: "waiting", why: "GitHub merges it once it is ready" } });
						return;
					default: {
						const unhandled: never = step;
						return unhandled;
					}
				}
			} catch (error) {
				this.#update(id, { state: { kind: "failed", why: `GitHub refused to ${step.kind} ${pullRequestName(pr)}: ${errorText(error)}` } });
				return;
			}
		}
	}

	/** `pr`, the first of `merge`, merged: the next one of a stack is under way, or the merge is done and leaves the list. */
	#merged(merge: QueuedMerge, pr: QueuedPullRequest): void {
		const rest = merge.prs.filter(other => !samePullRequest(other, pr));
		if (rest.length === 0) {
			this.#merges = this.#merges.filter(candidate => candidate.id !== merge.id);
			this.#changed();
		} else this.#update(merge.id, { prs: rest, merged: merge.merged + 1, auto: false, updatedAt: null, state: { kind: "waiting", why: `Merged #${pr.number}` } });
		this.#deps.onMerged(pr);
	}

	#update(id: string, change: Partial<Omit<QueuedMerge, "id">>): void {
		let changed = false;
		this.#merges = this.#merges.map(merge => {
			if (merge.id !== id) return merge;
			const next = { ...merge, ...change };
			changed = JSON.stringify(next) !== JSON.stringify(merge);
			return changed ? next : merge;
		});
		if (changed) this.#changed();
	}

	#changed(): void {
		this.#file?.save(this.#merges);
		this.#deps.onChange();
	}
}
