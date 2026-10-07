import { ArrowRight, Check, CircleCheck, CircleDashed, CircleSlash, CircleX, Eye, GitMerge, GitPullRequestDraft, Layers, type LucideIcon, MessageSquare } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import {
	type CheckRunState,
	type InboxPullRequest,
	type PullRequest,
	type PullRequestCheck,
	type PullRequestDetail,
	type PullRequestEvent,
	pullRequestUrl,
	type Reviewer,
	type ReviewerState,
	samePullRequest,
} from "../../../src/shared/github";
import type { RosterHost, View } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { graphiteUrl, inboxAge, type MoveId, pullRequestStatus, type StatusItem } from "../../inbox-model";
import { age, modeOf } from "../../labels";
import type { PullRequestActionId } from "../../../src/pull-request-actions";
import type { QuickActionId } from "../../quick-actions";
import { hashForInbox, type OpenMode } from "../../routing";
import { useRead } from "../../reads";
import { BranchLabel, BranchName } from "../git";
import { DetailQuickActions, QuickActionButton, type QuickActionsProps } from "../quick-actions";
import { Clamped, Comment, DetailSection, LoadNote, Markdown, OutLink } from "../sheet-details";
import { Avatar, IconTip, STATE_ICON } from "./avatars";
import { ChecksIcon, MoveBadge } from "./pr-row";

const CHECK_RUN_ICON: Record<CheckRunState, [LucideIcon, string]> = {
	failing: [CircleX, "text-red-600 dark:text-red-400"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400"],
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400"],
	skipped: [CircleSlash, "text-muted-foreground"],
};

/** Each state's share of the checks bar, in this order. */
const CHECK_BAR: Record<CheckRunState, string> = {
	failing: "bg-red-500",
	pending: "bg-amber-500",
	passing: "bg-emerald-500",
	skipped: "bg-muted-foreground/30",
};

const REVIEWER_ICON: Record<ReviewerState, [LucideIcon, string, string]> = {
	approved: [Check, "text-emerald-600 dark:text-emerald-400", "Approved"],
	"changes-requested": [CircleX, "text-red-600 dark:text-red-400", "Requested changes"],
	commented: [MessageSquare, "text-muted-foreground", "Commented"],
	requested: [CircleDashed, "text-amber-600 dark:text-amber-400", "Review requested"],
};

const STATE_LABEL: Record<PullRequestDetail["state"], string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

/** What a comment or review did, after its author's name. */
const EVENT_ACTION: Record<NonNullable<PullRequestEvent["review"]> | "comment", string> = {
	approved: "approved",
	"changes-requested": "requested changes",
	commented: "reviewed",
	dismissed: "reviewed, since dismissed",
	comment: "commented",
};

const AND = new Intl.ListFormat("en", { type: "conjunction" });

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

type Tone = "blocked" | "waiting" | "done";

const TONE_COLOR: Record<Tone, string> = {
	blocked: "text-red-600 dark:text-red-400",
	waiting: "text-amber-600 dark:text-amber-400",
	done: "text-emerald-600 dark:text-emerald-400",
};

interface ItemView<Item> {
	tone: Tone;
	icon: LucideIcon;
	text: (item: Item) => string;
	/** The quick action that works on it. */
	fix?: PullRequestActionId;
}

type StatusView = { [Kind in StatusItem["kind"]]: ItemView<Extract<StatusItem, { kind: Kind }>> };

/** How the details' Status says each fact. */
const STATUS_VIEW: StatusView = {
	ready: { tone: "done", icon: GitMerge, text: () => "Ready to merge" },
	draft: { tone: "waiting", icon: GitPullRequestDraft, text: () => "Draft, not ready for review" },
	conflicts: { tone: "blocked", icon: GitMerge, text: ({ base }) => `Merge conflicts with ${base}`, fix: "resolve-conflicts" },
	"checks-failing": { tone: "blocked", icon: CircleX, text: ({ count }) => `${plural(count, "check")} failed`, fix: "fix-ci" },
	"changes-requested": {
		tone: "blocked",
		icon: CircleX,
		text: ({ by }) => (by.length > 0 ? `Changes requested by ${AND.format(by)}` : "Changes requested"),
		fix: "address-comments",
	},
	threads: { tone: "blocked", icon: MessageSquare, text: ({ count, exact }) => `${count}${exact ? "" : "+"} review ${count === 1 && exact ? "thread" : "threads"} unresolved`, fix: "address-comments" },
	"checks-pending": { tone: "waiting", icon: CircleDashed, text: ({ count }) => `${plural(count, "check")} still running` },
	"review-required": {
		tone: "waiting",
		icon: Eye,
		text: ({ waitingOn }) => (waitingOn.length > 0 ? `Waiting on a review from ${AND.format(waitingOn)}` : "Waiting for a review"),
	},
	approved: { tone: "done", icon: CircleCheck, text: ({ by }) => (by.length > 0 ? `Approved by ${AND.format(by)}` : "Approved") },
	"checks-passing": {
		tone: "done",
		icon: CircleCheck,
		text: ({ passed, skipped }) => `${plural(passed, "check")} passed${skipped > 0 ? `, ${skipped} skipped` : ""}`,
	},
};

const viewOf = <Item extends StatusItem>(item: Item): ItemView<Item> => STATUS_VIEW[item.kind] as ItemView<Item>;

interface PlacedItem {
	item: StatusItem;
	fix: PullRequestActionId | null;
}

/** Each status item with the quick action it offers: one of `actions` that no item above it offers already. */
function placeFixes(items: StatusItem[], actions: QuickActionId[]): PlacedItem[] {
	const offered = new Set<PullRequestActionId>();
	return items.map(item => {
		const { fix } = viewOf(item);
		if (!fix || !actions.includes(fix) || offered.has(fix)) return { item, fix: null };
		offered.add(fix);
		return { item, fix };
	});
}

function Status({ placed, quick }: { placed: PlacedItem[]; quick: QuickActionsProps }) {
	return (
		<ul className="space-y-2.5 text-sm">
			{placed.map(({ item, fix }) => {
				const { tone, icon: Icon, text } = viewOf(item);
				return (
					<li key={item.kind} className="space-y-1.5">
						<p className="flex items-start gap-2">
							<Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", TONE_COLOR[tone])} />
							<span className="min-w-0">{text(item)}</span>
						</p>
						{fix && (
							<div className="pl-6">
								<QuickActionButton action={fix} pending={quick.pending} onRun={quick.onRun} />
							</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}

function CheckRow({ check: { name, state, url } }: { check: PullRequestCheck }) {
	const [Icon, color] = CHECK_RUN_ICON[state];
	return (
		<li className="flex min-w-0 items-center gap-2">
			<Icon aria-label={state} className={cn("size-3.5 shrink-0", color)} />
			{url ? (
				<Tooltip content={name}>
					<a href={url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
						{name}
					</a>
				</Tooltip>
			) : (
				<Tooltip content={name}>
					<span className="truncate">{name}</span>
				</Tooltip>
			)}
		</li>
	);
}

/** A bar of the checks' states, then failing and pending checks in full; passing and skipped ones folded behind their counts. */
function Checks({ checks }: { checks: PullRequestCheck[] }) {
	const waiting = checks.filter(check => check.state === "failing" || check.state === "pending");
	const settled = checks.filter(check => check.state === "passing" || check.state === "skipped");
	const passing = settled.filter(check => check.state === "passing").length;
	const skipped = settled.length - passing;
	const counts = Map.groupBy(checks, check => check.state);
	return (
		<div className="space-y-2 text-xs">
			<div aria-hidden className="flex h-1 gap-px overflow-hidden rounded-full">
				{(Object.keys(CHECK_BAR) as CheckRunState[]).map(state => {
					const count = counts.get(state)?.length ?? 0;
					return count > 0 && <span key={state} className={CHECK_BAR[state]} style={{ flexGrow: count }} />;
				})}
			</div>
			{waiting.length > 0 && (
				<ul className="space-y-1">
					{waiting.map((check, index) => (
						// GitHub can name two runs alike.
						<CheckRow key={index} check={check} />
					))}
				</ul>
			)}
			{settled.length > 0 && (
				<details>
					<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
						{[passing > 0 && `${passing} passing`, skipped > 0 && `${skipped} skipped`].filter(Boolean).join(", ")}
					</summary>
					<ul className="mt-1.5 space-y-1">
						{settled.map((check, index) => (
							<CheckRow key={index} check={check} />
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

/** What the pull request waits on next, as the inbox lists it. */
export interface NextMove {
	move: MoveId;
	reason: string;
	/** The quick action that makes the move, when one applies. */
	action: PullRequestActionId | null;
	/** The running session that works on it or asks you, for the moves an agent holds. */
	session: RosterHost | null;
}

/** The one thing to do about the pull request now: its move, why, and the button that makes it. */
function NextMoveCard({ pr, next, quick, onOpen }: { pr: PullRequest; next: NextMove; quick: QuickActionsProps; onOpen: DetailContentProps["onOpen"] }) {
	const { move, reason, action, session } = next;
	let button: ReactNode = null;
	if (action) button = <QuickActionButton action={action} pending={quick.pending} onRun={quick.onRun} primary />;
	else if (move === "merge")
		button = (
			<Button variant="primary" size="compact" render={<a href={pullRequestUrl(pr)} target="_blank" rel="noreferrer" />}>
				Merge on GitHub
			</Button>
		);
	else if (session)
		button = (
			<Button variant="primary" size="compact" onClick={event => onOpen({ kind: "live", instanceId: session.instanceId, agentId: null }, modeOf(event))}>
				Open the session
			</Button>
		);
	return (
		<section aria-label="Next move" className="space-y-2 rounded-lg border border-border p-3">
			<p className="flex items-center gap-2 text-xs text-muted-foreground">
				Next move
				<MoveBadge move={move} />
			</p>
			<p className="text-sm">{reason}</p>
			{button}
		</section>
	);
}

function ReviewerList({ reviewers }: { reviewers: Reviewer[] }) {
	if (reviewers.length === 0) return <p className="text-sm text-muted-foreground">No reviewers.</p>;
	return (
		<ul className="space-y-2 text-sm">
			{reviewers.map(reviewer => (
				<li key={reviewer.login} className="flex items-center gap-2">
					<Avatar person={reviewer} label={reviewer.login} />
					<span className="min-w-0 flex-1 truncate">{reviewer.login}</span>
					<IconTip icon={REVIEWER_ICON[reviewer.state]} />
				</li>
			))}
		</ul>
	);
}

const RAIL = "absolute left-3.5 w-px bg-muted-foreground/30";
const RAIL_DOT = "absolute top-1/2 left-[10.5px] size-2 -translate-y-1/2 rounded-full ring-2 ring-background";

/** The pull requests stacked with this one, top first, on a rail down to the branch the bottom one merges into; each other one links to its details. */
function StackSection({ stack, current }: { stack: InboxPullRequest[]; current: PullRequest }) {
	const at = stack.findIndex(pr => samePullRequest(pr, current));
	const bottom = stack[stack.length - 1];
	return (
		<DetailSection
			title={
				<>
					<Layers aria-hidden className="size-3.5 self-center" />
					Stack <span className="tabular-nums">{stack.length - at} of {stack.length}</span>
				</>
			}
		>
			<ol className="rounded-md border border-border py-1">
				{stack.map((pr, index) => {
					const here = index === at;
					const label = `#${pr.number} ${pr.title}`;
					return (
						<li key={pr.number} className={cn("relative flex items-center gap-2 py-1.5 pr-3 pl-8 text-sm", here && "bg-muted/60")}>
							<span aria-hidden className={cn(RAIL, index === 0 ? "top-1/2" : "top-0", "bottom-0")} />
							<span aria-hidden className={cn(RAIL_DOT, here ? "bg-primary" : "bg-muted-foreground/60")} />
							<Avatar person={pr.author} label={pr.author.login} />
							{here ? (
								<span aria-current="page" className="min-w-0 flex-1 truncate font-medium">
									{label}
								</span>
							) : (
								<a href={hashForInbox(pr)} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
									{label}
								</a>
							)}
							<ChecksIcon checks={pr.checks} />
							<span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{inboxAge(pr.updatedAt)}</span>
						</li>
					);
				})}
				<li className="relative py-1.5 pr-3 pl-8 font-mono text-xs text-muted-foreground">
					<span aria-hidden className={cn(RAIL, "top-0 bottom-1/2")} />
					<span aria-hidden className={cn(RAIL_DOT, "bg-background ring-muted-foreground/60")} />
					{bottom.stackedOn ?? "trunk"}
				</li>
			</ol>
		</DetailSection>
	);
}

interface DetailContentProps {
	pr: PullRequest;
	/** The quick actions on it; none apply when the inbox does not list it, since a start needs the workspace the inbox names. */
	quick: QuickActionsProps;
	/** The running sessions that work on it. */
	sessions: RosterHost[];
	onOpen: (view: View, mode: OpenMode) => void;
	/** Its move; `null` when the inbox does not list it. */
	next: NextMove | null;
	/** The pull requests stacked with it that the inbox lists, top first; empty when it is in no stack. */
	stack: InboxPullRequest[];
	/** Where the details show: the main area's page, whose heading takes focus, or the session details sidebar, under its own heading. */
	placement: Placement;
	/** A change reads the pull request from GitHub again. */
	version?: unknown;
}

export type Placement = "page" | "sidebar";

const HEADING: Record<Placement, { tag: "h1" | "h3"; className: string }> = {
	page: { tag: "h1", className: "text-xl" },
	sidebar: { tag: "h3", className: "text-base" },
};

/**
 * A pull request read from GitHub, laid out like Graphite's: a header that names it, then its stack and details, beside
 * a column of its state, next move, Status, where each blocker offers the quick action that works on it, checks,
 * reviewers, and the other quick actions with the sessions that work on it. The column stacks above the details when the
 * container is narrow, as in the sidebar. The next move's action shows only in its card. The other quick actions show
 * once the read settles, so the buttons do not move when the details arrive.
 */
export function PullRequestDetailContent({ pr, quick, sessions, onOpen, next, stack, placement, version }: DetailContentProps) {
	const { data: detail, error } = useRead<PullRequestDetail>(`/api/pull-request?${new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) })}`, version);
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		// The sidebar's details must leave the cursor in the pane's composer.
		if (placement === "page") headingRef.current?.focus({ preventScroll: true });
	}, [placement]);
	const offered = quick.actions.filter(action => action !== next?.action);
	const placed = detail ? placeFixes(pullRequestStatus(detail), offered) : [];
	const otherActions = detail || error ? offered.filter(action => !placed.some(({ fix }) => fix === action)) : [];
	const { tag: Heading, className: headingSize } = HEADING[placement];
	return (
		<div className="@container/pr">
			<div className="grid gap-x-10 gap-y-6 @4xl/pr:grid-cols-[minmax(0,1fr)_18rem]">
				<header className="min-w-0 space-y-2 @4xl/pr:col-start-1">
					<p className="text-sm tabular-nums text-muted-foreground">
						{pr.repo} #{pr.number}
					</p>
					<Heading ref={headingRef} tabIndex={-1} className={cn(headingSize, "leading-snug font-semibold outline-none")}>
						{detail?.title ?? `${pr.owner}/${pr.repo}#${pr.number}`}
					</Heading>
					{detail && (
						<div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs text-muted-foreground">
							<span className="flex items-center gap-1.5">
								<Avatar person={detail.author} label={`Opened by ${detail.author.login}`} />
								<span className="text-foreground">{detail.author.login}</span>
							</span>
							<span className="flex min-w-0 max-w-full items-center gap-1.5">
								<BranchName name={detail.head} className="rounded bg-muted px-1.5 py-0.5 font-mono" />
								<ArrowRight aria-label="into" className="size-3 shrink-0" />
								<BranchLabel name={detail.base} title className="max-w-64 font-mono" />
							</span>
							<span className="ml-auto flex items-center gap-3 tabular-nums">
								<span>
									{detail.changedFiles} {detail.changedFiles === 1 ? "file" : "files"}
								</span>
								<span>
									<span className="text-emerald-600 dark:text-emerald-400">+{detail.additions}</span>{" "}
									<span className="text-red-600 dark:text-red-400">−{detail.deletions}</span>
								</span>
								<Tooltip content={new Date(detail.createdAt).toLocaleString()}>
									<span>Opened {age(detail.createdAt)} ago</span>
								</Tooltip>
							</span>
						</div>
					)}
				</header>
				<aside aria-label="Where the pull request stands" className="min-w-0 space-y-5 @4xl/pr:col-start-2 @4xl/pr:row-span-2 @4xl/pr:row-start-1">
					<div className="flex items-center gap-3 text-xs text-muted-foreground">
						{detail && <StateLabel state={detail.state} />}
						<span className="ml-auto flex gap-3">
							<OutLink href={pullRequestUrl(pr)}>GitHub</OutLink>
							<OutLink href={graphiteUrl(pr)}>Graphite</OutLink>
						</span>
					</div>
					{next && <NextMoveCard pr={pr} next={next} quick={quick} onOpen={onOpen} />}
					{placed.length > 0 && (
						<DetailSection title="Status">
							<Status placed={placed} quick={quick} />
						</DetailSection>
					)}
					{detail && detail.checkRuns.length > 0 && (
						<DetailSection
							title={
								<>
									Checks <span className="tabular-nums">{detail.checkRuns.length}</span>
								</>
							}
						>
							<Checks checks={detail.checkRuns} />
						</DetailSection>
					)}
					{detail && (
						<DetailSection title="Reviewers">
							<ReviewerList reviewers={detail.reviewers} />
						</DetailSection>
					)}
					{(otherActions.length > 0 || sessions.length > 0) && (
						<DetailSection title="Actions">
							<DetailQuickActions actions={otherActions} pending={quick.pending} onRun={quick.onRun} sessions={sessions} onOpen={onOpen} />
						</DetailSection>
					)}
				</aside>
				<div className="min-w-0 space-y-6 @4xl/pr:col-start-1">
					{stack.length > 0 && <StackSection stack={stack} current={pr} />}
					{detail ? <PullRequestSections detail={detail} /> : <LoadNote loading="Asking GitHub for the pull request…" error={error && `Cannot load the pull request: ${error}`} />}
				</div>
			</div>
		</div>
	);
}

function StateLabel({ state }: { state: PullRequestDetail["state"] }) {
	const [Icon, color] = STATE_ICON[state];
	return (
		<span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
			<Icon aria-hidden className={cn("size-4", color)} />
			{STATE_LABEL[state]}
		</span>
	);
}

/** A pull request's description, unresolved comments, conversation, and files. */
function PullRequestSections({ detail }: { detail: PullRequestDetail }) {
	const { body, threads, conversation, files } = detail;
	return (
		<>
			<DetailSection title="Description">
				<div className="rounded-lg border border-border px-4 py-3">
					{body.trim() ? (
						<Clamped>
							<Markdown text={body} />
						</Clamped>
					) : (
						<p className="text-sm text-muted-foreground">No description.</p>
					)}
				</div>
			</DetailSection>
			{threads.length > 0 && (
				<DetailSection
					title={
						<>
							Unresolved comments <span className="tabular-nums">{threads.length}</span>
						</>
					}
				>
					<ul className="space-y-3">
						{threads.map((thread, index) => (
							<li key={index} className="space-y-3 rounded-lg border border-border p-3">
								<p className="truncate font-mono text-xs text-muted-foreground" title={thread.path}>
									{thread.path}
									{thread.line !== null && `:${thread.line}`}
								</p>
								<ul className="space-y-3">
									{thread.comments.map((comment, position) => (
										<Comment
											key={position}
											comment={comment}
											avatar={<Avatar person={comment.author} label={comment.author.login} className="mr-0.5" />}
											author={comment.author.login}
											action={position === 0 ? "commented" : "replied"}
										/>
									))}
								</ul>
							</li>
						))}
					</ul>
				</DetailSection>
			)}
			{conversation.length > 0 && (
				<DetailSection title="Conversation">
					<ul className="space-y-4">
						{conversation.map((event, index) => (
							<Comment
								key={index}
								comment={event}
								avatar={<Avatar person={event.author} label={event.author.login} className="mr-0.5" />}
								author={event.author.login}
								action={EVENT_ACTION[event.review ?? "comment"]}
							/>
						))}
					</ul>
				</DetailSection>
			)}
			{files.length > 0 && (
				<DetailSection
					title={
						<>
							Files <span className="tabular-nums">{detail.changedFiles}</span>
						</>
					}
				>
					<ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border font-mono text-xs">
						{files.map(file => (
							<li key={file.path} className="flex min-w-0 items-center gap-3 px-2.5 py-1">
								<span className="min-w-0 flex-1 truncate" title={`${file.path} (${file.change})`}>
									{file.path}
								</span>
								<span className="shrink-0 tabular-nums">
									<span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{" "}
									<span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
								</span>
							</li>
						))}
					</ul>
					{detail.changedFiles > files.length && (
						<p className="text-xs text-muted-foreground">
							And {detail.changedFiles - files.length} more files, which <OutLink href={`${pullRequestUrl(detail)}/files`}>GitHub</OutLink> lists.
						</p>
					)}
				</DetailSection>
			)}
		</>
	);
}
