/** A pull request's latest conversations in a card that opens on hover, read from GitHub only while it is open. */
import { IconBubbleText } from "central-icons";
import type { ReactElement } from "react";
import { type PullRequestDetail, type PullRequestSummary } from "../../../src/shared/github";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useRead } from "../../reads";
import { latestConversations } from "../../pull-request-comments";
import { Age } from "../age";
import { LoadNote } from "../sheet-details";
import { Avatar } from "./avatars";
import { useCommentFilter } from "./pr-details/comments";
import { REVIEW_STYLE, ThreadPlace } from "./pr-details/message";
import { PullRequestMarkdown } from "./pr-markdown";

function Conversations({ pr }: { pr: PullRequestSummary }) {
	const [filter] = useCommentFilter();
	const read = useRead<PullRequestDetail>(`/api/pull-request?${new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) })}`);
	const detail = read.data;
	if (!detail) {
		return (
			<div className="px-3 py-3">
				<LoadNote loading="Asking GitHub for the comments…" error={read.error && `Cannot load the comments: ${read.error}`} />
			</div>
		);
	}
	const { visible, older, filtered } = latestConversations(detail, filter, 5);
	return (
		<>
			{visible.length === 0 ? (
				<p className="px-3 py-3 text-xs text-muted-foreground">No comments to show.</p>
			) : (
				<ol className="max-h-80 divide-y overflow-y-auto">
					{visible.map(item => {
						const [first] = item.comments;
						if (!first) return null;
						const thread = item.kind === "thread" ? item.thread : null;
						const review = item.kind === "event" ? item.event.review : null;
						const replies = (thread?.commentCount ?? 1) - 1;
						return (
							<li key={item.id} className="space-y-1 px-3 py-2.5">
								<div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
									<Avatar person={first.author} label={first.author.login} className="size-4 ring-0" />
									<span className="min-w-0 truncate font-medium text-foreground">{first.author.login}</span>
									{review && <span className={REVIEW_STYLE[review].tone}>{REVIEW_STYLE[review].label}</span>}
									{thread?.resolved ? <span>Resolved</span> : thread?.dismissed && <span>Dismissed</span>}
									<Age at={item.at} compact exact className="ml-auto shrink-0 tabular-nums" />
								</div>
								{thread && (
									<p className="text-2xs text-muted-foreground">
										<ThreadPlace detail={detail} thread={thread} />
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
					{[older > 0 && `${older} older ${older === 1 ? "conversation" : "conversations"}`, filtered > 0 && `${filtered} hidden by the Comments filter`].filter(Boolean).join(" · ")}
				</p>
			)}
		</>
	);
}

/** `children` opens a card of `pr`'s latest conversations on hover. */
export function ConversationPeek({ pr, children }: { pr: PullRequestSummary; children: ReactElement }) {
	return (
		<HoverCard openDelay={350} closeDelay={100}>
			<HoverCardTrigger asChild>{children}</HoverCardTrigger>
			<HoverCardContent side="bottom" align="start" sideOffset={6} collisionPadding={12} className="w-80 p-0" onDragStart={event => event.stopPropagation()}>
				<p className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
					<IconBubbleText aria-hidden className="size-3.5" />
					Latest comments and reviews
				</p>
				<Conversations pr={pr} />
			</HoverCardContent>
		</HoverCard>
	);
}
