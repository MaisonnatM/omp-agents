/**
 * The floating composer over a pull request's details: a glass button that opens a popover to comment, close or reopen
 * with a comment, or review it, the Review draft's pending findings posting as its line comments.
 */
import { Check, CircleX, GitPullRequest, GitPullRequestClosed, MessageSquare, Send, Trash2, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type RefObject, useRef, useState } from "react";
import { MAX_COMMENT_BODY, type PullRequestDetail, prKey } from "../../../../src/shared/github";
import { canSubmitReview, type ReviewDraft, type ReviewVerdict } from "../../../../src/shared/review-drafts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { errorText } from "../../../../src/json";
import { putJson } from "../../../api";
import { useInlineConfirm } from "../../../use-inline-confirm";
import { useDashboardActions } from "../../dashboard-context";
import { ERROR_TEXT, isSubmitChord } from "../../form-dialog";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../../segmented-tabs";
import type { SendPullRequest } from "../pr-fields";
import { composerLabel, reviewPlaceholder, reviewVerdicts, VERDICT_LABELS } from "./composer.logic";
import { FIELD } from "./review-draft";

type Mode = "comment" | "review";

const VERDICT_ICONS: Record<ReviewVerdict, ReactNode> = {
	comment: <MessageSquare aria-hidden className="size-3" />,
	approve: <Check aria-hidden className="size-3" />,
	"request-changes": <CircleX aria-hidden className="size-3" />,
};

const TEXTAREA = cn(FIELD, "resize-none disabled:opacity-60");

interface ComposerProps {
	detail: PullRequestDetail;
	/** The pull request's unposted Review draft, whose pending findings post with the review. */
	openDraft: ReviewDraft | undefined;
	send: SendPullRequest;
	/** A review of the draft posted, which the details read again to show. */
	onDraftPosted: () => void;
}

export function PullRequestComposer({ detail, openDraft, send, onDraftPosted }: ComposerProps) {
	const { send: sendSocket } = useDashboardActions();
	const pendingIds = openDraft?.findings.filter(finding => finding.state === "pending").map(finding => finding.id) ?? [];
	const pending = pendingIds.length;
	const lineComments = openDraft?.findings.filter(finding => finding.state !== "dismissed").length ?? 0;
	const verdicts = reviewVerdicts(detail);
	const [open, setOpen] = useState(false);
	const [requestedMode, setRequestedMode] = useState<Mode>("comment");
	const [body, setBody] = useState("");
	const [summary, setSummary] = useState(openDraft?.summary ?? "");
	const [verdict, setVerdict] = useState<ReviewVerdict>(openDraft?.verdict ?? "comment");
	const [savedAt, setSavedAt] = useState(openDraft?.savedAt);
	if (openDraft?.savedAt !== savedAt) {
		setSavedAt(openDraft?.savedAt);
		if (openDraft) {
			setSummary(openDraft.summary);
			setVerdict(openDraft.verdict);
		}
	}
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const commentRef = useRef<HTMLTextAreaElement>(null);
	const reviewRef = useRef<HTMLTextAreaElement>(null);
	if (!detail.canComment) return null;
	const reviewable = verdicts.length > 0;
	const reviewStarted = pending > 0 || summary.trim() !== "";
	const mode: Mode = reviewable ? requestedMode : "comment";
	const picked = verdicts.includes(verdict) ? verdict : "comment";

	const run = async (act: () => Promise<void>): Promise<void> => {
		if (busy) return;
		setBusy(true);
		setFailure(null);
		try {
			await act();
			setOpen(false);
		} catch (err) {
			setFailure(errorText(err));
		} finally {
			setBusy(false);
		}
	};
	const comment = (then: "close" | "reopen" | null): Promise<void> =>
		run(async () => {
			await send({ field: "comment", body });
			setBody("");
			if (!then) return;
			try {
				await send({ field: "state", state: then === "close" ? "closed" : "open" });
			} catch (err) {
				throw new Error(`the comment posted, but ${then === "close" ? "closing" : "reopening"} failed: ${errorText(err)}`);
			}
		});
	const review = (): Promise<void> =>
		run(async () => {
			if (openDraft) {
				await putJson<ReviewDraft>("/api/review-draft/post", { owner: detail.owner, repo: detail.repo, number: detail.number, submit: { verdict: picked, summary } });
				onDraftPosted();
			} else await send({ field: "review", verdict: picked, body: summary });
			setSummary("");
		});

	const badge = pending > 0 && (
		<span aria-hidden className="pointer-events-none absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-info px-1 text-3xs font-semibold text-white tabular-nums">
			{pending}
		</span>
	);
	return (
		<Popover
			open={open}
			onOpenChange={next => {
				if (next) setRequestedMode(reviewStarted ? "review" : "comment");
				setOpen(next);
			}}
		>
			<div className="relative">
				<PopoverTrigger asChild>
					<Button size="icon" variant="glass" aria-label={composerLabel({ pending, reviewStarted })}>
						<MessageSquare aria-hidden className="size-4" />
					</Button>
				</PopoverTrigger>
				{badge}
			</div>
			<PopoverContent
				side="top"
				align="end"
				sideOffset={8}
				aria-label="Pull request composer"
				className="w-96 max-w-[calc(100vw-2rem)] p-4"
				onOpenAutoFocus={event => {
					event.preventDefault();
					(mode === "review" ? reviewRef : commentRef).current?.focus();
				}}
			>
				<div className="mb-3 flex items-center justify-between gap-2">
					{reviewable ? (
						<SegmentedTabs value={mode} onValueChange={value => setRequestedMode(value === "review" ? "review" : "comment")}>
							<SegmentedTabsList aria-label="Composer mode">
								<SegmentedTab value="comment">Comment</SegmentedTab>
								<SegmentedTab value="review">{pending > 0 ? `Review (${pending})` : "Review"}</SegmentedTab>
							</SegmentedTabsList>
						</SegmentedTabs>
					) : (
						<PopoverTitle className="text-sm">Comment on pull request</PopoverTitle>
					)}
					<div className="flex items-center gap-1">
						{mode === "review" && openDraft && pending > 0 && (
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label="Discard pending line comments"
								title="Discard pending line comments"
								disabled={busy}
								onClick={() => sendSocket({ t: "review-draft", change: { op: "finding-state", pr: openDraft.pr, ids: pendingIds, state: "dismissed" } })}
							>
								<Trash2 aria-hidden />
							</Button>
						)}
						<Button size="icon-xs" variant="ghost" aria-label="Close composer" onClick={() => setOpen(false)}>
							<X aria-hidden />
						</Button>
					</div>
				</div>
				{mode === "review" ? (
					<ReviewForm textareaRef={reviewRef} summary={summary} onSummary={setSummary} verdict={picked} verdicts={verdicts} onVerdict={setVerdict} lineComments={lineComments} busy={busy} onSubmit={() => void review()} />
				) : (
					<CommentForm scope={prKey(detail)} state={detail.state} textareaRef={commentRef} body={body} onBody={setBody} busy={busy} onSubmit={then => void comment(then)} />
				)}
				{failure && (
					<p role="alert" className={`${ERROR_TEXT} mt-2`}>
						GitHub did not take it: {failure}
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** Cmd+Enter or Ctrl+Enter, but not while an input method composes text. */
function submitKey(event: KeyboardEvent<HTMLTextAreaElement>, submit: () => void): void {
	if (event.nativeEvent.isComposing || !isSubmitChord(event)) return;
	event.preventDefault();
	submit();
}

interface CommentFormProps {
	scope: string;
	state: PullRequestDetail["state"];
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	body: string;
	onBody: (body: string) => void;
	busy: boolean;
	onSubmit: (then: "close" | "reopen" | null) => void;
}

function CommentForm({ scope, state, textareaRef, body, onBody, busy, onSubmit }: CommentFormProps) {
	const confirm = useInlineConfirm(scope);
	const [pressed, setPressed] = useState<"close" | "reopen" | null>(null);
	const submit = (then: "close" | "reopen" | null): void => {
		setPressed(then);
		onSubmit(then);
	};
	const ready = body.trim() !== "" && body.length <= MAX_COMMENT_BODY && !busy;
	const followUp = state === "open" || state === "draft" ? "close" : state === "closed" ? "reopen" : null;
	return (
		<div className="space-y-2">
			<textarea
				ref={textareaRef}
				disabled={busy}
				value={body}
				rows={3}
				placeholder="Leave a comment"
				aria-label="Comment on this pull request"
				onChange={event => onBody(event.target.value)}
				onKeyDown={event => submitKey(event, () => ready && submit(null))}
				className={TEXTAREA}
			/>
			<div className="flex flex-wrap justify-end gap-2">
				{followUp === "close" && (
					<Button size="xs" variant="destructive-outline" leadingIcon={GitPullRequestClosed} loading={busy && pressed === "close"} disabled={!ready} {...confirm.props("close", () => submit("close"))}>
						<span className="inline-grid">
							<span aria-hidden className="invisible col-start-1 row-start-1">
								Close with comment
							</span>
							<span className="col-start-1 row-start-1">{confirm.isArmed("close") ? "Confirm close?" : "Close with comment"}</span>
						</span>
					</Button>
				)}
				{followUp === "reopen" && (
					<Button size="xs" variant="outline" leadingIcon={GitPullRequest} loading={busy && pressed === "reopen"} disabled={!ready} onClick={() => submit("reopen")}>
						Reopen with comment
					</Button>
				)}
				<Button size="xs" variant="outline" leadingIcon={Send} loading={busy && pressed === null} disabled={!ready} onClick={() => submit(null)}>
					Comment
				</Button>
			</div>
		</div>
	);
}

interface ReviewFormProps {
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	summary: string;
	onSummary: (summary: string) => void;
	verdict: ReviewVerdict;
	verdicts: ReviewVerdict[];
	onVerdict: (verdict: ReviewVerdict) => void;
	lineComments: number;
	busy: boolean;
	onSubmit: () => void;
}

function ReviewForm({ textareaRef, summary, onSummary, verdict, verdicts, onVerdict, lineComments, busy, onSubmit }: ReviewFormProps) {
	const ready = !busy && summary.length <= MAX_COMMENT_BODY && canSubmitReview(verdict, summary, lineComments);
	return (
		<>
			<textarea
				ref={textareaRef}
				rows={3}
				value={summary}
				placeholder={reviewPlaceholder(verdict, lineComments)}
				aria-label="Review summary"
				onChange={event => onSummary(event.target.value)}
				onKeyDown={event => submitKey(event, () => ready && onSubmit())}
				className={TEXTAREA}
			/>
			<div className="mt-2 flex justify-end gap-2">
				{verdicts.length > 1 && (
					<Select value={verdict} disabled={busy} onValueChange={value => value && onVerdict(value as ReviewVerdict)}>
						<SelectTrigger aria-label="Review verdict" className="mr-auto h-6 min-w-0 text-xs">
							<span className="flex items-center gap-1.5">
								{VERDICT_ICONS[verdict]}
								{VERDICT_LABELS[verdict]}
							</span>
						</SelectTrigger>
						<SelectContent side="top" alignItemWithTrigger={false}>
							{verdicts.map(value => (
								<SelectItem key={value} value={value} className="text-xs">
									<span className="flex items-center gap-1.5">
										{VERDICT_ICONS[value]}
										{VERDICT_LABELS[value]}
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				<Button size="xs" loading={busy} disabled={!ready} onClick={onSubmit}>
					Submit review
				</Button>
			</div>
		</>
	);
}
