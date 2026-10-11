/**
 * A pull request's changes page reads, live from `gh`: every file the pull request changes, from the REST API, which
 * lists up to GitHub's 3000 where GraphQL stops at 100, and each such file in full, its patch filled in from its text at
 * the head. The page names a file by the path the list gave it, and the server reads only a path the list holds.
 */
import { createCache } from "./cache";
import { dataOf, FILE_STATUS, ghGraphql, ghRest } from "./github";
import { isObject, num, str } from "./json";
import { type ChangedEntry, type ChangedFileText, MAX_CHANGED_FILE_BYTES, patchRows } from "./shared/changes";
import { type PullRequest, type PullRequestChanges, prKey } from "./shared/github";

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

/** The title and branches in `gh api`'s answer for `pulls/<n>`. */
export function parsePullAnswer(answer: unknown): Omit<PullRequestChanges, "files"> {
	const title = isObject(answer) ? str(answer.title) : undefined;
	const head = isObject(answer) && isObject(answer.head) ? str(answer.head.ref) : undefined;
	const base = isObject(answer) && isObject(answer.base) ? str(answer.base.ref) : undefined;
	if (title === undefined || head === undefined || base === undefined) throw refusal(answer);
	return { title, head, base };
}

const lists = createCache<{ changes: PullRequestChanges; files: ListedFile[] }>();

function listed(pr: PullRequest, fresh = false) {
	return lists.get(
		prKey(pr),
		async () => {
			const path = `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
			const [pull, pages] = await Promise.all([ghRest(path), ghRest(`${path}/files?per_page=100`, true)]);
			const files = parseFilesAnswer(pages);
			return { changes: { ...parsePullAnswer(pull), files: files.map(({ patch: _patch, sha: _sha, ...entry }) => entry) }, files };
		},
		fresh,
	);
}

/** `pr`'s changed files, read from GitHub anew; the file reads that follow use this answer for 30 seconds. */
export async function listPullRequestChanges(pr: PullRequest): Promise<PullRequestChanges> {
	return (await listed(pr, true)).changes;
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
export async function readPullRequestFile(pr: PullRequest, path: string): Promise<ChangedFileText | null> {
	const file = (await listed(pr)).files.find(entry => entry.path === path);
	if (!file) return null;
	const shown = (rows: ChangedFileText["rows"], note: string | null = null): ChangedFileText => ({ path, rows, note });
	if (file.patch === null) return shown(null, "GitHub shows no diff for this file: it is binary or its diff is too large");
	// GitHub names no blob at the head for a removed file, and its patch holds every line.
	if (file.status === "deleted") return file.patch ? shown(patchRows(file.patch, "")) : shown(null, "Deleted; GitHub shows no lines for it");
	const head = parseBlobAnswer(await ghGraphql(BLOB_QUERY, { owner: pr.owner, repo: pr.repo, oid: file.sha }));
	return "text" in head ? shown(patchRows(file.patch, head.text)) : shown(null, head.note);
}
