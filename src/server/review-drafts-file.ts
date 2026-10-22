/** The review drafts and the sessions that review each pull request, saved in `review-drafts.json`. */
import { ReducerFile } from "../fs";
import { arrayOf, isObject, parseAll } from "../json";
import { applyReviewDraft, decodeReviewDraft, isReviewer, NO_REVIEW_DRAFTS, type ReviewDraftChange, type ReviewDraftState } from "../shared/review-drafts";

const isReviewers = arrayOf(isReviewer);

export class ReviewDraftsFile extends ReducerFile<ReviewDraftState, [ReviewDraftChange]> {
	constructor(path: string) {
		super(path, {
			parse: value => {
				if (!isObject(value)) return null;
				const drafts = parseAll(value.drafts, decodeReviewDraft);
				return drafts && isReviewers(value.reviewers) ? { drafts, reviewers: value.reviewers } : null;
			},
			holds: "a list of review drafts",
			empty: NO_REVIEW_DRAFTS,
			reduce: applyReviewDraft,
			// A server on another port saves its own Review sessions' drafts here too.
			shared: true,
		});
	}
}
