/**
 * Merging a pull request on GitHub: the merge itself, the steps a merge that waits until it is ready takes (update the
 * branch, retarget it, mark it ready, arm auto-merge), and the reads that say which step comes next.
 */
import { dataOf, ghGraphql, ghMutation, mergeStateOf, STATUS } from "./github";
import { isObject, str } from "./json";
import { type CheckState, type MergeState, type PullRequest, pullRequestName, prKey, type UpdateMethod } from "./shared/github";
import type { MergeMethod } from "./shared/source-control";

/** Where a pull request stands for a merge, read live. */
export interface MergeStatus {
	/** GitHub's node id, which every mutation names. */
	id: string;
	state: "open" | "merged" | "closed";
	draft: boolean;
	/** Its head branch, the head commit, and the branch it merges into. */
	branch: string;
	head: string;
	base: string;
	title: string;
	mergeState: MergeState;
	checks: CheckState;
	/** The head commit's parents: a branch GitHub updated has a merge commit whose first parent is the head before. */
	parents: string[];
	/** Whether GitHub's auto-merge is armed on it. */
	autoArmed: boolean;
	/** Whether its repository allows auto-merge. */
	autoAllowed: boolean;
}

const STATUS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
	repository(owner: $owner, name: $repo) { autoMergeAllowed pullRequest(number: $number) {
		id title state isDraft headRefName headRefOid baseRefName mergeStateStatus autoMergeRequest { enabledAt }
		commits(last: 1) { nodes { commit { parents(first: 2) { nodes { oid } } statusCheckRollup { state } } } }
	} }
}`;

const PR_STATE: Record<string, MergeStatus["state"]> = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };

/** The status in `gh api graphql`'s answer to `STATUS_QUERY`; throws when GitHub has no such pull request. */
export function parseMergeStatus(answer: unknown, pr: PullRequest): MergeStatus {
	const data = dataOf(answer);
	const repository = isObject(data.repository) ? data.repository : {};
	const node = isObject(repository.pullRequest) ? repository.pullRequest : null;
	const [id, title, branch, head, base] = [node?.id, node?.title, node?.headRefName, node?.headRefOid, node?.baseRefName].map(str);
	const state = PR_STATE[str(node?.state) ?? ""];
	if (!node || !id || title === undefined || !branch || !head || !base || !state) throw new Error(`GitHub has no pull request ${pullRequestName(pr)}`);
	const commits = isObject(node.commits) && Array.isArray(node.commits.nodes) ? node.commits.nodes : [];
	const commit = isObject(commits[0]) && isObject(commits[0].commit) ? commits[0].commit : {};
	const rollup = isObject(commit.statusCheckRollup) ? str(commit.statusCheckRollup.state) : undefined;
	return {
		id,
		state,
		draft: node.isDraft === true,
		branch,
		head,
		base,
		title,
		mergeState: mergeStateOf(node.mergeStateStatus),
		checks: STATUS[rollup ?? ""] ?? "none",
		parents: isObject(commit.parents) && Array.isArray(commit.parents.nodes) ? commit.parents.nodes.flatMap(parent => (isObject(parent) && typeof parent.oid === "string" ? [parent.oid] : [])) : [],
		autoArmed: isObject(node.autoMergeRequest),
		autoAllowed: repository.autoMergeAllowed === true,
	};
}

export async function readMergeStatus(pr: PullRequest): Promise<MergeStatus> {
	return parseMergeStatus(await ghGraphql(STATUS_QUERY, { owner: pr.owner, repo: pr.repo, number: pr.number }), pr);
}

const MERGE_MUTATION = `mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
	mergePullRequest(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head }) { clientMutationId }
}`;

/** Merges pull request `id` with `method`, only while its head is still `head`. */
export async function mergePullRequest(id: string, method: MergeMethod, head: string): Promise<void> {
	await ghMutation(MERGE_MUTATION, { id, method: method.toUpperCase(), head });
}

const UPDATE_MUTATION = `mutation($id: ID!, $head: GitObjectID!, $method: PullRequestBranchUpdateMethod!) {
	updatePullRequestBranch(input: { pullRequestId: $id, expectedHeadOid: $head, updateMethod: $method }) { clientMutationId }
}`;

/** Brings the branch up to date only while its head is still `head`; GitHub writes the update after it answers. */
export async function updateBranch(id: string, head: string, method: UpdateMethod): Promise<void> {
	await ghMutation(UPDATE_MUTATION, { id, head, method: method.toUpperCase() });
}

const ARM_MUTATION = `mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
	enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head }) { clientMutationId }
}`;

/** Arms GitHub's auto-merge on pull request `id` with `method`, pinned to head `head`. */
export async function armAutoMerge(id: string, method: MergeMethod, head: string): Promise<void> {
	await ghMutation(ARM_MUTATION, { id, method: method.toUpperCase(), head });
}

/** Turns GitHub's auto-merge off on pull request `id`. */
export async function disarmAutoMerge(id: string): Promise<void> {
	await ghMutation(`mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }`, { id });
}

/** Points pull request `id` at branch `base`. */
export async function retarget(id: string, base: string): Promise<void> {
	await ghMutation(`mutation($id: ID!, $base: String!) { updatePullRequest(input: { pullRequestId: $id, baseRefName: $base }) { clientMutationId } }`, { id, base });
}

/** Marks draft pull request `id` ready for review, which a merge needs. */
export async function markReady(id: string): Promise<void> {
	await ghMutation(`mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }`, { id });
}

/** Where a pull request stands, as the cleanup after a merge needs it: its state, and its head branch and commit. */
export interface PullRequestState {
	state: MergeStatus["state"];
	branch: string;
	head: string;
}

/** The state of each of `prs`, by {@link prKey}, with one `gh api graphql` call per repository; a pull request GitHub does not answer is left out. */
export async function readPullRequestStates(prs: readonly PullRequest[]): Promise<Map<string, PullRequestState>> {
	const states = new Map<string, PullRequestState>();
	const byRepo = Map.groupBy(prs, pr => `${pr.owner}/${pr.repo}`);
	for (const group of byRepo.values()) {
		const [{ owner, repo }] = group as [PullRequest];
		const numbers = [...new Set(group.map(pr => pr.number))];
		const fields = numbers.map(number => `p${number}: pullRequest(number: ${number}) { state headRefName headRefOid }`).join("\n");
		const data = dataOf(await ghGraphql(`query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${fields} } }`, { owner, repo }));
		const repository = isObject(data.repository) ? data.repository : {};
		for (const number of numbers) {
			const node = repository[`p${number}`];
			const state = isObject(node) ? PR_STATE[str(node.state) ?? ""] : undefined;
			const branch = isObject(node) ? str(node.headRefName) : undefined;
			const head = isObject(node) ? str(node.headRefOid) : undefined;
			if (state && branch && head) states.set(prKey({ owner, repo, number }), { state, branch, head });
		}
	}
	return states;
}

/** The queue's GitHub: every step it takes, through `gh`. */
export const GITHUB_MERGES = {
	status: readMergeStatus,
	merge: mergePullRequest,
	update: updateBranch,
	arm: armAutoMerge,
	disarm: disarmAutoMerge,
	retarget,
	ready: markReady,
};
