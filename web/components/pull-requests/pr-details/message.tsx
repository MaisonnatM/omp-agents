/** What Summary and the Timeline both draw of a pull request's messages: each review state's label and tone, and a thread's place. */
import type { PullRequestDetail, PullRequestEvent, PullRequestThread } from "../../../../src/shared/github";
import { hashForPullRequestFiles } from "../../../routing";

/** Each review state's words and the text color its verdict shows in, in the Timeline and in Summary's comments. */
export const REVIEW_STYLE: Record<NonNullable<PullRequestEvent["review"]>, { label: string; tone: string }> = {
	approved: { label: "Approved", tone: "text-success-foreground" },
	"changes-requested": { label: "Requested changes", tone: "text-destructive-foreground" },
	commented: { label: "Reviewed", tone: "text-muted-foreground" },
	dismissed: { label: "Review dismissed", tone: "text-muted-foreground" },
};

/** Where a review thread sits, `path:line`, linked to that file in the Code tab. */
export function ThreadPlace({ detail, thread }: { detail: PullRequestDetail; thread: PullRequestThread }) {
	return (
		<a href={hashForPullRequestFiles(detail, thread.path)} className="min-w-0 font-mono break-all hover:text-foreground hover:underline">
			{thread.path}
			{thread.line !== null && `:${thread.line}`}
		</a>
	);
}
