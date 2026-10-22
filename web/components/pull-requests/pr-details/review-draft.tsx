/**
 * A pull request's Review draft tab: the review a Review session saved, to accept, dismiss, and edit finding by finding,
 * with its verdict and summary; **Preview** shows what posting sends, and **Post review** posts it after a confirmation.
 */
import { Check, ExternalLink, Eye, Pencil, Send, Trash2, X } from "lucide-react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useId, useState } from "react";
import { MAX_COMMENT_BODY, type PullRequest, pullRequestName } from "../../../../src/shared/github";
import { findingLocation, type FindingState, REVIEW_VERDICTS, type ReviewDraft, type ReviewDraftEdit, type ReviewEvent, type ReviewFinding, type ReviewPreview, type ReviewVerdict } from "../../../../src/shared/review-drafts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { putJson } from "../../../api";
import { useRead } from "../../../reads";
import { useAction } from "../../../use-action";
import { Age } from "../../age";
import { useDashboardActions } from "../../dashboard-context";
import { ERROR_TEXT } from "../../form-dialog";
import { DetailSection, LoadNote, Markdown } from "../../sheet-details";

const VERDICT_LABELS: Record<ReviewVerdict, string> = { approve: "Approve", "request-changes": "Request changes", comment: "Comment" };
const EVENT_LABELS: Record<ReviewEvent, string> = { APPROVE: "Approve", REQUEST_CHANGES: "Request changes", COMMENT: "Comment" };

const STATE_LOOK: Record<FindingState, [string, string]> = {
	pending: ["Pending", "bg-muted text-muted-foreground"],
	accepted: ["Accepted", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"],
	dismissed: ["Dismissed", "bg-muted text-muted-foreground line-through"],
};

const FIELD = "block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const TEXTAREA = cn(FIELD, "max-h-80 min-h-14 resize-none [field-sizing:content]");

const short = (sha: string): string => sha.slice(0, 7);

/** The draft of `pr`, against its head now, `headOid`. */
export function ReviewDraftPanel({ draft, headOid }: { draft: ReviewDraft; headOid: string }) {
	const { send } = useDashboardActions();
	const edit = (change: ReviewDraftEdit): void => send({ t: "review-draft", change });
	const { pr, posted } = draft;
	const previewUrl = `/api/review-draft/preview?${new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) })}`;
	const stale = draft.head !== headOid;
	const pending = draft.findings.filter(finding => finding.state === "pending");
	const [previewing, setPreviewing] = useState(false);
	return (
		<div className="space-y-6">
			{posted ? (
				<p className="text-sm">
					<Check aria-hidden className="mr-1 inline size-4 align-[-3px] text-emerald-600" />
					Posted <Age at={posted.at} exact className="tabular-nums" /> ago as {VERDICT_LABELS[draft.verdict].toLowerCase()}.{" "}
					<a href={posted.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted-foreground underline-offset-2 hover:underline">
						View on GitHub
						<ExternalLink aria-hidden className="size-3" />
					</a>
				</p>
			) : stale ? (
				<p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-pretty">
					The pull request moved from <span className="font-mono">{short(draft.head)}</span> to <span className="font-mono">{short(headOid)}</span> since this review, so it cannot post. Run the
					Review quick action again to review the new head.
				</p>
			) : (
				<p className="text-sm text-muted-foreground">
					Saved <Age at={draft.savedAt} exact className="tabular-nums" /> ago against <span className="font-mono">{short(draft.head)}</span>. Accept the findings to post, edit what needs it, then post.
				</p>
			)}
			<DetailSection title="Verdict">
				<RadioGroup aria-label="Verdict" value={draft.verdict} disabled={posted !== null} onValueChange={value => edit({ op: "verdict", pr, verdict: REVIEW_VERDICTS.find(verdict => verdict === value) ?? draft.verdict })} className="flex flex-wrap gap-x-4 gap-y-1">
					{REVIEW_VERDICTS.map(verdict => (
						<label key={verdict} className="flex cursor-pointer items-center gap-2 text-[13px]">
							<Radio.Root value={verdict} className="flex size-3.5 items-center justify-center rounded-full shadow-[0_0_0_1px_var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-primary">
								<Radio.Indicator className="size-1.5 rounded-full bg-background" />
							</Radio.Root>
							{VERDICT_LABELS[verdict]}
						</label>
					))}
				</RadioGroup>
			</DetailSection>
			<DetailSection title="Summary">
				{/* A new save of the draft replaces what the box holds. */}
				<SummaryField key={draft.savedAt} draft={draft} onSave={summary => edit({ op: "summary", pr, summary })} />
			</DetailSection>
			<DetailSection
				title={
					<>
						Findings <span className="tabular-nums">{draft.findings.length}</span>
						{!posted && pending.length > 1 && (
							<Button variant="ghost" size="compact" className="ml-auto" leadingIcon={Check} onClick={() => edit({ op: "finding-state", pr, ids: pending.map(finding => finding.id), state: "accepted" })}>
								Accept {pending.length} pending
							</Button>
						)}
					</>
				}
			>
				{draft.findings.length === 0 ? (
					<p className="text-sm text-muted-foreground">No findings: the review is its summary.</p>
				) : (
					<ul className="space-y-3">
						{draft.findings.map(finding => (
							<FindingCard key={`${draft.savedAt}:${finding.id}`} finding={finding} locked={posted !== null} onEdit={edit} pr={pr} />
						))}
					</ul>
				)}
			</DetailSection>
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="secondary" size="compact" leadingIcon={Eye} active={previewing} onClick={() => setPreviewing(open => !open)}>
					Preview
				</Button>
				{!posted && <PostButton draft={draft} previewUrl={previewUrl} />}
				<Button variant="ghost" size="compact" leadingIcon={Trash2} className="ml-auto" onClick={() => edit({ op: "discard", pr })}>
					Discard draft
				</Button>
			</div>
			{previewing && <PreviewSection draft={draft} previewUrl={previewUrl} />}
		</div>
	);
}

/** The summary, saved when the box loses focus with a change. */
function SummaryField({ draft, onSave }: { draft: ReviewDraft; onSave: (summary: string) => void }) {
	const [text, setText] = useState(draft.summary);
	const tooLong = text.length > MAX_COMMENT_BODY;
	return (
		<>
			<textarea
				aria-label="Summary"
				value={text}
				rows={3}
				readOnly={draft.posted !== null}
				placeholder="What the review says above its inline comments"
				onChange={event => setText(event.target.value)}
				onBlur={() => {
					if (text !== draft.summary && !tooLong) onSave(text);
				}}
				className={TEXTAREA}
			/>
			{tooLong && <p className={ERROR_TEXT}>GitHub takes at most {MAX_COMMENT_BODY} characters.</p>}
		</>
	);
}

/** One finding: where it is, its state, its text, and Accept, Dismiss, and Edit until the draft posts. */
function FindingCard({ pr, finding, locked, onEdit }: { pr: PullRequest; finding: ReviewFinding; locked: boolean; onEdit: (change: ReviewDraftEdit) => void }) {
	const [editing, setEditing] = useState(false);
	const [label, look] = STATE_LOOK[finding.state];
	const setState = (state: FindingState): void => onEdit({ op: "finding-state", pr, ids: [finding.id], state });
	return (
		<li className={cn("rounded-md border border-border", finding.state === "dismissed" && "opacity-60")}>
			<div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
				<span className="min-w-0 truncate font-mono">
					{findingLocation(finding)}
				</span>
				<span className={cn("shrink-0 rounded-full px-1.5 text-[10px] leading-4 font-medium", look)}>{label}</span>
				{!locked && !editing && (
					<span className="ml-auto flex shrink-0 items-center gap-1">
						{finding.state === "accepted" ? (
							<Button variant="ghost" size="compact" onClick={() => setState("pending")}>
								Unaccept
							</Button>
						) : (
							<Button variant="ghost" size="compact" leadingIcon={Check} onClick={() => setState("accepted")}>
								Accept
							</Button>
						)}
						{finding.state === "dismissed" ? (
							<Button variant="ghost" size="compact" onClick={() => setState("pending")}>
								Restore
							</Button>
						) : (
							<Button variant="ghost" size="compact" leadingIcon={X} onClick={() => setState("dismissed")}>
								Dismiss
							</Button>
						)}
						<Button variant="ghost" size="compact" leadingIcon={Pencil} onClick={() => setEditing(true)}>
							Edit
						</Button>
					</span>
				)}
			</div>
			{editing ? (
				<FindingForm
					finding={finding}
					onCancel={() => setEditing(false)}
					onSave={change => {
						onEdit({ op: "finding", pr, id: finding.id, ...change });
						setEditing(false);
					}}
				/>
			) : (
				<Markdown text={finding.body} className="px-3 py-2" />
			)}
		</li>
	);
}

/** A finding's file, line, and text, to change and save. */
function FindingForm({ finding, onSave, onCancel }: { finding: ReviewFinding; onSave: (finding: Pick<ReviewFinding, "path" | "line" | "body" | "startLine" | "side">) => void; onCancel: () => void }) {
	const id = useId();
	const [path, setPath] = useState(finding.path);
	const [line, setLine] = useState(finding.line === null ? "" : finding.startLine === null ? String(finding.line) : `${finding.startLine}-${finding.line}`);
	const [body, setBody] = useState(finding.body);
	const range = line.trim().match(/^(\d+)(?:-(\d+))?$/);
	const lineNumber = line.trim() === "" ? null : Number(range?.[2] ?? range?.[1]);
	const startLine = range?.[2] === undefined ? null : Number(range[1]);
	const lineOk = lineNumber === null || (Number.isSafeInteger(lineNumber) && lineNumber >= 1 && (startLine === null || (Number.isSafeInteger(startLine) && startLine >= 1 && startLine <= lineNumber)));
	const ready = path.trim() !== "" && body.trim() !== "" && body.length <= MAX_COMMENT_BODY && lineOk;
	return (
		<form
			className="space-y-2 p-2"
			onSubmit={event => {
				event.preventDefault();
				if (ready) onSave({ path: path.trim(), line: lineNumber, body, startLine, side: finding.side });
			}}
		>
			<div className="flex gap-2">
				<label htmlFor={`${id}-path`} className="sr-only">
					File
				</label>
				<input id={`${id}-path`} value={path} onChange={event => setPath(event.target.value)} className={cn(FIELD, "min-w-0 flex-1 font-mono text-xs")} />
				<label htmlFor={`${id}-line`} className="sr-only">
					Line or range
				</label>
				<input id={`${id}-line`} value={line} inputMode="numeric" placeholder="3-5" onChange={event => setLine(event.target.value)} aria-invalid={!lineOk} aria-describedby={!lineOk ? `${id}-line-error` : undefined} className={cn(FIELD, "w-20 font-mono text-xs tabular-nums")} />
			</div>
			<textarea aria-label="Finding" value={body} rows={3} onChange={event => setBody(event.target.value)} className={TEXTAREA} />
			{!lineOk && <p id={`${id}-line-error`} className={ERROR_TEXT}>Enter a line from 1, a range such as 3-5, or leave empty for the whole file.</p>}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="compact" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" variant="secondary" size="compact" disabled={!ready}>
					Save
				</Button>
			</div>
		</form>
	);
}

/** What posting sends now, read again after every change to the draft. */
function PreviewSection({ draft, previewUrl }: { draft: ReviewDraft; previewUrl: string }) {
	const { data, error } = useRead<ReviewPreview>(previewUrl, draft);
	return (
		<DetailSection title="Preview">
			{!data ? <LoadNote loading="Reading the pull request's diff…" error={error && `Cannot preview the review: ${error}`} /> : <PreviewBody preview={data} />}
		</DetailSection>
	);
}

function PreviewBody({ preview: { payload, refusal } }: { preview: ReviewPreview }) {
	return (
		<div className="space-y-3 rounded-md border border-border p-3">
			{refusal && (
				<p role="alert" className={ERROR_TEXT}>
					{refusal}
				</p>
			)}
			<p className="text-xs text-muted-foreground">
				{EVENT_LABELS[payload.event]} on <span className="font-mono">{short(payload.commit_id)}</span>, with {payload.comments.length === 1 ? "1 inline comment" : `${payload.comments.length} inline comments`}
			</p>
			{payload.body ? <Markdown text={payload.body} /> : <p className="text-sm text-muted-foreground">No summary.</p>}
			{payload.comments.length > 0 && (
				<ul className="space-y-2">
					{payload.comments.map((comment, index) => (
						<li key={index} className="rounded-md border border-border">
							<p className="border-b border-border px-2 py-1 font-mono text-xs text-muted-foreground">
								{findingLocation({ path: comment.path, line: comment.line, startLine: comment.start_line ?? null, side: comment.side })}
							</p>
							<Markdown text={comment.body} className="px-3 py-2" />
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** **Post review**: a confirmation that reads what posting sends, then posts it once. */
function PostButton({ draft, previewUrl }: { draft: ReviewDraft; previewUrl: string }) {
	const [open, setOpen] = useState(false);
	const { data, error } = useRead<ReviewPreview>(open ? previewUrl : null, draft);
	const post = useAction(async () => {
		await putJson<ReviewDraft>("/api/review-draft/post", { owner: draft.pr.owner, repo: draft.pr.repo, number: draft.pr.number });
		setOpen(false);
	}, "GitHub did not take the review");
	const comments = data?.payload.comments.length ?? 0;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="primary" size="compact" leadingIcon={Send} loading={post.pending}>
					Post review
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 space-y-3 p-3">
				{!data ? (
					<LoadNote loading="Reading the pull request's diff…" error={error && `Cannot read the pull request: ${error}`} />
				) : data.refusal ? (
					<p role="alert" className="text-[13px] text-pretty">
						{data.refusal}
					</p>
				) : (
					<p className="text-[13px] text-pretty">
						Post a review that says {EVENT_LABELS[data.payload.event].toLowerCase()} on {pullRequestName(draft.pr)}, with {comments === 1 ? "1 inline comment" : `${comments} inline comments`}? It posts as you, on{" "}
						<span className="font-mono">{short(data.payload.commit_id)}</span>.
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" size="compact" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button variant="primary" size="compact" leadingIcon={Send} disabled={!data || data.refusal !== null} loading={post.pending} onClick={() => post.run()}>
						Post review
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
