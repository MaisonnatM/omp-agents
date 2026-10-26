/**
 * A pull request's changes page reads its files from REST (up to GitHub's 3000), viewed states from GraphQL, and
 * full text by the listed blob id. A selected commit must belong to the pull request.
 */
import { createCache } from "./cache";
import { dataOf, FILE_STATUS, ghGraphql, ghRest } from "./github";
import { isObject, num, str } from "./json";
import { type ChangedEntry, type ChangedFileText, fileText, MAX_CHANGED_FILE_BYTES, patchRows } from "./shared/changes";
import { type PullRequest, type PullRequestChanges, type PullRequestViewedState, prKey } from "./shared/github";
import { orderPullRequestFiles } from "./pull-request-order";

/** A file of the list with what its read needs: GitHub's patch and the blob it names at the head. */
export type ListedFile = ChangedEntry & {
	/** Empty for a file whose lines did not change, as for a pure rename; `null` when GitHub sends none for a changed one. */
	patch: string | null;
	sha: string;
};

/** GitHub's reason for an answer that is not what was asked, as the REST API words an error. */
const refusal = (answer: unknown): Error => new Error((isObject(answer) && str(answer.message)) || "GitHub answered something other than the pull request");

/** The files in `gh api --paginate --slurp`'s answer for `pulls/<n>/files`: one array per page. */
export function parseFilesAnswer(answer: unknown): ListedFile[] {
	if (!Array.isArray(answer)) throw refusal(answer);
	return answer.flatMap(page => {
		if (!Array.isArray(page)) throw refusal(page);
		return page.flatMap((file): ListedFile[] => {
			if (!isObject(file)) return [];
			const path = str(file.filename);
			const sha = str(file.sha);
			if (!path || !sha) return [];
			const added = num(file.additions) ?? 0;
			const removed = num(file.deletions) ?? 0;
			const patch = str(file.patch) ?? (added + removed === 0 ? "" : null);
			return [{ path, status: FILE_STATUS[str(file.status) ?? ""] ?? "modified", added, removed, session: false, patch, sha }];
		});
	});
}

/** The files in `gh api --paginate --slurp`'s answer for `commits/<oid>`: one commit, with its `files`, per page. */
export function parseCommitFilesAnswer(answer: unknown): ListedFile[] {
	if (!Array.isArray(answer)) throw refusal(answer);
	return parseFilesAnswer(answer.map(page => {
		if (!isObject(page) || !Array.isArray(page.files)) throw refusal(page);
		return page.files;
	}));
}

/** Where the files of `pr`, or of one of its commits, are listed, and how to read that answer. */
function filesRead(pr: PullRequest, commit: string | undefined): { url: string; parse: (answer: unknown) => ListedFile[] } {
	const repo = `repos/${pr.owner}/${pr.repo}`;
	return commit === undefined ? { url: `${repo}/pulls/${pr.number}/files?per_page=100`, parse: parseFilesAnswer } : { url: `${repo}/commits/${commit}?per_page=100`, parse: parseCommitFilesAnswer };
}

const VIEWED_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
	repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
		files(first: 100, after: $endCursor) { nodes { path viewerViewedState } pageInfo { hasNextPage endCursor } }
	} }
}`;

export function parseViewedAnswer(answer: unknown): Map<string, PullRequestViewedState> {
	if (!Array.isArray(answer)) throw refusal(answer);
	const states = new Map<string, PullRequestViewedState>();
	for (const page of answer) {
		const data = dataOf(page);
		const pull = isObject(data.repository) && isObject(data.repository.pullRequest) ? data.repository.pullRequest : null;
		if (!pull || !isObject(pull.files) || !Array.isArray(pull.files.nodes)) throw refusal(page);
		for (const file of pull.files.nodes) {
			if (!isObject(file) || typeof file.path !== "string") continue;
			if (file.viewerViewedState === "VIEWED" || file.viewerViewedState === "UNVIEWED" || file.viewerViewedState === "DISMISSED") states.set(file.path, file.viewerViewedState);
		}
	}
	return states;
}

export class InvalidPullRequestCommit extends Error {}

/** Refuses a commit that is not one of `pr`'s, so a commit scope reads nothing outside the pull request. */
async function requireCommit(pr: PullRequest, commit: string): Promise<void> {
	const pages = await ghRest(`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/commits?per_page=100`, true);
	if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw refusal(pages);
	if (!pages.some(page => page.some((entry: unknown) => isObject(entry) && entry.sha === commit))) throw new InvalidPullRequestCommit(`Commit ${commit} does not belong to ${prKey(pr)}`);
}

/** The title and branches in `gh api`'s answer for `pulls/<n>`. */
export function parsePullAnswer(answer: unknown): Omit<PullRequestChanges, "files"> {
	const title = isObject(answer) ? str(answer.title) : undefined;
	const head = isObject(answer) && isObject(answer.head) ? str(answer.head.ref) : undefined;
	const base = isObject(answer) && isObject(answer.base) ? str(answer.base.ref) : undefined;
	if (title === undefined || head === undefined || base === undefined) throw refusal(answer);
	return { title, head, base };
}

const lists = createCache<{ pull: Omit<PullRequestChanges, "files">; files: ListedFile[] }>();

function listed(pr: PullRequest, fresh = false, commit?: string) {
	return lists.get(
		`${prKey(pr)}:${commit ?? "all"}`,
		async () => {
			const read = filesRead(pr, commit);
			const [pull, pages] = await Promise.all([
				ghRest(`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`),
				ghRest(read.url, true),
				commit === undefined ? null : requireCommit(pr, commit),
			]);
			return { pull: parsePullAnswer(pull), files: orderPullRequestFiles(read.parse(pages)) };
		},
		fresh,
	);
}

/** The pull request's changes, or one of its commits, with the viewer's viewed states, refreshed for the file reads that follow. */
export async function listPullRequestChanges(pr: PullRequest, commit?: string): Promise<PullRequestChanges> {
	const [{ pull, files }, viewed] = await Promise.all([listed(pr, true, commit), ghGraphql(VIEWED_QUERY, { owner: pr.owner, repo: pr.repo, number: pr.number }, true)]);
	const states = parseViewedAnswer(viewed);
	return {
		...pull,
		files: files.map(({ patch: _patch, sha: _sha, ...entry }) => {
			const state = states.get(entry.path);
			return state === undefined ? entry : { ...entry, viewed: state };
		}),
	};
}

const BLOB_QUERY = `query($owner: String!, $repo: String!, $oid: GitObjectID!) {
	repository(owner: $owner, name: $repo) { object(oid: $oid) { ... on Blob { byteSize isBinary isTruncated text } } }
}`;

/** The text in `gh api graphql`'s answer to `BLOB_QUERY`, or why it does not show. */
export function parseBlobAnswer(answer: unknown): { text: string } | { note: string } {
	const data = dataOf(answer);
	const blob = isObject(data.repository) && isObject(data.repository.object) ? data.repository.object : {};
	const size = num(blob.byteSize);
	if (size !== undefined && size > MAX_CHANGED_FILE_BYTES) return { note: `Too large to show: ${Math.round(size / 1024)} KB` };
	if (blob.isBinary === true) return { note: "Binary file" };
	const text = str(blob.text);
	// A submodule names a commit of another repository, which this one does not hold.
	return text === undefined || blob.isTruncated === true ? { note: "GitHub has no text for this file" } : { text };
}

/**
 * The file of `pr`'s list at `path`, with every line of its diff; `null` when the list holds no such path. The blob is
 * read by the id the list names, so its text is the one the patch was made against even after a later push.
 */
export async function readPullRequestFile(pr: PullRequest, path: string, commit?: string): Promise<ChangedFileText | null> {
	const file = (await listed(pr, false, commit)).files.find(entry => entry.path === path);
	if (!file) return null;
	if (file.patch === null) return fileText(path, null, "GitHub shows no diff for this file: it is binary or its diff is too large");
	// GitHub names no blob at the head for a removed file, and its patch holds every line.
	if (file.status === "deleted") return file.patch ? fileText(path, patchRows(file.patch, "")) : fileText(path, null, "Deleted; GitHub shows no lines for it");
	const head = parseBlobAnswer(await ghGraphql(BLOB_QUERY, { owner: pr.owner, repo: pr.repo, oid: file.sha }));
	return "text" in head ? fileText(path, patchRows(file.patch, head.text)) : fileText(path, null, head.note);
}
