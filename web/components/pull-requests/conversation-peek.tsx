/** A pull request's latest conversations in a card that opens on hover, read from GitHub only while it is open. */
import { MessageSquare } from "lucide-react";
import type { ReactElement } from "react";
import { type PullRequestDetail, type PullRequestSummary } from "../../../src/shared/github";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useRead } from "../../reads";
import { latestConversations } from "../../pull-request-comments";
import { Age } from "../age";
import { Spinner } from "../spinner";
import { Avatar } from "./avatars";
import { useCommentFilter } from "./pr-details/comments";
import { REVIEW_STYLE } from "./pr-details/message";
import { PullRequestMarkdown } from "./pr-markdown";

function Conversations({ pr }: { pr: PullRequestSummary }) {
	const [filter] = useCommentFilter();
	const read = useRead<PullRequestDetail>(`/api/pull-request?${new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) })}`);
	const detail = read.data;
	if (!detail) {
		return (
			<p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
				{read.error ? `Could not read the comments: ${read.error}` : <><Spinner size={14} /> Reading comments…</>}
			</p>
		);
	}
	const { visible, older, filtered } = latestConversations(detail, filter, 5);
	return (
		<>
			{visible.length === 0 ? (
				<p className="px-3 py-3 text-xs text-muted-foreground">No comments to show.</p>
			) : (
				<ol className="divide-y">
					{visible.map(item => {
						const [first] = item.comments;
						if (!first) return null;
						const review = item.kind === "event" ? item.event.review : null;
						const replies = item.kind === "thread" ? item.thread.commentCount - 1 : 0;
						return (
							<li key={item.id} className="space-y-1 px-3 py-2.5">
								<div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
									<Avatar person={first.author} label={first.author.login} className="size-4 ring-0" />
									<span className="min-w-0 truncate font-medium text-foreground">{first.author.login}</span>
									{review && <span className={REVIEW_STYLE[review].tone}>{REVIEW_STYLE[review].label}</span>}
									{item.kind === "thread" && item.thread.resolved && <span>Resolved</span>}
									<Age at={item.at} compact exact className="ml-auto shrink-0 tabular-nums" />
								</div>
								{item.kind === "thread" && (
									<p className="truncate font-mono text-[11px] text-muted-foreground">
										{item.thread.path}
										{item.thread.line !== null && `:${item.thread.line}`}
									</p>
								)}
								{first.body.trim() && <PullRequestMarkdown text={first.body} repo={detail} className="line-clamp-3 text-xs" />}
								{replies > 0 && <p className="text-xs text-muted-foreground">{replies} {replies === 1 ? "reply" : "replies"}</p>}
							</li>
						);
					})}
				</ol>
			)}
			{(older > 0 || filtered > 0) && (
				<p className="border-t px-3 py-2 text-xs text-muted-foreground">
					{[older > 0 && `${older} older`, filtered > 0 && `${filtered} hidden by the Comments filter`].filter(Boolean).join(" · ")}
				</p>
			)}
		</>
	);
}

/** `children` opens a card of `pr`'s latest conversations on hover. */
export function ConversationPeek({ pr, children }: { pr: PullRequestSummary; children: ReactElement }) {
	return (
		<HoverCard openDelay={300} closeDelay={150}>
			<HoverCardTrigger asChild>{children}</HoverCardTrigger>
			<HoverCardContent side="bottom" align="start" sideOffset={8} collisionPadding={12} className="w-80 p-0" onClick={event => event.stopPropagation()}>
				<p className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
					<MessageSquare aria-hidden className="size-3.5" />
					Latest comments
				</p>
				<div className="max-h-96 overflow-y-auto">
					<Conversations pr={pr} />
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}
