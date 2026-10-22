/** What Comments and the Timeline both draw of a pull request's messages: the message row, a comment's or review's words, a review's verdict, and a thread's place. */
import type { ReactNode } from "react";
import type { Person, PullRequestDetail, PullRequestEvent, PullRequestThread } from "../../../../src/shared/github";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { hashForPullRequestFiles } from "../../../routing";
import { Markdown } from "../../sheet-details";
import { Avatar } from "../avatars";

const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

/** Each review state's words, the background of its pill in **Comments**, and the text color its pill and its Timeline verdict share. */
export const REVIEW_STYLE: Record<NonNullable<PullRequestEvent["review"]>, { label: string; pill: string; tone: string }> = {
	approved: { label: "Approved", pill: "bg-success/10", tone: "text-success-foreground" },
	"changes-requested": { label: "Requested changes", pill: "bg-destructive/10", tone: "text-destructive-foreground" },
	commented: { label: "Reviewed", pill: "bg-muted", tone: "text-muted-foreground" },
	dismissed: { label: "Review dismissed", pill: "bg-muted", tone: "text-muted-foreground" },
};

/** One message of a Slack-like list: the author's picture, name, and time over `children`. */
export function Message({ author, at, children }: { author: Person; at: number; children: ReactNode }) {
	return (
		<li className="flex gap-3 px-2 py-2 hover:bg-muted/40">
			<Avatar person={author} label={author.login} className="size-9 rounded-md ring-0 [&_img]:rounded-md" />
			<div className="min-w-0 flex-1 space-y-1">
				<p className="flex items-baseline gap-2">
					<span className="text-sm font-semibold">{author.login}</span>
					<Tooltip content={new Date(at).toLocaleString()}>
						<span className="text-xs text-muted-foreground">{TIME.format(at)}</span>
					</Tooltip>
				</p>
				{children}
			</div>
		</li>
	);
}

/** A comment's or a review's words, after the review's verdict as a pill. */
export function EventBody({ event }: { event: PullRequestEvent }) {
	const style = event.review && REVIEW_STYLE[event.review];
	return (
		<>
			{style && <span className={cn("inline-block rounded px-1.5 py-0.5 text-xs font-medium", style.pill, style.tone)}>{style.label}</span>}
			{event.body.trim() && <Markdown text={event.body} />}
		</>
	);
}

/** Where a review thread sits, `path:line`, linked to that file in the Code tab. */
export function ThreadPlace({ detail, thread }: { detail: PullRequestDetail; thread: PullRequestThread }) {
	return (
		<a href={hashForPullRequestFiles(detail, thread.path)} className="min-w-0 font-mono break-all hover:text-foreground hover:underline">
			{thread.path}
			{thread.line !== null && `:${thread.line}`}
		</a>
	);
}
