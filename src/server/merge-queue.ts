/**
 * Every merge the dashboard makes, kept in `merges.json` so it survives the page and the server: one pull request, or a
 * stack merged bottom first, each pull request retargeted onto the stack's base, marked ready, and its branch updated as
 * GitHub requires, then merged once its checks pass, by GitHub's auto-merge where the repository allows it. Only the
 * server that holds the owner lock steps the merges; each step reads where the pull request under way stands and takes
 * one step, so a restart picks up where the last server stopped. A merge stops at its first failure, with the reason,
 * until it is cancelled.
 */
import { ReducerFile } from "../fs";
import { errorText } from "../json";
import { type MergeStatus } from "../pull-request-merge";
import { mergesNow, type PullRequest, pullRequestName, repoKey } from "../shared/github";
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
	/** `merges.json`, which the servers beside each other share. */
	path: string;
	github: MergeGitHub;
	now(): number;
	newId(): string;
	/** Whether this server steps the merges: the one that holds the owner lock, so only one server changes GitHub for them. */
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
	// GitHub writes the queue's update of the branch later, as a merge of the base whose first parent is the head pinned before it.
	const updated = merge.updatedAt !== null && status.parents.length === 2 && status.parents[0] === pr.head;
	if (status.head !== pr.head) return updated ? { kind: "adopt" } : { kind: "fail", why: `${name}'s branch moved after the merge was queued; review it and merge again.` };
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

/**
 * `prs` ordered bottom first, each one's base the branch of the one before in the same repository; `null` when they do
 * not form one chain.
 */
export function stackOrder<T extends PullRequest & { branch: string; base: string }>(prs: readonly T[]): T[] | null {
	const ref = (pr: T, branch: string): string => `${repoKey(pr)}:${branch}`;
	const byBase = new Map(prs.map(pr => [ref(pr, pr.base), pr]));
	if (byBase.size !== prs.length) return null;
	const branches = new Set(prs.map(pr => ref(pr, pr.branch)));
	const bottom = prs.filter(pr => !branches.has(ref(pr, pr.base)));
	if (bottom.length !== 1) return null;
	const order = [bottom[0]!];
	for (let next = byBase.get(ref(bottom[0]!, bottom[0]!.branch)); next && order.length < prs.length; next = byBase.get(ref(next, next.branch))) order.push(next);
	return order.length === prs.length ? order : null;
}

/** A change to the list in `merges.json`. */
type QueueEdit = { op: "add"; merge: QueuedMerge } | { op: "remove"; id: string } | { op: "patch"; id: string; change: Partial<Omit<QueuedMerge, "id">> };

/** `list` after `edit`, or `list` itself when it changes nothing, such as an add of a pull request already queued. */
function applyQueueEdit(list: QueuedMerge[], edit: QueueEdit): QueuedMerge[] {
	switch (edit.op) {
		case "add":
			return edit.merge.prs.some(pr => queuedMergeOf(list, pr)) ? list : [...list, edit.merge];
		case "remove":
			return list.some(merge => merge.id === edit.id) ? list.filter(merge => merge.id !== edit.id) : list;
		case "patch": {
			const at = list.findIndex(merge => merge.id === edit.id);
			if (at < 0) return list;
			const next = { ...list[at]!, ...edit.change };
			return JSON.stringify(next) === JSON.stringify(list[at]) ? list : list.with(at, next);
		}
		default: {
			const unhandled: never = edit;
			return unhandled;
		}
	}
}

export class MergeQueue {
	readonly #deps: MergeQueueDeps;
	readonly #file: ReducerFile<QueuedMerge[], [QueueEdit]>;
	/** Adds, cancels, and ticks, one at a time, so two never step the same merge in this server. */
	readonly #lane = new SerialLane();

	constructor(deps: MergeQueueDeps) {
		this.#deps = deps;
		this.#file = new ReducerFile(deps.path, {
			parse: value => (Array.isArray(value) && value.every(isQueuedMerge) ? value : null),
			holds: "a list of queued merges",
			empty: [],
			reduce: applyQueueEdit,
		});
	}

	get list(): readonly QueuedMerge[] {
		return this.#file.value;
	}

	/** Applies `change`; answers the pull requests it merged on the way, or rejects with the reason it refuses one. */
	apply(change: MergeQueueChange): Promise<QueuedPullRequest[]> {
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

	/** Reads `merges.json` again, for what a server beside it saved, and on the server that steps them, steps every merge still waiting. */
	tick(): Promise<void> {
		return this.#lane.run(async () => {
			this.#reload();
			if (!this.#deps.active()) return;
			for (const merge of this.#file.value) if (merge.state.kind === "waiting") await this.#step(merge.id, []);
		});
	}

	async #add(method: MergeMethod, requested: (PullRequest & { head: string | null })[]): Promise<QueuedPullRequest[]> {
		if (requested.length === 0) throw new Error("Name a pull request to merge.");
		this.#reload();
		const refuseQueued = (prs: readonly PullRequest[]): void => {
			const queued = prs.find(pr => queuedMergeOf(this.#file.value, pr));
			if (queued) throw new Error(`${pullRequestName(queued)} is already queued to merge.`);
		};
		refuseQueued(requested);
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
		// A server beside this one may have queued one of them while this one read GitHub; the add then changes nothing.
		if (!this.#edit({ op: "add", merge })) refuseQueued(prs);
		const merged: QueuedPullRequest[] = [];
		// The server that steps the merges takes the first step at once, so a pull request GitHub merges now merges with the click.
		if (this.#deps.active()) await this.#step(merge.id, merged);
		return merged;
	}

	async #cancel(id: string): Promise<QueuedPullRequest[]> {
		this.#reload();
		const merge = this.#find(id);
		if (!merge || !this.#edit({ op: "remove", id })) return [];
		const [pr] = merge.prs;
		if (!merge.auto || !pr) return [];
		// The cancel is the user's own change, so the server that took it turns the auto-merge off at once, as any edit of the pull request.
		await this.#deps.github
			.status(pr)
			.then(status => (status.autoArmed ? this.#deps.github.disarm(status.id) : undefined))
			.catch((error: unknown) => console.error(`omp-agents: cannot turn off auto-merge of ${pullRequestName(pr)}: ${errorText(error)}`));
		return [];
	}

	/**
	 * Takes merge `id`'s next step, and the steps after it that need no wait, such as the next of a stack once one merges,
	 * adding each pull request it merges to `merged`. Each step reads `merges.json` first, so a merge cancelled meanwhile stops.
	 */
	async #step(id: string, merged: QueuedPullRequest[]): Promise<void> {
		for (let steps = 0; steps < STEPS_PER_LOOK; steps++) {
			this.#reload();
			const merge = this.#find(id);
			const pr = merge?.prs[0];
			if (!merge || !pr || merge.state.kind === "failed") return;
			const { github } = this.#deps;
			let status: MergeStatus;
			try {
				status = await github.status(pr);
			} catch (error) {
				// A read that fails, such as offline, is tried again at the next tick.
				this.#patch(id, { state: { kind: "waiting", why: `Cannot read ${pullRequestName(pr)}: ${errorText(error)}` } });
				return;
			}
			const step = nextStep(merge, status, this.#deps.now());
			try {
				switch (step.kind) {
					case "wait":
						this.#patch(id, { state: { kind: "waiting", why: step.why } });
						return;
					case "fail":
						this.#patch(id, { state: { kind: "failed", why: step.why } });
						return;
					case "merged":
						this.#landed(merge, pr, merged);
						continue;
					case "merge":
						await github.merge(status.id, merge.method, pr.head);
						this.#landed(merge, pr, merged);
						continue;
					case "retarget":
						await github.retarget(status.id, merge.base);
						if (!this.#patch(id, { state: { kind: "waiting", why: `Retargeted onto ${merge.base}` } })) return;
						continue;
					case "ready":
						await github.ready(status.id);
						if (!this.#patch(id, { state: { kind: "waiting", why: "Marked ready for review" } })) return;
						continue;
					case "update":
						await github.update(status.id, pr.head);
						this.#patch(id, { updatedAt: this.#deps.now(), state: { kind: "waiting", why: "Updating the branch" } });
						return;
					case "adopt":
						if (!this.#patch(id, { prs: [{ ...pr, head: status.head }, ...merge.prs.slice(1)] })) return;
						continue;
					case "arm":
						await github.arm(status.id, merge.method, pr.head);
						// Cancelled while GitHub armed it: the cancel saw nothing to turn off.
						if (!this.#patch(id, { auto: true, state: { kind: "waiting", why: "GitHub merges it once it is ready" } })) await github.disarm(status.id);
						return;
					default: {
						const unhandled: never = step;
						return unhandled;
					}
				}
			} catch (error) {
				this.#patch(id, { state: { kind: "failed", why: `GitHub refused to ${step.kind} ${pullRequestName(pr)}: ${errorText(error)}` } });
				return;
			}
		}
	}

	/** `pr`, the first of `merge`, merged: the next one of a stack is under way, or the merge is done and leaves the list. */
	#landed(merge: QueuedMerge, pr: QueuedPullRequest, merged: QueuedPullRequest[]): void {
		const rest = merge.prs.slice(1);
		if (rest.length === 0) this.#edit({ op: "remove", id: merge.id });
		else this.#patch(merge.id, { prs: rest, merged: merge.merged + 1, auto: false, updatedAt: null, state: { kind: "waiting", why: `Merged #${pr.number}` } });
		merged.push(pr);
		this.#deps.onMerged(pr);
	}

	#find(id: string): QueuedMerge | undefined {
		return this.#file.value.find(merge => merge.id === id);
	}

	/** Changes merge `id` as `merges.json` has it now; whether it is still listed, which a cancel from a server beside this one ends. */
	#patch(id: string, change: Partial<Omit<QueuedMerge, "id">>): boolean {
		this.#reload();
		if (!this.#find(id)) return false;
		this.#edit({ op: "patch", id, change });
		return true;
	}

	/** Applies `edit` to the list as the file has it; whether it changed it. */
	#edit(edit: QueueEdit): boolean {
		this.#reload();
		const changed = this.#file.apply(edit);
		if (changed) this.#deps.onChange();
		return changed;
	}

	/** Reads `merges.json` again, and tells of a change a server beside this one saved. */
	#reload(): void {
		const before = this.#file.value;
		this.#file.reload();
		if (JSON.stringify(this.#file.value) !== JSON.stringify(before)) this.#deps.onChange();
	}
}
