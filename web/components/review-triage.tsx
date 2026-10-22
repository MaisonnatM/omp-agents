import { Check, ClipboardList, Copy, Pencil, Play, Sparkles, X } from "lucide-react";
import { useId, useState } from "react";
import { latestReviewTriage, replyOf, type ReviewTriage, type ReviewTriageEdit, type TriageDecision, type TriageItem, type TriageResult, type TriageVerdict } from "../../src/shared/review-triage";
import { hashForSession } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { putJson } from "../api";
import { useAction } from "../use-action";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { ERROR_TEXT } from "./form-dialog";
import { DetailSection, Markdown } from "./sheet-details";

const VERDICT: Record<TriageVerdict, string> = { fix: "Fix", "push-back": "Push back", "already-done": "Already done" };
const DECISION_LOOK: Record<TriageDecision, [string, string]> = {
	pending: ["Pending", "bg-muted text-muted-foreground"],
	accepted: ["Accepted", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"],
	dismissed: ["Dismissed", "bg-muted text-muted-foreground line-through"],
};
const OUTCOME: Record<TriageResult["outcome"], string> = { fixed: "Fixed", blocked: "Blocked", "reply-only": "Reply only" };
const TEXTAREA = "block max-h-80 min-h-14 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none [field-sizing:content] focus-visible:ring-2 focus-visible:ring-ring";
const MAX_REPLY = 65536;

/** The triages of one pull request or session, newest shown first; `headOid` is the pull request's head now. */
export function ReviewTriagePanel({ triages, headOid }: { triages: readonly ReviewTriage[]; headOid?: string }) {
	const { request } = useDashboardActions();
	const { connected, reviewTriages } = useDashboardStatus();
	const [chosen, setChosen] = useState<string | null>(null);
	const apply = useAction(async (triage: ReviewTriage) => {
		await putJson("/api/review-triage/apply", { id: triage.id, revision: triage.revision });
	}, "Cannot apply the accepted handling");
	const triage = triages.find(each => each.id === chosen) ?? latestReviewTriage(triages);
	if (!triage) return <p className="text-sm text-muted-foreground">Run Triage comments or Thermonuclear review to assess incoming feedback before anything changes.</p>;
	const owner = reviewTriages.owner;
	const readOnly = !connected || owner !== null;
	const accepted = triage.items.filter(item => item.decision === "accepted").length;
	const application = triage.batch?.application;
	const stale = !triage.batch && headOid !== undefined && headOid !== triage.snapshot.code.head;
	const reports = Object.fromEntries([...triages].reverse().map(report => [report.id, `${report.mode === "comments" ? "Comments" : "Thermonuclear"} · ${new Date(report.savedAt).toLocaleString()} · ${report.capture === null ? "Assessing" : `${report.items.length} items`}`]));
	return (
		<div className="min-w-0 space-y-6">
			{triages.length > 1 && (
				<Select<string> items={reports} value={triage.id} onValueChange={next => next && setChosen(next)}>
					<SelectTrigger aria-label="Review triage report">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Object.keys(reports).map(id => (
							<SelectItem key={id} value={id}>
								{reports[id]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			<p className="text-sm text-pretty text-muted-foreground">
				Reviewed <span className="font-mono">{triage.snapshot.code.head.slice(0, 7)}</span> in <span className="font-mono break-all">{triage.cwd}</span>. Accept the proposed handling, not necessarily the complaint: an
				accepted fix changes code, and Push back or Already done only drafts a reply.
				{triage.origin && (
					<>
						{" "}
						The findings come from{" "}
						<a className="underline underline-offset-2" href={hashForSession(triage.origin.sessionId)}>
							the session that reported them
						</a>
						, with their original wording on each card.
					</>
				)}
			</p>
			{owner && (
				<p role="status" className="text-sm">
					Another dashboard owns Review triage, so this one only shows it.{" "}
					<a href={owner} className="underline underline-offset-2">
						Open the owner dashboard
					</a>{" "}
					to decide or apply.
				</p>
			)}
			{stale && (
				<p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-pretty">
					The pull request moved from <span className="font-mono">{triage.snapshot.code.head.slice(0, 7)}</span> to <span className="font-mono">{headOid?.slice(0, 7)}</span> since this triage, so it cannot apply. Run
					Triage comments again for the new head.
				</p>
			)}
			{triage.capture === null ? (
				<p role="status" className="text-sm text-muted-foreground">
					The triage session is still reading and assessing the feedback.
				</p>
			) : (
				<>
					{triage.summary && (
						<DetailSection title="Assessment">
							<Markdown text={triage.summary} />
						</DetailSection>
					)}
					<DetailSection title={`Proposed handling · ${triage.items.length}`}>
						{triage.items.length ? (
							<ul className="space-y-3">
								{triage.items.map(item => (
									<TriageCard key={`${triage.id}:${item.id}`} item={item} triage={triage} readOnly={readOnly} onEdit={change => request({ t: "review-triage", change })} />
								))}
							</ul>
						) : (
							<p className="text-sm text-muted-foreground">This report has no findings.</p>
						)}
					</DetailSection>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							size="compact"
							variant="primary"
							leadingIcon={application?.phase === "running" ? Play : ClipboardList}
							disabled={readOnly || apply.pending || stale || accepted === 0 || (application !== undefined && application.phase !== "running")}
							onClick={() => apply.run(triage)}
						>
							{apply.pending ? "Starting…" : application?.phase === "running" ? "Resume application" : "Apply accepted"}
						</Button>
						<span className="text-sm text-muted-foreground tabular-nums">{accepted} accepted</span>
					</div>
					<p className="text-xs text-pretty text-muted-foreground">One session handles the whole accepted selection. Nothing here commits, pushes, posts, resolves threads, or changes the pull request.</p>
				</>
			)}
			{application && (
				<div role="status" className="text-sm text-pretty">
					{application.phase === "reserved" ? (
						<p className={ERROR_TEXT}>The application launch is reserved. If this stays after a reload, its session is unknown: check the running sessions. This batch never starts again by itself.</p>
					) : application.phase === "interrupted" ? (
						<p className={ERROR_TEXT}>{application.reason}</p>
					) : (
						<p>
							{application.phase === "completed" ? "The application session saved its results." : "The application session is working on the accepted selection."}{" "}
							<a className="underline underline-offset-2" href={hashForSession(application.sessionId)}>
								Open the application session
							</a>
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function TriageCard({ item, triage, readOnly, onEdit }: { item: TriageItem; triage: ReviewTriage; readOnly: boolean; onEdit(change: ReviewTriageEdit): Promise<void> }) {
	const [editing, setEditing] = useState(false);
	const [text, setText] = useState("");
	const [copied, setCopied] = useState(false);
	const id = useId();
	const common = { id: triage.id, revision: triage.revision, itemId: item.id };
	const decide = useAction((decision: TriageDecision) => onEdit({ ...common, op: "decision", decision }), "Review triage did not take the decision");
	const saveReply = useAction(async (reply: string) => {
		await onEdit({ ...common, op: "reply", text: reply });
		setEditing(false);
	}, "Review triage did not save the reply");
	const copy = useAction(async (reply: string) => {
		await navigator.clipboard.writeText(reply);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, "Cannot copy the reply");
	const decisionsDisabled = readOnly || decide.pending || triage.batch !== null;
	const result = triage.batch?.application.phase === "completed" ? triage.batch.application.results.find(each => each.id === item.id) : undefined;
	const { source } = item;
	const reply = replyOf(item, triage);
	const [label, look] = DECISION_LOOK[item.decision];
	return (
		<li className="min-w-0 rounded-md border border-border">
			<div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
				{source.kind === "thermo" && <span className="font-medium">Finding {source.number}</span>}
				<span className="min-w-0 font-mono break-all text-muted-foreground">
					{source.kind === "review" ? "General review" : `${source.path || "General"}${source.line === null ? "" : `:${source.line}`}`}
				</span>
				<span className="rounded-full bg-muted px-2 py-0.5 font-medium">{VERDICT[item.assessment.verdict]}</span>
				<span className={cn("rounded-full px-2 py-0.5", look)}>{label}</span>
			</div>
			<div className="min-w-0 space-y-4 p-3 [overflow-wrap:anywhere]">
				<details>
					<summary className="cursor-pointer text-xs font-medium">Original {source.kind === "thread" ? `review thread${source.resolved ? ", resolved" : ""}` : source.kind === "review" ? "review" : "thermonuclear finding"}</summary>
					{source.kind === "thread" ? (
						source.comments.map(comment => (
							<div key={comment.id} className="mt-3 space-y-1">
								<a href={comment.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline underline-offset-2">
									{comment.author}
								</a>
								<Markdown text={comment.body} />
							</div>
						))
					) : source.kind === "review" ? (
							<div className="mt-3 space-y-1">
								<a href={source.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline underline-offset-2">
									{source.author} · {source.state}
								</a>
								<Markdown text={source.body} />
							</div>
					) : (
						<Markdown text={source.body} className="mt-2" />
					)}
				</details>
				<div className="space-y-1">
					<p className="text-xs font-medium">Rationale</p>
					<Markdown text={item.assessment.rationale} />
				</div>
				<div className="space-y-1">
					<p className="text-xs font-medium">Evidence</p>
					<Markdown text={item.assessment.evidence} />
				</div>
				{result && <ApplicationResult result={result} />}
				<div className="flex flex-wrap gap-1">
					<Button size="compact" variant="ghost" leadingIcon={Check} disabled={decisionsDisabled} onClick={() => decide.run(item.decision === "accepted" ? "pending" : "accepted")}>
						{item.decision === "accepted" ? "Unaccept" : "Accept"}
					</Button>
					<Button size="compact" variant="ghost" leadingIcon={X} disabled={decisionsDisabled} onClick={() => decide.run(item.decision === "dismissed" ? "pending" : "dismissed")}>
						{item.decision === "dismissed" ? "Restore" : "Dismiss"}
					</Button>
				</div>
				<div className="space-y-2">
					<p className="text-xs font-medium">Draft {source.kind === "thread" ? "thread reply" : source.kind === "review" ? "review note" : "finding note"}</p>
					{editing ? (
						<form
							className="space-y-2"
							onSubmit={event => {
								event.preventDefault();
								saveReply.run(text);
							}}
						>
							<label htmlFor={id} className="sr-only">
								Reply
							</label>
							<textarea id={id} value={text} onChange={event => setText(event.target.value)} maxLength={MAX_REPLY} className={TEXTAREA} />
							<div className="flex flex-wrap gap-2">
								<Button type="submit" size="compact" variant="secondary" disabled={readOnly || saveReply.pending}>
									Save reply
								</Button>
								<Button type="button" size="compact" variant="ghost" onClick={() => setEditing(false)}>
									Cancel
								</Button>
							</div>
						</form>
					) : (
						<>
							<Markdown text={reply} />
							<div className="flex flex-wrap gap-2">
								<Button
									size="compact"
									variant="ghost"
									leadingIcon={Pencil}
									disabled={readOnly}
									onClick={() => {
										setText(reply);
										setEditing(true);
									}}
								>
									Edit reply
								</Button>
								<Button size="compact" variant="secondary" leadingIcon={copied ? Check : Copy} disabled={reply === ""} onClick={() => copy.run(reply)}>
									{copied ? "Copied" : "Copy reply"}
								</Button>
							</div>
						</>
					)}
				</div>
			</div>
		</li>
	);
}

function ApplicationResult({ result }: { result: TriageResult }) {
	return (
		<div className="space-y-1 rounded-md bg-muted p-2 text-sm">
			<p className="font-medium">{OUTCOME[result.outcome]}</p>
			<Markdown text={result.outcome === "blocked" ? result.reason : result.evidence} />
			{result.outcome === "fixed" && (
				<ul className="list-inside list-disc font-mono text-xs break-all">
					{result.changedFiles.map(path => (
						<li key={path}>{path}</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function SessionReviewTriage({ sessionId }: { sessionId: string }) {
	const { connected, reviewTriages } = useDashboardStatus();
	const existing = useAction(async () => {
		await putJson("/api/review-triage/session", { sessionId });
	}, "Cannot start Review triage");
	const fresh = useAction(async () => {
		await putJson("/api/review-triage/start", { sessionId });
	}, "Cannot start the thermonuclear review");
	const triages = reviewTriages.list.filter(triage => triage.target.kind === "local-session" && triage.target.sessionId === sessionId);
	const disabled = !connected || reviewTriages.owner !== null || existing.pending || fresh.pending;
	return (
		<div className="space-y-6 px-4 pb-4">
			<div className="space-y-2">
				<p className="text-sm text-pretty text-muted-foreground">
					Turn this session's findings into decision cards. A new session reads them with their original numbering and wording, or runs a new thermonuclear review of this checkout.
				</p>
				<div className="flex flex-wrap gap-2">
					<Button size="compact" variant="secondary" leadingIcon={ClipboardList} disabled={disabled} onClick={() => existing.run()}>
						{existing.pending ? "Starting…" : "Triage existing findings"}
					</Button>
					<Button size="compact" variant="ghost" leadingIcon={Sparkles} disabled={disabled} onClick={() => fresh.run()}>
						{fresh.pending ? "Starting…" : "Run thermonuclear review"}
					</Button>
				</div>
			</div>
			{triages.length > 0 && <ReviewTriagePanel triages={triages} />}
		</div>
	);
}
