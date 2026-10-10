/** A pull request's labels, review requests, and state, changed from its details through `gh`, and the choices its pickers offer. */
import { createCache } from "./cache";
import { dataOf, ghGraphql, ghRest, ghRestWrite, parsePerson } from "./github";
import { loadPullRequestDetail } from "./pull-requests";
import { isObject, str } from "./json";
import { type Person, type PullRequest, type PullRequestDetail, type PullRequestEdit, type PullRequestLabel, type PullRequestOptions, type Repo, repoKey, type SettableState } from "./shared/github";

const OPTIONS_TTL_MS = 5 * 60_000;

const options = createCache<PullRequestOptions>(OPTIONS_TTL_MS);

/** The items of every page that `ghRest(path, true)` answered. */
const itemsOf = (pages: unknown): unknown[] => (Array.isArray(pages) ? pages.flatMap(page => (Array.isArray(page) ? page : [])) : []);

/** `repo`'s labels by name and the people its reviews can be asked of by login, as GitHub lists them. */
export function loadPullRequestOptions(repo: Repo): Promise<PullRequestOptions> {
	const base = `repos/${repo.owner}/${repo.repo}`;
	return options.get(repoKey(repo), async () => {
		const [labels, assignees] = await Promise.all([ghRest(`${base}/labels?per_page=100`, true), ghRest(`${base}/assignees?per_page=100`, true)]);
		return {
			labels: itemsOf(labels)
				.flatMap((label): PullRequestLabel[] => (isObject(label) && typeof label.name === "string" ? [{ name: label.name, color: str(label.color) ?? "888888" }] : []))
				.toSorted((a, b) => a.name.localeCompare(b.name)),
			reviewers: itemsOf(assignees)
				.map(user => (isObject(user) ? parsePerson({ login: user.login, avatarUrl: user.avatar_url }) : null))
				.filter((person): person is Person => person !== null)
				.toSorted((a, b) => a.login.localeCompare(b.login)),
		};
	});
}

const STATE_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
	repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id isDraft state } }
}`;

/** A mutation that takes only the pull request's node id. */
const mutation = (name: string): string => `mutation($id: ID!) { ${name}(input: { pullRequestId: $id }) { clientMutationId } }`;

/** The mutations, in order, that take a pull request from `now` to `target`: a closed one reopens before its draft flag can change. */
export function stateSteps(now: { open: boolean; draft: boolean }, target: SettableState): string[] {
	if (target === "closed") return now.open ? ["closePullRequest"] : [];
	const steps = now.open ? [] : ["reopenPullRequest"];
	if (target === "draft" && !now.draft) steps.push("convertPullRequestToDraft");
	if (target === "open" && now.draft) steps.push("markPullRequestReadyForReview");
	return steps;
}

async function setState(pr: PullRequest, target: SettableState): Promise<void> {
	const data = dataOf(await ghGraphql(STATE_QUERY, { owner: pr.owner, repo: pr.repo, number: pr.number }));
	const node = isObject(data.repository) && isObject(data.repository.pullRequest) ? data.repository.pullRequest : null;
	const id = node && str(node.id);
	if (!node || !id) throw new Error(`GitHub has no pull request ${pr.owner}/${pr.repo}#${pr.number}`);
	if (node.state === "MERGED") throw new Error("A merged pull request keeps its state");
	for (const step of stateSteps({ open: node.state === "OPEN", draft: node.isDraft === true }, target)) dataOf(await ghGraphql(mutation(step), { id }));
}

/** Makes `edit`'s change on GitHub, then answers the pull request as GitHub has it after. */
export async function savePullRequest({ change, ...pr }: PullRequestEdit): Promise<PullRequestDetail> {
	const base = `repos/${pr.owner}/${pr.repo}`;
	switch (change.field) {
		case "label":
			if (change.on) await ghRestWrite("POST", `${base}/issues/${pr.number}/labels`, [["labels[]", change.name]]);
			else await ghRestWrite("DELETE", `${base}/issues/${pr.number}/labels/${encodeURIComponent(change.name)}`);
			break;
		case "reviewer":
			await ghRestWrite(change.on ? "POST" : "DELETE", `${base}/pulls/${pr.number}/requested_reviewers`, [["reviewers[]", change.login]]);
			break;
		case "state":
			await setState(pr, change.state);
			break;
	}
	return loadPullRequestDetail(pr, true);
}
