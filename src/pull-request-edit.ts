/** A pull request's title, description, labels, review requests, state, review threads, comments, reviews, and description images, changed from the dashboard through `gh`, and the choices its pickers offer. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { createCache } from "./cache";
import { AVATAR, dataOf, ghGraphql, ghMutation, ghRest, ghRestWrite, parsePerson } from "./github";
import { runChecked } from "./proc";
import { loadPullRequestDetail } from "./pull-requests";
import { GITHUB_MERGES } from "./pull-request-merge";
import { isObject, str } from "./json";
import { type Assignee, type PullRequest, type PullRequestAttachment, type PullRequestDetail, type PullRequestEdit, type PullRequestLabel, type PullRequestOptions, type PullRequestViewedEdit, pullRequestName, type Repo, repoKey, type SettableState } from "./shared/github";
import { REVIEW_EVENTS } from "./shared/review-drafts";
import { MEDIA_FILE_TYPES, mediaExtension } from "./shared/transcript";

const OPTIONS_TTL_MS = 5 * 60_000;
/** `gh` uploads each of up to 50 images of up to 10 MB before it edits the description, so it gets longer than one API call. */
const ATTACH_TIMEOUT_MS = 180_000;

const options = createCache<PullRequestOptions>(OPTIONS_TTL_MS);

/** The items of every page that `ghRest(path, true)` answered. */
const itemsOf = (pages: unknown): unknown[] => (Array.isArray(pages) ? pages.flatMap(page => (Array.isArray(page) ? page : [])) : []);

const ASSIGNEES_QUERY = `query($owner: String!, $repo: String!, $endCursor: String) {
	repository(owner: $owner, name: $repo) { assignableUsers(first: 100, after: $endCursor) {
		nodes { login name ${AVATAR} }
		pageInfo { hasNextPage endCursor }
	} }
}`;

/** The people in `gh api graphql --paginate --slurp`'s answer to `ASSIGNEES_QUERY`, one answer per page, sorted by the name the pickers show: the profile name, else the login. */
export function parseAssigneesAnswer(answer: unknown): Assignee[] {
	return (Array.isArray(answer) ? answer : [answer])
		.flatMap(page => {
			const repository = dataOf(page).repository;
			const connection = isObject(repository) ? repository.assignableUsers : null;
			return isObject(connection) && Array.isArray(connection.nodes) ? connection.nodes : [];
		})
		.flatMap((node): Assignee[] => {
			const person = parsePerson(node);
			return person && isObject(node) ? [{ ...person, name: str(node.name) || null }] : [];
		})
		.toSorted((a, b) => (a.name ?? a.login).localeCompare(b.name ?? b.login, undefined, { sensitivity: "base" }));
}

/** `repo`'s labels by name and the people its reviews can be asked of, as GitHub lists them. */
export function loadPullRequestOptions(repo: Repo): Promise<PullRequestOptions> {
	return options.get(repoKey(repo), async () => {
		const [labels, assignees] = await Promise.all([ghRest(`repos/${repo.owner}/${repo.repo}/labels?per_page=100`, true), ghGraphql(ASSIGNEES_QUERY, { owner: repo.owner, repo: repo.repo }, true)]);
		return {
			labels: itemsOf(labels)
				.flatMap((label): PullRequestLabel[] => (isObject(label) && typeof label.name === "string" ? [{ name: label.name, color: str(label.color) ?? "888888" }] : []))
				.toSorted((a, b) => a.name.localeCompare(b.name)),
			reviewers: parseAssigneesAnswer(assignees),
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

async function nodeOf(pr: PullRequest): Promise<{ id: string; state: unknown; isDraft: unknown }> {
	const data = dataOf(await ghGraphql(STATE_QUERY, { owner: pr.owner, repo: pr.repo, number: pr.number }));
	const node = isObject(data.repository) && isObject(data.repository.pullRequest) ? data.repository.pullRequest : null;
	const id = node && str(node.id);
	if (!node || !id) throw new Error(`GitHub has no pull request ${pullRequestName(pr)}`);
	return { id, state: node.state, isDraft: node.isDraft };
}

async function setState(pr: PullRequest, target: SettableState): Promise<void> {
	const node = await nodeOf(pr);
	if (node.state === "MERGED") throw new Error("A merged pull request keeps its state");
	for (const step of stateSteps({ open: node.state === "OPEN", draft: node.isDraft === true }, target)) await ghMutation(mutation(step), { id: node.id });
}

/** A mutation that takes only a review thread's node id. */
const threadMutation = (name: string): string => `mutation($id: ID!) { ${name}(input: { threadId: $id }) { clientMutationId } }`;

const REPLY_MUTATION = `mutation($thread: ID!, $body: String!) {
	addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { clientMutationId }
}`;

/** Makes `edit`'s change on GitHub, then answers the pull request as GitHub has it after. */
export async function savePullRequest({ change, ...pr }: PullRequestEdit): Promise<PullRequestDetail> {
	const base = `repos/${pr.owner}/${pr.repo}`;
	switch (change.field) {
		case "title":
			await ghRestWrite("PATCH", `${base}/pulls/${pr.number}`, [["title", change.title]]);
			break;
		case "body":
			await ghRestWrite("PATCH", `${base}/pulls/${pr.number}`, [["body", change.body]]);
			break;
		case "update": {
			const status = await GITHUB_MERGES.status(pr);
			if (status.state !== "open") throw new Error("Only an open pull request can update its branch");
			await GITHUB_MERGES.update(status.id, status.head, change.method);
			break;
		}
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
		case "thread":
			await ghMutation(threadMutation(change.resolved ? "resolveReviewThread" : "unresolveReviewThread"), { id: change.id });
			break;
		case "reply":
			await ghMutation(REPLY_MUTATION, { thread: change.thread, body: change.body });
			break;
		case "comment":
			await ghRestWrite("POST", `${base}/issues/${pr.number}/comments`, [["body", change.body]]);
			break;
		case "review":
			await ghRestWrite("POST", `${base}/pulls/${pr.number}/reviews`, change.body.trim() ? [["event", REVIEW_EVENTS[change.verdict]], ["body", change.body]] : [["event", REVIEW_EVENTS[change.verdict]]]);
			break;
	}
	return loadPullRequestDetail(pr, true);
}

/** Marks one file viewed by the viewer, or not; the page keeps its own viewed states, so nothing is read back. */
export async function markPullRequestFileViewed({ path, on, ...pr }: PullRequestViewedEdit): Promise<void> {
	const node = await nodeOf(pr);
	await ghMutation(`mutation($id: ID!, $path: String!) {
		${on ? "markFileAsViewed" : "unmarkFileAsViewed"}(input: { pullRequestId: $id, path: $path }) { clientMutationId }
	}`, { id: node.id, path });
}

/**
 * Appends `files` to the pull request's description with `gh pr edit --attach`, which uploads each and keeps the body
 * as it was. `gh` reads an image's type from its file's extension, so each temporary file ends in its type's.
 * @throws `gh`'s last error line; when some uploads failed, `gh` still added the others.
 */
export async function attachToPullRequest({ owner, repo, number, files }: PullRequestAttachment): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "omp-agents-attach-"));
	try {
		const args = await Promise.all(
			files.map(async (file, index) => {
				const name = `${index + 1}-${file.name.replace(/[^\w.-]/g, "_")}`;
				const path = join(dir, MEDIA_FILE_TYPES[extname(name).slice(1).toLowerCase()] === file.type ? name : `${name}.${mediaExtension(file.type)}`);
				await writeFile(path, Buffer.from(file.data, "base64"));
				return ["--attach", `${path}#${file.alt}`];
			}),
		);
		await runChecked(["gh", "pr", "edit", String(number), "-R", `${owner}/${repo}`, ...args.flat()], { timeoutMs: ATTACH_TIMEOUT_MS });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
