import { ArrowLeft, Check, ExternalLink, FileDiff, GitMerge, GitPullRequest, Layers, MessageSquare, Pencil, TriangleAlert } from "lucide-react";
import { type RefObject, useState } from "react";
import { type LinkedPullRequest, type PullRequest, type PullRequestDetail, pullRequestName, pullRequestUrl, prKey, MAX_PULL_REQUEST_TITLE, samePullRequest, type StackedPullRequest, type UpdateMethod } from "../../../../src/shared/github";
import type { RosterHost } from "../../../../src/shared/sessions";
import { primaryControl } from "../../../../src/shared/moves";
import { canApprove } from "../../../../src/shared/review-drafts";
import { MERGE_METHOD_LABELS } from "../../../../src/shared/source-control";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { age, hostLabel, modeOf } from "../../../labels";
import { useAction } from "../../../use-action";
import { useInlineConfirm } from "../../../use-inline-confirm";
import { useHoverPopover } from "../../../use-hover-popover";
import { CopyableCode } from "../../copyable-code";
import { BranchLabel, releaseBranch } from "../../git";
import type { QuickActionsProps } from "../../quick-actions";
import { Avatar, STATE_ICON } from "../avatars";
import { queuedMergeText } from "../merge-popover";
import { type SavePullRequest, type SendPullRequest } from "../pr-fields";
import { type MenuRebase, PullRequestMenu } from "../pr-menu";
import { useMergeController } from "../use-merge-controller";
import type { Placement } from ".";
import type { DetailContentProps } from ".";
import { CheckoutMenu } from "./checkout-menu";
import { StackPopover } from "./stack";
import { SessionChip } from "../../session-chip";

function LinkedSessions({ sessions, onOpen }: { sessions: RosterHost[]; onOpen: DetailContentProps["onOpen"] }) {
	const [open, setOpen] = useState(false);
	if (sessions.length === 0) return null;
	return <Popover open={open} onOpenChange={setOpen}>
		<PopoverTrigger asChild><Button size="xs" variant="ghost-muted" leadingIcon={MessageSquare} aria-label={`Linked from ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}>{sessions.length}</Button></PopoverTrigger>
		<PopoverContent align="start" className="max-h-(--radix-popover-content-available-height) w-64 space-y-2 overflow-y-auto p-3">
			<p className="text-xs font-medium text-muted-foreground">Linked sessions</p>
			<div className="flex flex-col items-start gap-2 text-xs">{sessions.map(host => <SessionChip key={host.instanceId} label={hostLabel(host)} status={host.status} title="Open the session" filled={false} onClick={event => { setOpen(false); onOpen({ kind: "live", instanceId: host.instanceId, agentId: null }, modeOf(event)); }} />)}</div>
		</PopoverContent>
	</Popover>;
}

const ACTION_LABEL = "@max-[30rem]/pr-header:hidden";
const ACTION_BUTTON = "shrink-0 font-medium @max-[30rem]/pr-header:gap-0 @max-[30rem]/pr-header:px-1.5";

function TitleEditor({ detail, headingRef, placement, send }: { detail: PullRequestDetail; headingRef: RefObject<HTMLHeadingElement | null>; placement: Placement; send: SendPullRequest }) {
	const [editing, setEditing] = useState(false);
	const [title, setTitle] = useState(detail.title);
	const save = useAction(async () => {
		const value = title.trim();
		if (!value) return;
		if (value !== detail.title) await send({ field: "title", title: value });
		setEditing(false);
	}, "Could not save the title");
	const Heading = placement === "page" ? "h1" : "h3";
	if (editing) return (
		<form className="flex min-h-7 min-w-0 items-center gap-1 sm:min-h-6" onSubmit={event => { event.preventDefault(); save.run(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!save.pending) setEditing(false); } }}>
			<input autoFocus aria-label="Pull request title" value={title} maxLength={MAX_PULL_REQUEST_TITLE} required disabled={save.pending} onChange={event => setTitle(event.target.value)} className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
			<Button type="button" size="xs" variant="ghost" disabled={save.pending} onClick={() => setEditing(false)}>Cancel</Button>
			<Button type="submit" size="xs" variant="outline" loading={save.pending}>{save.pending ? "Saving..." : "Save"}</Button>
		</form>
	);
	return (
		<div className="group flex min-h-7 min-w-0 items-center gap-1 sm:min-h-6">
			<Heading ref={headingRef} tabIndex={-1} title={detail.title} className="min-w-0 flex-1 truncate text-base font-semibold leading-snug outline-none">{detail.title}</Heading>
			<span className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
				<Button size="icon-xs" variant="ghost-muted" aria-label="Edit title" onClick={() => { setTitle(detail.title); setEditing(true); }}><Pencil aria-hidden className="size-3" /></Button>
			</span>
		</div>
	);
}

function BaseBranch({ detail, stacked, send }: { detail: PullRequestDetail; stacked: boolean; send: SendPullRequest }) {
	const update = useAction(async (method: UpdateMethod) => { await send({ field: "update", method }); }, "Could not update the branch");
	const popover = useHoverPopover();
	const behind = (detail.state === "open" || detail.state === "draft") && !detail.conflicts && detail.behindBy !== null && detail.behindBy > 0;
	if (!behind) return <span className={cn("inline-flex min-w-0 max-w-[40%]", stacked && "text-warning-foreground")} title={stacked ? `Stacked on ${detail.base}` : detail.base}><BranchLabel name={detail.base} /></span>;
	return (
		<Popover {...popover.root}>
			<PopoverTrigger asChild>
				<button {...popover.trigger} type="button" aria-label={`${detail.base}, behind by ${detail.behindBy} ${detail.behindBy === 1 ? "commit" : "commits"}`}
					className="inline-flex min-w-0 max-w-[40%] shrink-0 cursor-help items-center gap-1 rounded-sm text-warning-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<BranchLabel name={detail.base} /><TriangleAlert aria-hidden className="size-3.5 shrink-0" />
				</button>
			</PopoverTrigger>
			<PopoverContent {...popover.content} align="start" aria-label="Update base branch" className="w-80 max-w-80 space-y-3 p-3 text-xs font-sans">
				<p>This branch is out-of-date with <code>{detail.base}</code> by {detail.behindBy} {detail.behindBy === 1 ? "commit" : "commits"}.</p>
				<p className="text-muted-foreground">Changes can be cleanly merged.</p>
				<div className="flex flex-wrap gap-2"><Button size="xs" variant="outline" disabled={update.pending} onClick={() => update.run("merge")}>Update branch</Button><Button size="xs" variant="outline" disabled={update.pending} onClick={() => update.run("rebase")}>Update with rebase</Button></div>
			</PopoverContent>
		</Popover>
	);
}

interface DetailHeaderProps {
	pr: PullRequest;
	detail: PullRequestDetail | null;
	stack: StackedPullRequest[];
	others: LinkedPullRequest[];
	sessions: RosterHost[];
	onOpen: DetailContentProps["onOpen"];
	onPick: DetailContentProps["onPick"];
	quick: QuickActionsProps;
	/** **Rebase on** its base in the `⋯` menu, once its pull request list entry and workspace are known. */
	rebase: MenuRebase | null;
	onSave: SavePullRequest;
	send: SendPullRequest;
	onMergeQueued: () => void;
	placement: Placement;
	headingRef: RefObject<HTMLHeadingElement | null>;
	cwd: string | null;
	condensed: boolean;
	foldRef: RefObject<HTMLDivElement | null>;
}

export function DetailHeader({ pr, detail, stack, others, sessions, onOpen, onPick, quick, rebase, onSave, send, onMergeQueued, placement, headingRef, cwd, condensed, foldRef }: DetailHeaderProps) {
	const { allowed, method, pick, queued, merging, pending, merge, cancel } = useMergeController({ pr, target: detail, onQueued: onMergeQueued, onCancelled: onMergeQueued });
	const control = detail ? primaryControl(detail, method, queued?.method ?? null) : { kind: "none" as const };
	const confirm = useInlineConfirm(`${prKey(pr)}:${detail?.headOid}:${method}`);
	const state = detail?.state ?? "open";
	const approve = useAction(() => send({ field: "review", verdict: "approve", body: "" }), "GitHub did not take the approval");
	const approvable = !!detail && canApprove(detail) && !detail.viewerApproved;
	const [StateIcon, tone] = STATE_ICON[state];
	const badge = queued && <Tooltip content={queuedMergeText(queued)}><span role="status" className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-[7px] text-xs font-medium", queued.state.kind === "failed" ? "border-destructive/32 bg-destructive/10 text-destructive-foreground" : "border-blue-500/32 bg-blue-500/10 text-blue-700 dark:border-blue-400/32 dark:bg-blue-400/15 dark:text-blue-300")}><GitMerge aria-hidden className="size-3.5" /><span className={ACTION_LABEL}>{queued.state.kind === "failed" ? "Merge stopped" : `Auto-merge (${MERGE_METHOD_LABELS[queued.method].toLowerCase()})`}</span></span></Tooltip>;
	const mergeLabel = confirm.isArmed("merge") ? "Confirm merge?" : control.kind === "enable-auto-merge" ? `${method ? MERGE_METHOD_LABELS[method] : "Merge"} when ready` : method ? MERGE_METHOD_LABELS[method] : "Merge";
	const stacked = !!detail && stack.length > 0 && stack.at(-1)?.number !== pr.number;
	const branches = detail && (
		<span className={cn("flex min-w-0 flex-1 items-center gap-1.5 font-mono text-muted-foreground/70", condensed ? "text-2xs" : "text-xs")}>
			<BaseBranch detail={detail} stacked={stacked} send={send} />
			<ArrowLeft aria-label="receives changes from" className={cn("shrink-0 opacity-60", condensed ? "size-3" : "size-3.5")} />
			<CopyableCode key={detail.head} value={detail.head} label="Copy pull request branch" onCopy={cwd === null ? undefined : () => releaseBranch(cwd, detail.head)} />
		</span>
	);
	const stats = detail && (
		<span className="ml-auto inline-flex shrink-0 items-center justify-end gap-2">
			<span aria-label={`${detail.changedFiles} changed files`} className="inline-flex min-w-16 items-center justify-end gap-1.5 tabular-nums">
				<FileDiff aria-hidden className={condensed ? "size-3" : "size-3.5"} />
				{detail.changedFiles} <span className="@max-[30rem]/pr-header:hidden">{detail.changedFiles === 1 ? "file" : "files"}</span>
			</span>
			<span className={cn("shrink-0 font-mono", condensed ? "text-2xs" : "text-xs")}>
				<span className="text-emerald-700 dark:text-emerald-400">+{detail.additions.toLocaleString()}</span>{" "}
				<span className="text-destructive-foreground">−{detail.deletions.toLocaleString()}</span>
			</span>
		</span>
	);
	const layer = stack.length - stack.findIndex(member => samePullRequest(member, pr));
	return (
		<header className="@container/pr-header grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 pt-2">
			<div className="grid h-7 min-w-0 items-center overflow-hidden pl-4">
				<div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
					{!condensed && <a href={`https://github.com/${pr.owner}/${pr.repo}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-left font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{pr.owner}/{pr.repo}</a>}
					<a href={pullRequestUrl(pr)} target="_blank" rel="noreferrer" className={cn("inline-flex shrink-0 items-center gap-0.5 font-medium underline-offset-2 hover:underline", tone)}>#{pr.number}<ExternalLink aria-hidden className="size-2.5" /></a>
					{condensed && <span className="truncate font-medium text-foreground">{detail?.title}</span>}
				</div>
			</div>
			<div className="mr-4 flex h-7 shrink-0 items-center justify-end gap-1">
				{(stack.length > 0 || others.length > 0) && (
					<StackPopover
						stack={stack}
						others={others}
						current={pr}
						onPick={onPick}
						align="end"
						trigger={() => (
							<Button variant="ghost-muted" size="xs" leadingIcon={Layers} aria-label={stack.length ? `Stack, layer ${layer} of ${stack.length}` : "Other pull requests of the session"}>
								{stack.length ? `${layer}/${stack.length}` : `+${others.length}`}
							</Button>
						)}
					/>
				)}
				<LinkedSessions sessions={sessions} onOpen={onOpen} />
				{queued && state !== "merged" && state !== "closed" && badge}
				{(control.kind === "merged" || control.kind === "closed") && (
					<span className={cn("inline-flex h-6 items-center gap-1 rounded-md border border-border px-[7px] text-xs", tone)}>
						<StateIcon aria-hidden className="size-3.5" />{control.kind === "merged" ? "Merged" : "Closed"}
					</span>
				)}
				<CheckoutMenu pr={pr} cwd={cwd} onOpen={onOpen} />
				{approvable && (
					<Tooltip content="Approve">
						<Button size="xs" variant="outline" className={ACTION_BUTTON} leadingIcon={Check} aria-label="Approve" loading={approve.pending} onClick={() => approve.run()}>
							<span className={ACTION_LABEL}>Approve</span>
						</Button>
					</Tooltip>
				)}
				{control.kind === "resolve-conflicts" && (
					<Tooltip content="Resolve conflicts">
						<span className="inline-flex">
							<Button size="xs" variant="destructive-outline" className={ACTION_BUTTON} leadingIcon={TriangleAlert} aria-label="Resolve conflicts"
								disabled={quick.pending !== null || !quick.actions.includes("resolve-conflicts")} onClick={() => quick.onRun("resolve-conflicts")}>
								<span className={ACTION_LABEL}>Resolve conflicts</span>
							</Button>
						</span>
					</Tooltip>
				)}
				{control.kind === "ready-for-review" && (
					<Tooltip content="Ready for review">
						<Button size="xs" variant="primary" className={ACTION_BUTTON} leadingIcon={GitPullRequest} aria-label="Ready for review" onClick={() => onSave({ field: "state", state: "open" }, { state: "open" })}>
							<span className={ACTION_LABEL}>Ready for review</span>
						</Button>
					</Tooltip>
				)}
				{(control.kind === "merge" || control.kind === "enable-auto-merge") && (
					<Tooltip content={mergeLabel} forceOpen={confirm.isArmed("merge") ? false : undefined} contentClassName="pointer-events-none">
						<Button size="xs" variant="primary" className={ACTION_BUTTON} leadingIcon={GitMerge} aria-label={mergeLabel}
							loading={merging} disabled={!!queued} {...confirm.props("merge", merge)}>
							<span className={ACTION_LABEL}>{merging ? "Merging..." : mergeLabel}</span>
						</Button>
					</Tooltip>
				)}
				<PullRequestMenu pr={pr} state={detail?.state ?? null} quick={quick} rebase={rebase} onState={to => onSave({ field: "state", state: to }, { state: to })} onApprove={approvable ? () => approve.run() : undefined}
					merge={{ allowed, method, onPick: pick, queued, onCancel: cancel.run }} pending={pending} label="More pull request actions" />
			</div>
			<div className={cn("col-span-2 grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", condensed ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
				<div data-condensed className={cn("min-h-0 overflow-hidden transition-[opacity,transform] duration-150 motion-reduce:transition-none", condensed ? "translate-y-0 opacity-100 delay-50" : "translate-y-1 opacity-0 duration-100")} inert={!condensed}>
					{detail && <div className="flex min-w-0 items-center gap-2 px-4 pb-2 pt-1 text-2xs text-muted-foreground">
						<Avatar person={detail.author} label={detail.author.login} />
						<span className="shrink-0 @max-[30rem]/pr-header:hidden">updated {age(detail.updatedAt)} ago</span>
						<span aria-hidden className="h-3 w-px shrink-0 bg-border/70" />
						{branches}{stats}
					</div>}
				</div>
			</div>
			<div className={cn("col-span-2 grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", condensed ? "grid-rows-[0fr]" : "grid-rows-[1fr]")}>
				<div ref={foldRef} className={cn("min-h-0 overflow-hidden transition-[opacity,transform] duration-150 motion-reduce:transition-none", condensed ? "-translate-y-1 opacity-0 duration-100" : "translate-y-0 opacity-100 delay-50")} inert={condensed}>
					<div className="mt-1 min-w-0 px-4 pb-4">
						{detail ? <TitleEditor detail={detail} headingRef={headingRef} placement={placement} send={send} /> : <h1 ref={headingRef} tabIndex={-1} className="text-base font-semibold">{pullRequestName(pr)}</h1>}
						{detail && <>
							<div className="mt-2 flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground"><span className="flex min-w-0 items-center gap-1.5"><Avatar person={detail.author} label={`Opened by ${detail.author.login}`} /><span className="truncate text-foreground">{detail.author.login}</span></span><span aria-hidden className="text-muted-foreground/50">·</span><Tooltip content={`Updated ${new Date(detail.updatedAt).toLocaleString()}`}><span className="shrink-0">updated {age(detail.updatedAt)} ago</span></Tooltip><CopyableCode value={`gh pr checkout ${pr.number}`} label="Copy checkout command" className="ml-auto font-mono" /></div>
							<div className="mt-4 flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">{branches}{stats}</div>
						</>}
					</div>
				</div>
			</div>
		</header>
	);
}
