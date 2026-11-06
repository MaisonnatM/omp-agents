import { readFavicon } from "../favicon";
import { readGithubMedia } from "../github-media";
import { errorText } from "../json";
import { loadPullRequestDetail, loadPullRequestTitle } from "../pull-requests";
import { directoryOf } from "../paths";
import { attachToPullRequest, loadPullRequestOptions, markPullRequestFileViewed, savePullRequest } from "../pull-request-edit";
import { InvalidPullRequestCommit, listPullRequestChanges, readPullRequestFile } from "../pull-request-files";
import { loadPullRequestStack } from "../pull-request-stack";
import {
	type CheckedOutPullRequest,
	MAX_PULL_REQUEST_ATTACHMENTS,
	MAX_PULL_REQUEST_IMAGE_BYTES,
	type OnRebaseStep,
	type PullRequest,
	type PullRequestCheckout,
	type PullRequestRebase,
	prKey,
	type RebasedPullRequest,
	type RebaseStep,
} from "../shared/github";
import type { ReviewDraft, ReviewPreview, ReviewSubmit } from "../shared/review-drafts";
import { answer, answerSteps, checked, fail } from "./http";
import {
	MAX_QUEUED_STACK,
	parseMergeQueueChange,
	parsePullRequestAttachment,
	parsePullRequestCheckout,
	parsePullRequestEdit,
	parsePullRequestFilesQuery,
	parsePullRequestQuery,
	parsePullRequestRebase,
	parsePullRequestViewedEdit,
	parseRepoQuery,
	parseReviewDraftPost,
} from "./wire";
import type { MergeQueueAnswer, MergeQueueChange } from "../shared/merge-queue";
import type { Handler, RouteKit, Routes } from "./route-kit";

/** What the pull request routes hand on: the merge queue, through which every merge goes, review drafts, checkouts, which can start a session, and rebases, one repository at a time. */
export interface PullRequestRoutesEnv {
	/** Apply `change` to the merge queue; answers the queued merges after it and what it merged, or rejects with why it refused. */
	changeMergeQueue(change: MergeQueueChange): Promise<MergeQueueAnswer>;
	/** What posting the pull request's review draft sends now, and why it cannot post, if it cannot; rejects when there is no draft. */
	previewReviewDraft(pr: PullRequest): Promise<ReviewPreview>;
	/** Posts the pull request's review draft once, first with the composer's `submit` applied, and answers it marked posted; rejects with why it cannot. */
	postReviewDraft(pr: PullRequest, submit?: ReviewSubmit): Promise<ReviewDraft>;
	/** Checks out the pull request at its place, a worktree with a new session on it or the checkout itself; rejects with why it refused. */
	checkOutPullRequest(checkout: PullRequestCheckout): Promise<CheckedOutPullRequest>;
	/** Rebases the pull request's branch onto its base and pushes it through the repository's pre-push hook, calling `onStep` as each step starts; rejects with why it refused or failed. */
	rebasePullRequest(rebase: PullRequestRebase, onStep: OnRebaseStep): Promise<RebasedPullRequest>;
}

/** GitHub pull requests in full: details, stack, options, edits, merges that wait until they are ready, review drafts' preview and post, and their changed files. */
export function pullRequestRoutes({ get, media, write }: RouteKit, env: PullRequestRoutesEnv): Routes {
	/** A read of the pull request `?owner=&repo=&number=` names, refused with `badRequest`. */
	const pullRequestGet = (badRequest: string, read: (pr: PullRequest, params: URLSearchParams) => Promise<Response>): Handler =>
		get((params) => {
			const pr = checked(parsePullRequestQuery(params), badRequest);
			return pr instanceof Response ? pr : read(pr, params);
		});

	/** `GET /api/pull-request?owner=<o>&repo=<r>&number=<n>`: that pull request in full, for a pull request's details. */
	const pullRequest = pullRequestGet("Expected ?owner=&repo=&number=", (pr) => answer(() => loadPullRequestDetail(pr)));

	/** A bare link's PR title, without loading the full details. */
	const pullRequestTitle = pullRequestGet("Expected ?owner=&repo=&number=", (pr) => answer(() => loadPullRequestTitle(pr)));

	/** `GET /api/pull-request/stack?owner=<o>&repo=<r>&number=<n>`: the open pull requests stacked with that one, top first, for its details' Stack. */
	const pullRequestStack = pullRequestGet("Expected ?owner=&repo=&number=", (pr) => answer(() => loadPullRequestStack(pr)));

	/** Images and videos hosted by GitHub; the proxy restricts hosts and keeps the GitHub token off redirected hosts. */
	const githubMedia = media((params) => readGithubMedia(params.get("url")));
	/** The icons of the sites the Todos card's sources name; the proxy asks public HTTPS hosts only. */
	const favicon = media((params) => readFavicon(params.get("host")));

	/** `PUT /api/pull-request`: `PullRequestEdit`, made on GitHub; answers the pull request in full as it is after it. */
	const pullRequestWrite = write(
		(body) =>
			checked(
				parsePullRequestEdit(body),
				"Expected { owner, repo, number, change } with a title, description, branch update, label, reviewer, state, review thread, reply, or comment",
			),
		savePullRequest,
	);

	/** `PUT /api/pull-request/viewed`: `PullRequestViewedEdit`, one file marked viewed or not on GitHub; answers `{}`. */
	const pullRequestViewed = write(
		(body) => checked(parsePullRequestViewedEdit(body), "Expected { owner, repo, number, path, on }"),
		async (edit) => {
			await markPullRequestFileViewed(edit);
			return {};
		},
	);

	/** `PUT /api/pull-request/attachment`: `PullRequestAttachment`, whose images `gh pr edit --attach` appends to that pull request's description; answers `{}`. */
	const pullRequestAttach = write(
		(body) =>
			checked(
				parsePullRequestAttachment(body),
				`Expected { owner, repo, number, files } with 1 to ${MAX_PULL_REQUEST_ATTACHMENTS} PNG, JPEG, GIF, WebP, or SVG images, each with a name, alt text, and at most ${MAX_PULL_REQUEST_IMAGE_BYTES / 1024 / 1024} MB in base64`,
			),
		async (attachment) => {
			await attachToPullRequest(attachment);
			return {};
		},
	);

	/** `GET /api/pull-request/options?owner=<o>&repo=<r>`: the labels and reviewers that repository's pull requests can take. */
	const pullRequestOptions = get((params) => {
		const repo = checked(parseRepoQuery(params), "Expected ?owner=&repo=");
		return repo instanceof Response ? repo : answer(() => loadPullRequestOptions(repo));
	});

	const codeRefusal = (err: unknown): Response => fail(err instanceof InvalidPullRequestCommit ? 400 : 500, errorText(err));

	/** `GET /api/pull-request/files`: all changes, or `?commit=<oid>` for one commit of this pull request. */
	const pullRequestFiles = get(async (params) => {
		const pr = checked(parsePullRequestFilesQuery(params), "Expected ?owner=&repo=&number= and optional commit=<full OID>");
		if (pr instanceof Response) return pr;
		return listPullRequestChanges(pr, pr.commit)
			.then((changes) => Response.json(changes))
			.catch(codeRefusal);
	});

	/** `GET /api/pull-request/file`: a listed path's full diff, optionally scoped to `?commit=<oid>`. */
	const pullRequestFile = get(async (params) => {
		const pr = checked(parsePullRequestFilesQuery(params), "Expected ?owner=&repo=&number=&path= and optional commit=<full OID>");
		if (pr instanceof Response) return pr;
		const path = params.get("path") ?? "";
		const file = await readPullRequestFile(pr, path, pr.commit).catch(codeRefusal);
		if (file instanceof Response) return file;
		return file ? Response.json(file) : fail(404, `${prKey(pr)} changes no file ${path}`);
	});

	/** `PUT /api/merge-queue`: `MergeQueueChange`, a merge of one pull request or a stack, made at once when GitHub allows it and later otherwise, or its cancel; answers a `MergeQueueAnswer`. */
	const mergeQueue = write(
		(body) =>
			checked(
				parseMergeQueueChange(body),
				`Expected { op: add, method, prs } with 1 to ${MAX_QUEUED_STACK} pull requests, each with a head commit or null, or { op: cancel, id }`,
			),
		env.changeMergeQueue,
		(err) => fail(409, errorText(err)),
	);

	/** `GET /api/review-draft/preview?owner=<o>&repo=<r>&number=<n>`: the `ReviewPreview` of that pull request's review draft, against its head now. */
	const reviewDraftPreview = pullRequestGet("Expected ?owner=&repo=&number=", (pr) => answer(() => env.previewReviewDraft(pr)));

	/** `PUT /api/review-draft/post`: `{ owner, repo, number, submit? }`, whose review draft posts as one review; answers the draft marked posted. */
	const reviewDraftPost = write(
		(body) => checked(parseReviewDraftPost(body), "Expected { owner, repo, number, submit?: { verdict, summary } }"),
		({ pr, submit }) => env.postReviewDraft(pr, submit),
		(err) => fail(409, errorText(err)),
	);

	/** `PUT /api/pull-request/checkout`: `PullRequestCheckout`; answers a `CheckedOutPullRequest`, or 409 with why it refused. */
	const pullRequestCheckout = write(
		async (body) => {
			const checkout = checked(
				parsePullRequestCheckout(body),
				"Expected { owner, repo, number, cwd, place } with cwd an absolute directory, place worktree or here, and an optional one-word skill",
			);
			if (checkout instanceof Response) return checkout;
			const cwd = await directoryOf(checkout.cwd);
			return cwd ? { ...checkout, cwd } : fail(404, `${checkout.cwd.trim()} is not a directory.`);
		},
		env.checkOutPullRequest,
		(err) => fail(409, errorText(err)),
	);

	const rebaseWrite = write(
		async (body) => {
			const rebase = checked(parsePullRequestRebase(body), "Expected { owner, repo, number, cwd } with cwd an absolute directory");
			if (rebase instanceof Response) return rebase;
			const cwd = await directoryOf(rebase.cwd);
			return cwd ? { ...rebase, cwd } : fail(404, `${rebase.cwd.trim()} is not a directory.`);
		},
		(rebase) => answerSteps<RebaseStep, RebasedPullRequest>(step => env.rebasePullRequest(rebase, step), (err) => fail(409, errorText(err))),
	);
	/**
	 * `PUT /api/pull-request/rebase`: `PullRequestRebase`; streams `answerSteps`' NDJSON, each `RebaseStep` as it starts and
	 * then the `RebasedPullRequest` or why it failed, or answers 409 with why it refused before its first step.
	 * Its push runs the repository's pre-push hook, which can take minutes, past Bun's idle timeout, so the request has none.
	 */
	const pullRequestRebase: Handler = (req, server) => {
		server.timeout(req, 0);
		return rebaseWrite(req, server);
	};

	return {
		"/api/pull-request": { GET: pullRequest, PUT: pullRequestWrite },
		"/api/github-media": { GET: githubMedia },
		"/api/favicon": { GET: favicon },
		"/api/pull-request/attachment": { PUT: pullRequestAttach },
		"/api/pull-request/checkout": { PUT: pullRequestCheckout },
		"/api/pull-request/rebase": { PUT: pullRequestRebase },
		"/api/pull-request/viewed": { PUT: pullRequestViewed },
		"/api/merge-queue": { PUT: mergeQueue },
		"/api/review-draft/preview": { GET: reviewDraftPreview },
		"/api/review-draft/post": { PUT: reviewDraftPost },
		"/api/pull-request/title": { GET: pullRequestTitle },
		"/api/pull-request/options": { GET: pullRequestOptions },
		"/api/pull-request/stack": { GET: pullRequestStack },
		"/api/pull-request/files": { GET: pullRequestFiles },
		"/api/pull-request/file": { GET: pullRequestFile },
	};
}
