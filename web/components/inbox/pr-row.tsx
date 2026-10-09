import { CircleCheck, CircleX, Clock, Eye, GitCompareArrows, GitMerge, Layers, type LucideIcon, MessageCircleQuestionMark, MessageSquare, UserCheck, UserX } from "lucide-react";
import { memo, type MouseEvent, useState } from "react";
import { type InboxPullRequest, type PullRequest, type PullRequestLink, repoKey, samePullRequest } from "../../../src/shared/github";
import type { MoveId } from "../../../src/shared/moves";
import type { HostStatus, PastSession, RosterHost, View } from "../../../src/shared/sessions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuShortcut } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import { inboxAge, type InboxRow, MOVES, moveAction, reason, type StackPlace } from "../../inbox-model";
import { hashForInbox, type OpenMode, sameView } from "../../routing";
import { hostLabel, LINK_VERB, modeOf, pastLabel, SPLIT_CLICK } from "../../labels";
import { type PullRequestActionId, pullRequestActions } from "../../../src/pull-request-actions";
import { QUICK_ACTIONS, type QuickActionId } from "../../quick-actions";
import { DROP_LINE, type DragItem } from "../../use-drag-order";
import { BranchLabel } from "../git";
import { QuickActionsMenu } from "../quick-actions";
import { SessionChip } from "../session-chip";
import { StatusDot, statusLabel } from "../status-dot";
import { IconTip, Reviewers } from "./avatars";

const MUTED = "bg-muted text-muted-foreground";

/** Each move's badge: its colour, and for a move that is yours, the icon that tells it apart at a glance. */
const MOVE_LOOK: Record<MoveId, [string, LucideIcon | null]> = {
	review: ["bg-blue-500/10 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300", Eye],
	merge: ["bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300", GitMerge],
	"fix-ci": ["bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300", CircleX],
	rebase: ["bg-orange-500/10 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300", GitCompareArrows],
	reply: ["bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300", MessageSquare],
	answer: ["bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300", MessageCircleQuestionMark],
	agent: [MUTED, null],
	"in-review": [MUTED, null],
	"checks-running": [MUTED, null],
	draft: [MUTED, null],
	merged: [MUTED, null],
};

const BADGE = "flex h-5 w-16 shrink-0 items-center justify-center gap-1 rounded-[5px] px-1 text-[11px] whitespace-nowrap";

function BadgeFace({ move }: { move: MoveId }) {
	const Icon = MOVE_LOOK[move][1];
	return (
		<>
			{move === "agent" && <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />}
			{Icon && <Icon aria-hidden className="size-3 shrink-0" />}
			{MOVES[move].label}
		</>
	);
}

/** The move a pull request waits on, as a fixed-width verb; an agent's work leads with the green dot of a working session. */
export function MoveBadge({ move, className }: { move: MoveId; className?: string }) {
	return (
		<span className={cn(BADGE, MOVE_LOOK[move][0], className)} style={{ fontVariationSettings: fontWeights.semibold }}>
			<BadgeFace move={move} />
		</span>
	);
}

/** A row's move badge: a button that starts the quick action handing the move to an agent, when one applies, else the plain badge. */
function RowMoveBadge({ pr, move, pending, cwd, onQuickAction }: { pr: InboxPullRequest; move: MoveId } & Pick<RowProps, "pending" | "cwd" | "onQuickAction">) {
	const action = moveAction(pr, move);
	if (!action) return <MoveBadge move={move} />;
	const label = `${MOVES[move].label}: ${QUICK_ACTIONS[action].label}`;
	return (
		<Tooltip content={`${label}. ${QUICK_ACTIONS[action].description}`}>
			<button
				type="button"
				aria-label={label}
				aria-busy={pending === action}
				disabled={pending !== null}
				onClick={() => onQuickAction(pr, cwd, action)}
				className={cn(
					BADGE,
					MOVE_LOOK[move][0],
					"cursor-pointer outline-none hover:ring-1 hover:ring-current/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
					pending === action && "motion-safe:animate-pulse",
				)}
				style={{ fontVariationSettings: fontWeights.semibold }}
			>
				<BadgeFace move={move} />
			</button>
		</Tooltip>
	);
}

const CHECKS_ICON: Record<InboxPullRequest["checks"], [LucideIcon, string, string] | null> = {
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400", "Checks pass"],
	failing: [CircleX, "text-red-600 dark:text-red-400", "Checks fail"],
	pending: [Clock, "text-amber-600 dark:text-amber-400", "Checks are running"],
	none: null,
};

/** How the head commit's checks went; nothing for a pull request without checks. */
export function ChecksIcon({ checks, className }: { checks: InboxPullRequest["checks"]; className?: string }) {
	const icon = CHECKS_ICON[checks];
	return icon && <IconTip icon={icon} className={className} />;
}

const REVIEW_ICON: Record<InboxPullRequest["review"], [LucideIcon, string, string] | null> = {
	approved: [UserCheck, "text-emerald-600 dark:text-emerald-400", "Approved"],
	"changes-requested": [UserX, "text-red-600 dark:text-red-400", "Changes requested"],
	"review-required": [Eye, "text-muted-foreground", "Waiting on a review"],
	none: null,
};

/** Where review stands: the reviewers' pictures, each marked with what they did, else GitHub's review decision as an icon. */
export function ReviewState({ pr, max, className }: { pr: InboxPullRequest; max: number; className?: string }) {
	if (pr.reviewers.length > 0) return <Reviewers reviewers={pr.reviewers} max={max} />;
	const icon = REVIEW_ICON[pr.review];
	return icon && <IconTip icon={icon} className={className} />;
}

/** The lines the pull request adds and removes. */
export function DiffSize({ pr }: { pr: InboxPullRequest }) {
	const label = `${pr.additions} line${pr.additions === 1 ? "" : "s"} added, ${pr.deletions} removed`;
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
				<span className="text-emerald-700 dark:text-emerald-400">+{pr.additions}</span>
				<span className="text-red-700 dark:text-red-400">-{pr.deletions}</span>
			</span>
		</Tooltip>
	);
}

interface SessionLink {
	view: View;
	sessionId: string;
	label: string;
	link: PullRequestLink;
	/** A running session's status; `null` for a past one. */
	status: HostStatus | null;
}

/** The sessions linked to `pr`: running ones first, so the row's first chips show the work under way, then those that submitted it before those that worked on it. */
export function sessionsFor(pr: InboxPullRequest, hosts: RosterHost[], past: PastSession[]): SessionLink[] {
	const linked = [
		...hosts.flatMap(host => {
			const found = host.pullRequests.find(other => samePullRequest(other, pr));
			const view: View = { kind: "live", instanceId: host.instanceId, agentId: null };
			return found ? [{ view, sessionId: host.sessionId, label: hostLabel(host), link: found.link, status: host.status }] : [];
		}),
		...past.flatMap(session => {
			const found = session.pullRequests.find(other => samePullRequest(other, pr));
			const view: View = { kind: "past", sessionId: session.sessionId };
			return found ? [{ view, sessionId: session.sessionId, label: pastLabel(session), link: found.link, status: null }] : [];
		}),
	];
	return linked.toSorted((a, b) => Number(a.view.kind === "past") - Number(b.view.kind === "past") || Number(a.link === "worked") - Number(b.link === "worked"));
}

/**
 * The first session on the pull request as a chip, then the others behind a `+N` menu that lists every one. A `compact`
 * chip shows the session's status alone and names it in its tooltip, for a row too narrow to fit its name whole.
 */
function SessionChips({ sessions, onOpen, compact }: { sessions: SessionLink[]; onOpen: (view: View, mode: OpenMode) => void; compact: boolean }) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [first] = sessions;
	if (!first) return null;
	return (
		<span className="flex min-w-0 items-center gap-0.5">
			<SessionChip
				label={first.label}
				status={first.status}
				title={`Open the session that ${LINK_VERB[first.link]} it${first.status ? `, ${statusLabel(first.status)}` : ""} (${SPLIT_CLICK} to split)`}
				filled={first.link === "submitted"}
				compact={compact}
				onClick={event => onOpen(first.view, modeOf(event))}
			/>
			{sessions.length > 1 && (
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<Tooltip content={`All ${sessions.length} sessions on this pull request`} forceOpen={menuOpen ? false : undefined}>
						<DropdownMenuTrigger
							render={
								<button
									type="button"
									aria-label={`All ${sessions.length} sessions on this pull request`}
									className="rounded px-1 py-px tabular-nums outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
								/>
							}
						>
							+{sessions.length - 1}
						</DropdownMenuTrigger>
					</Tooltip>
					<DropdownMenuContent align="start" className="max-w-80">
						{sessions.map(session => (
							<MenuItem key={session.sessionId} onClick={event => onOpen(session.view, modeOf(event))}>
								{session.status ? <StatusDot status={session.status} /> : <span className="w-1.5 shrink-0" />}
								<span className="min-w-0 flex-1 truncate">{session.label}</span>
								<span className="shrink-0 text-xs text-muted-foreground">{LINK_VERB[session.link]}</span>
								<MenuShortcut>{SPLIT_CLICK}</MenuShortcut>
							</MenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</span>
	);
}

/** Where the row sits in its stack, with the branch it stacks on in its tooltip; a PR on a branch the inbox does not list names that branch. */
function StackInfo({ stack, base }: { stack: StackPlace | null; base: string | null }) {
	if (!stack && !base) return null;
	const label = stack ? `Pull request ${stack.position} of ${stack.size} in a stack, on ${base ?? "the default branch"}` : `Stacked on ${base}`;
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className="flex min-w-0 items-center gap-1 tabular-nums">
				<Layers aria-hidden className="size-3 shrink-0" />
				{stack ? `${stack.position}/${stack.size}` : base && <BranchLabel name={base} className="max-w-24 font-mono" />}
			</span>
		</Tooltip>
	);
}

/** The DOM id of a pull request's row, which an inbox link to that PR scrolls to. */
export const rowId = (pr: PullRequest): string => `inbox-pr-${repoKey(pr)}/${pr.number}`;

/** The row's element and its link: what the inbox's keys reach by id, so the markup below is their contract. */
export const rowElement = (pr: PullRequest): HTMLElement | null => document.getElementById(rowId(pr));
export const rowLink = (pr: PullRequest): HTMLAnchorElement | null => rowElement(pr)?.querySelector("a") ?? null;

export interface RowProps {
	row: InboxRow;
	sessions: SessionLink[];
	/** The pull request whose details the main area shows. */
	targeted: boolean;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The quick action whose session is starting for this PR, if any. */
	pending: QuickActionId | null;
	/** The workspace a session on the pull request starts in. */
	cwd: string;
	/** The same function for every row, so a row that its props leave unchanged is not drawn again. */
	onQuickAction: (pr: InboxPullRequest, cwd: string, action: PullRequestActionId) => void;
	/** Whether the row's quick actions menu is open, which the `.` shortcut also sets. */
	actionsOpen: boolean;
	/** The same function for every row, like `onQuickAction`. */
	onActionsOpenChange: (pr: PullRequest, open: boolean) => void;
	drag: DragItem;
	/** What the move shortcuts name the row by. */
	moveId: string;
}

const sameStack = (a: StackPlace | null, b: StackPlace | null): boolean =>
	a === b || (a !== null && b !== null && a.position === b.position && a.size === b.size && a.joinsAbove === b.joinsAbove && a.joinsBelow === b.joinsBelow);

const sameSessions = (a: SessionLink[], b: SessionLink[]): boolean =>
	a.length === b.length && a.every((link, at) => link.sessionId === b[at]!.sessionId && link.label === b[at]!.label && link.link === b[at]!.link && link.status === b[at]!.status && sameView(link.view, b[at]!.view));

/** How each prop of a row is compared. A row's data is rebuilt whenever the roster or the sort changes, so it is compared by what it holds; the drag item is its handlers, which stay the same, and where a drop would land. */
const PROP_EQUAL: { [K in keyof RowProps]: (a: RowProps[K], b: RowProps[K]) => boolean } = {
	row: (a, b) => a === b || (a.pr === b.pr && a.move === b.move && a.unit === b.unit && sameStack(a.stack, b.stack)),
	sessions: sameSessions,
	targeted: Object.is,
	onOpen: Object.is,
	pending: Object.is,
	cwd: Object.is,
	onQuickAction: Object.is,
	actionsOpen: Object.is,
	onActionsOpenChange: Object.is,
	drag: (a, b) => a.handle === b.handle && a.target === b.target && a.dropAt === b.dropAt && a.dragging === b.dragging,
	moveId: Object.is,
};

const sameRowProps = (a: RowProps, b: RowProps): boolean =>
	(Object.keys(PROP_EQUAL) as (keyof RowProps)[]).every(key => (PROP_EQUAL[key] as (x: unknown, y: unknown) => boolean)(a[key], b[key]));

function RowQuickActions({ pr, pending, cwd, onQuickAction, actionsOpen, onActionsOpenChange }: Pick<RowProps, "pending" | "cwd" | "onQuickAction" | "actionsOpen" | "onActionsOpenChange"> & { pr: InboxPullRequest }) {
	return (
		<QuickActionsMenu
			actions={pullRequestActions(pr)}
			pending={pending}
			// The menu lists `pullRequestActions(pr)`, so it runs only one of those.
			onRun={action => onQuickAction(pr, cwd, action as PullRequestActionId)}
			open={actionsOpen}
			onOpenChange={open => onActionsOpenChange(pr, open)}
			label="Quick actions: start a session in the background that works on this pull request"
		/>
	);
}

function openFromRow(event: MouseEvent<HTMLElement>, pr: PullRequest): void {
	const target = event.target;
	if (!(target instanceof Element) || event.defaultPrevented || !event.currentTarget.contains(target) || target.closest("a, button, [role=menuitem]")) return;
	if (window.getSelection()?.isCollapsed === false) return;
	rowLink(pr)?.dispatchEvent(new window.MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		shiftKey: event.shiftKey,
		altKey: event.altKey,
	}));
}

/** The pull request's title link remains the keyboard and modifier-click target. */
function TitleLink({ pr, targeted, className }: { pr: InboxPullRequest; targeted: boolean; className: string }) {
	return (
		<Tooltip content={`${pr.owner}/${pr.repo}#${pr.number} · ${pr.title}`}>
			<a
				href={hashForInbox(pr)}
				// The row drags, not the link's address.
				draggable={false}
				aria-current={targeted ? "page" : undefined}
				className={cn("min-w-0 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
			>
				{pr.title}
			</a>
		</Tooltip>
	);
}

function Age({ at, className }: { at: number; className?: string }) {
	return (
		<span className={cn("shrink-0 text-right text-xs tabular-nums text-muted-foreground", className)} title={new Date(at).toLocaleString()}>
			{inboxAge(at)}
		</span>
	);
}

/**
 * A pull request in the sidebar's inbox: its title and age, then its move and why it waits on it, with its quick
 * actions on hover. A rail on the left joins the rows of a stack.
 */
export const PullRequestRow = memo(function PullRequestRow({ row: { pr, move, stack }, sessions, targeted, onOpen, drag, moveId, ...actions }: RowProps) {
	return (
		<li
			id={rowId(pr)}
			{...drag.handle}
			{...drag.target}
			data-move={moveId}
			onClick={event => openFromRow(event, pr)}
			className={cn("group/row relative cursor-pointer", drag.dragging && "opacity-50", drag.dropAt && DROP_LINE[drag.dropAt])}
		>
			{stack?.joinsAbove && <span aria-hidden className="absolute top-0 left-1 h-4 w-px bg-border" />}
			{stack?.joinsBelow && <span aria-hidden className="absolute top-4 bottom-0 left-1 w-px bg-border" />}
			{stack && <span aria-hidden className="absolute top-3.5 left-[2.5px] size-1 rounded-full bg-muted-foreground/60" />}
			<div className={cn("space-y-1 rounded-md py-1.5 pr-2 pl-3", targeted ? "bg-sidebar-accent" : "group-hover/row:bg-sidebar-accent/50")}>
				<div className="flex min-w-0 items-start gap-2">
					<TitleLink pr={pr} targeted={targeted} className="line-clamp-2 flex-1 leading-5" />
					<Age at={pr.updatedAt} className="w-7 leading-5" />
				</div>
				<p className="flex min-w-0 items-center gap-x-1.5 text-xs text-muted-foreground">
					<RowMoveBadge pr={pr} move={move} {...actions} />
					<span className="shrink-0 tabular-nums">#{pr.number}</span>
					<span aria-hidden>·</span>
					<span className="min-w-0 truncate">{reason(pr, move)}</span>
					<span className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
						<StackInfo stack={stack} base={pr.stackedOn} />
						<SessionChips sessions={sessions} onOpen={onOpen} compact />
						<ChecksIcon checks={pr.checks} className="[&_svg]:size-3.5" />
					</span>
				</p>
			</div>
			<span
				className={cn(
					"absolute top-1 right-1 rounded-md bg-sidebar transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[data-popup-open]]:opacity-100 [@media(hover:none)]:opacity-100",
					actions.pending === null && "opacity-0",
				)}
			>
				<RowQuickActions pr={pr} {...actions} />
			</span>
		</li>
	);
}, sameRowProps);

/**
 * The page's columns: move, title, sessions, stack, checks, review, size, age, and quick actions. The sessions, stack,
 * and size columns drop out when the page is too narrow for them.
 */
const TABLE_COLUMNS =
	"grid grid-cols-[4rem_minmax(0,1fr)_1.25rem_3.5rem_2rem_1.75rem] items-center gap-x-3 @3xl/inbox:grid-cols-[4rem_minmax(0,1fr)_10rem_3.5rem_1.25rem_3.5rem_6rem_2rem_1.75rem]";

const WIDE = "hidden @3xl/inbox:flex";

/** A pull request in the inbox page's table: one line per column, with the author, number, and reason under its title. */
export const PullRequestTableRow = memo(function PullRequestTableRow({ row: { pr, move, stack }, sessions, targeted, onOpen, drag, moveId, ...actions }: RowProps) {
	// A review's reason names its author, which this row shows already.
	const why = move === "review" ? null : reason(pr, move);
	return (
		<li
			id={rowId(pr)}
			{...drag.handle}
			{...drag.target}
			data-move={moveId}
			onClick={event => openFromRow(event, pr)}
			className={cn("group/row relative cursor-pointer px-3 py-2 hover:bg-muted/40", TABLE_COLUMNS, drag.dragging && "opacity-50", drag.dropAt && DROP_LINE[drag.dropAt])}
		>
			<RowMoveBadge pr={pr} move={move} {...actions} />
			<div className="min-w-0">
				<TitleLink pr={pr} targeted={targeted} className="block truncate" />
				<p className="flex min-w-0 items-center gap-x-1.5 text-xs text-muted-foreground">
					<span className="shrink-0">{pr.author.login}</span>
					<span aria-hidden>·</span>
					<span className="shrink-0 tabular-nums">#{pr.number}</span>
					{why && (
						<>
							<span aria-hidden>·</span>
							<span className="min-w-0 truncate">{why}</span>
						</>
					)}
				</p>
			</div>
			<span className={cn(WIDE, "min-w-0 text-xs")}>
				<SessionChips sessions={sessions} onOpen={onOpen} compact={false} />
			</span>
			<span className={cn(WIDE, "min-w-0 text-xs text-muted-foreground")}>
				<StackInfo stack={stack} base={pr.stackedOn} />
			</span>
			<span><ChecksIcon checks={pr.checks} /></span>
			<span><ReviewState pr={pr} max={2} /></span>
			<span className={cn(WIDE, "justify-end")}>
				<DiffSize pr={pr} />
			</span>
			<Age at={pr.updatedAt} />
			<span className="flex justify-end">
				<RowQuickActions pr={pr} {...actions} />
			</span>
		</li>
	);
}, sameRowProps);
