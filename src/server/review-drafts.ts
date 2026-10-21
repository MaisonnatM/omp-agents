/**
 * The review drafts on the server: the `save_review_draft` tool a Review session gets, bound to its pull request and
 * served over omp's RPC like a project's tools; the page's edits; and the post of a draft as one GitHub review, at most
 * once, however often it is asked.
 */
import type { RpcHostTool } from "../omp/modules";
import { MAX_COMMENT_BODY, type PullRequest, prKey, pullRequestName } from "../shared/github";
import {
	postRefusal,
	REVIEW_DRAFT_TOOL,
	REVIEW_VERDICTS,
	type ReviewDraft,
	type ReviewDraftEdit,
	reviewDraftOf,
	type ReviewEvent,
	type ReviewFinding,
	type ReviewPayload,
	type ReviewPreview,
	reviewPayload,
	type ReviewVerdict,
} from "../shared/review-drafts";
import type { StartRequest } from "../shared/sessions";
import type { ReviewTarget, SubmittedComment, SubmittedReview } from "../pull-request-review";
import type { ProjectJoin } from "./project-runner";
import type { ReviewDraftsFile } from "./review-drafts-file";

/** What posting asks of GitHub. */
export interface ReviewGitHub {
	target(pr: PullRequest): Promise<ReviewTarget>;
	reviews(pr: PullRequest): Promise<SubmittedReview[]>;
	reviewComments(pr: PullRequest, reviewId: number): Promise<SubmittedComment[]>;
	viewer(): Promise<string>;
	post(pr: PullRequest, payload: ReviewPayload): Promise<{ id: number; url: string }>;
}

export interface ReviewDraftsDeps {
	file: ReviewDraftsFile;
	github: ReviewGitHub;
	now(): number;
	/** The drafts changed other than through a page's edit, which the list registry publishes itself. */
	onChange(): void;
}

/** GitHub's state of a submitted review of each event. */
const SUBMITTED: Record<ReviewEvent, string> = { APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", COMMENT: "COMMENTED" };

const COMMIT = /^[0-9a-f]{40}$/;

/** The most findings one draft holds. */
export const MAX_FINDINGS = 100;

export class ReviewDrafts {
	readonly #deps: ReviewDraftsDeps;
	/** The session id each live Review session last had, by instance id, so a switch to another id moves its binding. */
	readonly #live = new Map<string, string>();
	/** The post under way of each pull request, by key: a second click waits on it rather than posting again. */
	readonly #posting = new Map<string, Promise<ReviewDraft>>();

	constructor(deps: ReviewDraftsDeps) {
		this.#deps = deps;
	}

	get list(): ReviewDraft[] {
		return this.#deps.file.value.drafts;
	}

	/** Applies a page's edit; whether it changed anything. */
	edit(edit: ReviewDraftEdit): boolean {
		return this.#deps.file.apply(edit);
	}

	/**
	 * `join` with the review tool added for a Review start, or the resume of a session that reviews: the tool is bound to
	 * the pull request, which the session cannot change, and the session is remembered as its reviewer once it is live.
	 */
	join(request: StartRequest, join: ProjectJoin): ProjectJoin {
		const pr = this.#reviewedBy(request);
		if (!pr) return join;
		return {
			rpc: { ...join.rpc, tools: [...join.rpc.tools, this.#tool(pr)] },
			attach: session => {
				join.attach(session);
				this.#live.set(session.instanceId, session.sessionId);
				this.#deps.file.apply({ op: "bind", reviewer: { sessionId: session.sessionId, pr } });
			},
		};
	}

	/** Live session `instanceId` now runs as `sessionId`, after a `/move` or an edited prompt; a reviewer's binding follows it. */
	switched(instanceId: string, sessionId: string): void {
		const from = this.#live.get(instanceId);
		if (from === undefined || from === sessionId) return;
		this.#live.set(instanceId, sessionId);
		this.#deps.file.apply({ op: "relink", from, to: sessionId });
	}

	exited(instanceId: string): void {
		this.#live.delete(instanceId);
	}

	/** What posting the draft for `pr` sends now, against its current head and diff, and why it cannot post, if it cannot. */
	async preview(pr: PullRequest): Promise<ReviewPreview> {
		const draft = this.#draft(pr);
		const { head, lines } = await this.#deps.github.target(pr);
		return { payload: reviewPayload(draft, lines), head, refusal: postRefusal(draft, head) };
	}

	/**
	 * Posts the draft for `pr` as one review on the head it was written against, and marks it posted. A review of the
	 * signed-in user already on that commit with the same event, body, and comments is taken as this one, so a retry after
	 * a post whose answer was lost posts nothing.
	 */
	post(pr: PullRequest): Promise<ReviewDraft> {
		const key = prKey(pr);
		const running = this.#posting.get(key);
		if (running) return running;
		const posting = this.#post(pr).finally(() => this.#posting.delete(key));
		this.#posting.set(key, posting);
		return posting;
	}

	async #post(pr: PullRequest): Promise<ReviewDraft> {
		const { github, file, now } = this.#deps;
		const draft = this.#draft(pr);
		const { head, lines } = await github.target(pr);
		const refusal = postRefusal(draft, head);
		if (refusal) throw new Error(refusal);
		const payload = reviewPayload(draft, lines);
		const review = (await this.#posted(pr, payload)) ?? (await github.post(pr, payload));
		if (file.apply({ op: "posted", pr, head: draft.head, review: { id: review.id, url: review.url, at: now() } })) this.#deps.onChange();
		return this.#draft(pr);
	}

	/** The review of the signed-in user on the payload's commit that says what `payload` says, if one is there. */
	async #posted(pr: PullRequest, payload: ReviewPayload): Promise<SubmittedReview | null> {
		const { github } = this.#deps;
		const [reviews, login] = await Promise.all([github.reviews(pr), github.viewer()]);
		const candidates = reviews.filter(review => review.login === login && review.commit === payload.commit_id && review.state === SUBMITTED[payload.event] && review.body === payload.body);
		for (const candidate of candidates) {
			const comments = await github.reviewComments(pr, candidate.id);
			const same = comments.length === payload.comments.length && payload.comments.every(sent => comments.some(held => held.path === sent.path && held.body === sent.body));
			if (same) return candidate;
		}
		return null;
	}

	#draft(pr: PullRequest): ReviewDraft {
		const draft = reviewDraftOf(this.list, pr);
		if (!draft) throw new Error(`${pullRequestName(pr)} has no review draft.`);
		return draft;
	}

	/** The pull request a start reviews into a draft: a Review start's, or the one a resumed session reviewed. */
	#reviewedBy(request: StartRequest): PullRequest | null {
		if (request.kind === "new") return request.reviewDraft && request.subject?.kind === "pull-request" ? request.subject.pr : null;
		if (request.kind === "resume") return this.#deps.file.value.reviewers.find(reviewer => reviewer.sessionId === request.sessionId)?.pr ?? null;
		return null;
	}

	#tool(pr: PullRequest): RpcHostTool {
		const name = pullRequestName(pr);
		return {
			name: REVIEW_DRAFT_TOOL,
			label: "Save review draft",
			description: [
				`Save your review of ${name} as a draft the user reads in the dashboard, accepts or dismisses finding by finding, and posts on GitHub.`,
				"It never posts anything itself; do not post on GitHub in any other way either.",
				"Saving again replaces the whole draft, including what the user changed in it.",
				"`commit` is the head commit you reviewed, its full 40-character id: the review posts only while it is still the head.",
				"`line` is a line of the file at that commit; a finding on a line the diff does not show, or with a null line, goes into the review's summary instead.",
			].join(" "),
			parameters: {
				type: "object",
				properties: {
					commit: { type: "string", description: `The full id of the head commit you reviewed, from \`gh pr view ${pr.number} -R ${pr.owner}/${pr.repo} --json headRefOid\`.` },
					verdict: { type: "string", enum: [...REVIEW_VERDICTS], description: "approve, request-changes, or comment." },
					summary: { type: "string", description: "The review's body in Markdown: what the pull request does well and what must change. Requesting changes needs one." },
					findings: {
						type: "array",
						description: `At most ${MAX_FINDINGS}, each about one line or one file.`,
						items: {
							type: "object",
							properties: {
								path: { type: "string", description: "The file, relative to the repository's root." },
								line: { type: ["integer", "null"], description: "The line of the file at `commit`, or null for the file as a whole." },
								body: { type: "string", description: "The finding in Markdown, as the comment on that line." },
							},
							required: ["path", "line", "body"],
							additionalProperties: false,
						},
					},
				},
				required: ["commit", "verdict", "summary", "findings"],
				additionalProperties: false,
			},
			loadMode: "essential",
			execute: async params => {
				const draft = this.#parseDraft(pr, params);
				const replaced = reviewDraftOf(this.list, pr)?.posted === null;
				this.#deps.file.apply({ op: "save", draft });
				this.#deps.onChange();
				const findings = draft.findings.length === 1 ? "1 finding" : `${draft.findings.length} findings`;
				return `${replaced ? "Replaced" : "Saved"} the review draft of ${name}: ${draft.verdict}, ${findings}. It waits in the dashboard for the user to accept, edit, and post; do not post anything on GitHub.`;
			},
		};
	}

	/** The draft the tool's `params` describe, or the error the model reads. */
	#parseDraft(pr: PullRequest, params: Record<string, unknown>): ReviewDraft {
		const { commit, verdict, summary, findings } = params;
		if (typeof commit !== "string" || !COMMIT.test(commit)) throw new Error("commit must be the head commit's full 40-character id, in lowercase hex.");
		if (!REVIEW_VERDICTS.includes(verdict as ReviewVerdict)) throw new Error(`verdict must be one of ${REVIEW_VERDICTS.join(", ")}.`);
		if (typeof summary !== "string" || summary.length > MAX_COMMENT_BODY) throw new Error(`summary must be a string of at most ${MAX_COMMENT_BODY} characters.`);
		if (!Array.isArray(findings) || findings.length > MAX_FINDINGS) throw new Error(`findings must be a list of at most ${MAX_FINDINGS}.`);
		return {
			pr: { owner: pr.owner, repo: pr.repo, number: pr.number },
			head: commit,
			verdict: verdict as ReviewVerdict,
			summary: summary.trim(),
			findings: findings.map((finding: unknown, index): ReviewFinding => {
				const { path, line, body } = (finding ?? {}) as Record<string, unknown>;
				const at = `findings[${index}]`;
				if (typeof path !== "string" || !path.trim()) throw new Error(`${at}.path must name a file.`);
				if (line !== null && !(typeof line === "number" && Number.isSafeInteger(line) && line >= 1)) throw new Error(`${at}.line must be a line number from 1, or null.`);
				if (typeof body !== "string" || !body.trim() || body.length > MAX_COMMENT_BODY) throw new Error(`${at}.body must be text of at most ${MAX_COMMENT_BODY} characters.`);
				return { id: `f${index + 1}`, path: path.trim().replace(/^\.?\//, ""), line, body: body.trim(), state: "pending" };
			}),
			savedAt: this.#deps.now(),
			posted: null,
		};
	}
}
