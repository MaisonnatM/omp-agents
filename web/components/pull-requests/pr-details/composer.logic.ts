import type { PullRequestDetail } from "../../../../src/shared/github";
import { canSubmitReview, type ReviewVerdict } from "../../../../src/shared/review-drafts";

/** The verdicts you may review with: none once it merged or closed, and only a comment on your own. */
export function reviewVerdicts(detail: Pick<PullRequestDetail, "state" | "byViewer">): ReviewVerdict[] {
	if (detail.state !== "open" && detail.state !== "draft") return [];
	return detail.byViewer ? ["comment"] : ["comment", "approve", "request-changes"];
}

/** The floating button's name: a review with its pending line comments counted, or a comment. */
export function composerLabel({ pending, reviewStarted }: { pending: number; reviewStarted: boolean }): string {
	if (pending > 0) return `Review pull request, ${pending} ${pending === 1 ? "comment" : "comments"} pending`;
	return reviewStarted ? "Review pull request" : "Comment on pull request";
}

/** The summary box's placeholder, which says what `verdict` still needs. */
export function reviewPlaceholder(verdict: ReviewVerdict, lineComments: number): string {
	if (canSubmitReview(verdict, "", lineComments)) return "Summarize your review (optional)";
	return verdict === "request-changes" ? "Summarize your review (required to request changes)" : "Summarize your review or add line comments";
}
