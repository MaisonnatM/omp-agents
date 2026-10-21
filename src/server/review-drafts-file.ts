/** The review drafts and the sessions that review each pull request, saved in `review-drafts.json`. */
import { ReducerFile } from "../fs";
import { arrayOf, isObject } from "../json";
import { applyReviewDraft, isReviewDraft, isReviewer, NO_REVIEW_DRAFTS, type ReviewDraftChange, type ReviewDraftState } from "../shared/review-drafts";

const isDrafts = arrayOf(isReviewDraft);
const isReviewers = arrayOf(isReviewer);

export class ReviewDraftsFile extends ReducerFile<ReviewDraftState, [ReviewDraftChange]> {
	constructor(path: string) {
		super(path, {
			parse: value => (isObject(value) && isDrafts(value.drafts) && isReviewers(value.reviewers) ? { drafts: value.drafts, reviewers: value.reviewers } : null),
			holds: "a list of review drafts",
			empty: NO_REVIEW_DRAFTS,
			reduce: applyReviewDraft,
			// A server on another port saves its own Review sessions' drafts here too.
			shared: true,
		});
	}
}
