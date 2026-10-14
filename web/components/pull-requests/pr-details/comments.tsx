/** A pull request's Comments tab: its review threads, open ones first, to reply to and resolve, then its conversation and a box to comment. */
import { Check, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { MAX_COMMENT_BODY, type PullRequestDetail, type PullRequestThread } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "../../../api";
import { openThreads, withThreadResolved } from "../../../pull-requests-model";
import { chordLabel } from "../../../shortcuts";
import { FoldButton } from "../../fold";
import { ERROR_TEXT, isSubmitChord, type Submit } from "../../form-dialog";
import { DetailSection, Markdown } from "../../sheet-details";
import { EventBody, Message, ThreadPlace } from "../pr-timeline";
import type { SavePullRequest, SendPullRequest } from "../pr-fields";

/** A text box that sends its draft with its button or Cmd+Enter, and keeps the draft, with the reason, when GitHub refuses it. */
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

/** A review thread: where it sits, Resolve or Unresolve, every comment, and a reply box. */
function ThreadCard({ detail, thread, save, send }: ThreadProps) {
	const toggle = (): void => save({ field: "thread", id: thread.id, resolved: !thread.resolved }, withThreadResolved(detail, thread.id, !thread.resolved));
	return (
		<li className="rounded-md border border-border">
			<div className="flex min-h-9 items-center gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
				<ThreadPlace detail={detail} thread={thread} />
				{(thread.resolved ? thread.can.unresolve : thread.can.resolve) && (
					<Button variant="ghost" size="compact" className="ml-auto shrink-0" leadingIcon={thread.resolved ? RotateCcw : Check} onClick={toggle}>
						{thread.resolved ? "Unresolve" : "Resolve"}
					</Button>
				)}
			</div>
			<ul>
				{thread.comments.map((comment, index) => (
					<Message key={index} author={comment.author} at={comment.at}>
						<Markdown text={comment.body} />
					</Message>
				))}
			</ul>
			{thread.can.reply && (
				<div className="px-2 pb-2">
					<Composer label="Reply" placeholder="Reply…" onSend={body => send({ field: "reply", thread: thread.id, body })} />
				</div>
			)}
		</li>
	);
}

interface CommentsProps {
	detail: PullRequestDetail;
	save: SavePullRequest;
	send: SendPullRequest;
}

export function Comments({ detail, save, send }: CommentsProps) {
	const [resolvedOpen, setResolvedOpen] = useState(false);
	const resolvedId = useId();
	const open = openThreads(detail);
	const resolved = detail.threads.filter(thread => thread.resolved);
	const conversation = detail.conversation.filter(event => event.body.trim() !== "");
	const card = (thread: PullRequestThread) => <ThreadCard key={thread.id} detail={detail} thread={thread} save={save} send={send} />;
	return (
		<div className="space-y-6">
			<DetailSection
				title={
					<>
						Review threads <span className="tabular-nums">{open.length}</span>
					</>
				}
			>
				{open.length === 0 ? <p className="text-sm text-muted-foreground">No open review threads.</p> : <ul className="space-y-3">{open.map(card)}</ul>}
				{resolved.length > 0 && (
					<div className="space-y-2">
						<FoldButton open={resolvedOpen} onToggle={() => setResolvedOpen(value => !value)} controls={resolvedId} className="text-xs text-muted-foreground">
							{resolved.length} resolved
						</FoldButton>
						{resolvedOpen && (
							<ul id={resolvedId} className="space-y-3">
								{resolved.map(card)}
							</ul>
						)}
					</div>
				)}
			</DetailSection>
			<DetailSection title="Conversation">
				{conversation.length === 0 ? (
					<p className="text-sm text-muted-foreground">No comments yet.</p>
				) : (
					<ul>
						{conversation.map((event, index) => (
							<Message key={index} author={event.author} at={event.at}>
								<EventBody event={event} />
							</Message>
						))}
					</ul>
				)}
				{detail.canComment && <Composer label="Comment" placeholder="Leave a comment…" onSend={body => send({ field: "comment", body })} />}
			</DetailSection>
		</div>
	);
}
