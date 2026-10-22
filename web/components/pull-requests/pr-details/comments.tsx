/** Summary's **Comments**: the pull request's conversations, filtered, ordered, and paged, each thread with its replies, resolve toggle, and reply composer, then the new-comment composer. */
import { ArrowDownUp, Check, ListFilter, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { MAX_COMMENT_BODY, type PullRequestComment, type PullRequestDetail, type PullRequestEvent, type PullRequestThread } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuSwitchItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "../../../api";
import { withThreadResolved } from "../../../pull-requests-model";
import { conversationItems, decodeCommentFilter, filterConversations, pageConversations } from "../../../pull-request-comments";
import { useStoredState } from "../../../stored-state";
import { chordLabel } from "../../../shortcuts";
import { ERROR_TEXT, isSubmitChord, type Submit } from "../../form-dialog";
import { REVIEW_STYLE, ThreadPlace } from "./message";
import { PullRequestMarkdown } from "../pr-markdown";
import { Avatar } from "../avatars";
import type { SavePullRequest, SendPullRequest } from "../pr-fields";
import { SummarySection } from "./section";

function Composer({ label, placeholder, onSend }: { label: string; placeholder: string; onSend: (body: string) => Promise<void> }) {
	const [draft, setDraft] = useState("");
	const [submit, setSubmit] = useState<Submit>({ kind: "writing" });
	const sending = submit.kind === "creating";
	const ready = draft.trim() !== "" && draft.length <= MAX_COMMENT_BODY;
	const send = async (): Promise<void> => {
		if (!ready || sending) return;
		setSubmit({ kind: "creating" });
		try {
			await onSend(draft);
		} catch (err) {
			setSubmit({ kind: "failed", error: errorText(err) });
			return;
		}
		setDraft("");
		setSubmit({ kind: "writing" });
	};
	return (
		<div className="space-y-1.5">
			<textarea
				aria-label={label}
				value={draft}
				rows={2}
				placeholder={placeholder}
				readOnly={sending}
				onChange={event => setDraft(event.target.value)}
				onKeyDown={event => {
					if (!isSubmitChord(event)) return;
					event.preventDefault();
					void send();
				}}
				className="block max-h-80 min-h-14 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none [field-sizing:content] focus-visible:ring-2 focus-visible:ring-ring"
			/>
			{submit.kind === "failed" && (
				<p role="alert" className={ERROR_TEXT}>
					GitHub did not take it: {submit.error}
				</p>
			)}
			<div className="flex justify-end">
				<Tooltip content={label} shortcut={[chordLabel({ key: "Enter", mod: true })]} side="top" disabled={!ready}>
					<Button size="compact" variant="secondary" loading={sending} disabled={!ready} onClick={() => void send()}>
						{label}
					</Button>
				</Tooltip>
			</div>
		</div>
	);
}

interface ThreadProps {
	detail: PullRequestDetail;
	thread: PullRequestThread;
	save: SavePullRequest;
	send: SendPullRequest;
}

function CommentCard({ comment, detail, review, children }: { comment: PullRequestComment; detail: PullRequestDetail; review?: PullRequestEvent["review"]; children?: ReactNode }) {
	return (
		<article className="group rounded-lg border border-border/60 bg-background">
			<div className="flex flex-wrap items-center gap-2 rounded-t-lg bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
				<Avatar person={comment.author} label={comment.author.login} className="size-4" />
				<span className="font-medium text-foreground">{comment.author.login}</span>
				{review && <span className={REVIEW_STYLE[review].tone}>{REVIEW_STYLE[review].label}</span>}
				<time dateTime={new Date(comment.at).toISOString()} className="ml-auto">
					{new Date(comment.at).toLocaleDateString()}
				</time>
			</div>
			{comment.body.trim() && <PullRequestMarkdown text={comment.body} repo={detail} className="px-3 py-3" />}
			{children}
		</article>
	);
}

/** A folded conversation: who started it and why it is folded, opening it on a click. */
function FoldedBar({ author, reason, open, onToggle }: { author: string; reason: string; open: boolean; onToggle: () => void }) {
	return (
		<button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-left text-xs text-muted-foreground">
			{author}
			<span className="ml-auto">{reason}</span>
		</button>
	);
}

function ThreadCard({ detail, thread, save, send }: ThreadProps) {
	const folded = thread.resolved || thread.dismissed;
	const [open, setOpen] = useState(!folded);
	const [root, ...replies] = thread.comments;
	if (!root) return null;
	const toggle = (): void => save({ field: "thread", id: thread.id, resolved: !thread.resolved }, withThreadResolved(detail, thread.id, !thread.resolved));
	return (
		<div className="space-y-2">
			{folded && <FoldedBar author={root.author.login} reason={thread.resolved ? "Resolved" : "Dismissed"} open={open} onToggle={() => setOpen(!open)} />}
			{(!folded || open) && (
				<>
					<CommentCard comment={root} detail={detail}>
						<div className="flex items-center gap-2 px-3 pb-2 text-xs text-muted-foreground">
							<ThreadPlace detail={detail} thread={thread} />
							{(thread.resolved ? thread.can.unresolve : thread.can.resolve) && (
								<Button variant="ghost" size="xs" className="ml-auto shrink-0" leadingIcon={thread.resolved ? RotateCcw : Check} onClick={toggle}>
									{thread.resolved ? "Unresolve" : "Resolve"}
								</Button>
							)}
						</div>
					</CommentCard>
					{replies.length > 0 && (
						<div className="ml-4 space-y-2 border-l-2 border-border/60 pl-3">
							{replies.map((comment, index) => (
								<CommentCard key={comment.url ?? index} comment={comment} detail={detail} />
							))}
						</div>
					)}
					{thread.can.reply && (
						<div className="ml-4 pl-3">
							<Composer label="Reply" placeholder="Reply…" onSend={body => send({ field: "reply", thread: thread.id, body })} />
						</div>
					)}
				</>
			)}
		</div>
	);
}

function DismissedCard({ event, detail }: { event: PullRequestEvent; detail: PullRequestDetail }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="space-y-2">
			<FoldedBar author={event.author.login} reason="Review dismissed" open={open} onToggle={() => setOpen(!open)} />
			{open && <CommentCard comment={event} detail={detail} review="dismissed" />}
		</div>
	);
}

interface CommentsProps {
	detail: PullRequestDetail;
	save: SavePullRequest;
	send: SendPullRequest;
}

export function Comments({ detail, save, send }: CommentsProps) {
	const [filter, setFilter] = useStoredState("omp-agents.pr-comment-filter", decodeCommentFilter, JSON.stringify);
	const [order, setOrder] = useState<"newest" | "oldest">("newest");
	const [shown, setShown] = useState(10);
	const items = conversationItems(detail);
	const filtered = filterConversations(items, filter);
	const { visible, hidden } = pageConversations(filtered, shown, order);
	const count = items.reduce((sum, item) => sum + item.comments.length, 0);
	const hiddenComments = count - filtered.reduce((sum, item) => sum + item.comments.length, 0);
	const showRecent = (): void => setShown(10);
	const actions = (
		<div className="flex shrink-0 items-center gap-1">
			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="xs" variant="ghost-muted" aria-label="Filter comments" leadingIcon={ListFilter} />}>
					{hiddenComments ? `${hiddenComments} hidden` : "Filter"}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<MenuSwitchItem
						checked={filter.bots}
						closeOnClick={false}
						onCheckedChange={bots => {
							setFilter(value => ({ ...value, bots }));
							showRecent();
						}}
					>
						Bot comments
					</MenuSwitchItem>
					<MenuSwitchItem
						checked={filter.resolved}
						closeOnClick={false}
						onCheckedChange={resolved => {
							setFilter(value => ({ ...value, resolved }));
							showRecent();
						}}
					>
						Resolved or dismissed
					</MenuSwitchItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Button
				size="xs"
				variant="ghost-muted"
				leadingIcon={ArrowDownUp}
				aria-label={order === "newest" ? "Show oldest comments first" : "Show newest comments first"}
				onClick={() => setOrder(order === "newest" ? "oldest" : "newest")}
			>
				<span className="@max-[30rem]/pr:sr-only">{order === "newest" ? "Newest first" : "Oldest first"}</span>
			</Button>
		</div>
	);
	const older = hidden > 0 && (
		<Button size="xs" variant="outline" className="w-full" onClick={() => setShown(shown + 10)}>
			Show {Math.min(hidden, 10)} older conversations ({hidden} hidden)
		</Button>
	);
	return (
		<SummarySection title={`Comments (${count})`} actions={actions}>
			<div className="space-y-3">
				{items.length === 0 ? (
					<p className="py-2 text-xs text-muted-foreground">No comments yet.</p>
				) : filtered.length === 0 ? (
					<p className="py-2 text-xs text-muted-foreground">All {hiddenComments} comments are hidden by the filter.</p>
				) : (
					<>
						{order === "oldest" && older}
						{visible.map(item =>
							item.kind === "thread" ? (
								<ThreadCard key={item.id} thread={item.thread} detail={detail} save={save} send={send} />
							) : item.event.review === "dismissed" ? (
								<DismissedCard key={item.id} event={item.event} detail={detail} />
							) : (
								<CommentCard key={item.id} comment={item.event} detail={detail} review={item.event.review} />
							),
						)}
						{order === "newest" && older}
						{shown > 10 && (
							<Button size="xs" variant="ghost" className="w-full" onClick={showRecent}>
								Show only 10 recent conversations
							</Button>
						)}
					</>
				)}
				{detail.canComment && <Composer label="Comment" placeholder="Leave a comment…" onSend={body => send({ field: "comment", body })} />}
			</div>
		</SummarySection>
	);
}
