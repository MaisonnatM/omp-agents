/** The verdict a review posts. A pull-request edit and a review draft both name it, and neither of those modules can import the other. */
export const REVIEW_VERDICTS = ["approve", "request-changes", "comment"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
