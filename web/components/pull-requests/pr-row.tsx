/** A pull request's row in the page's table, with its move badge, review draft tag, who started the threads a **Reply** waits on, checks icon, reviewers picker, diff size, and `⋯` menu, whose actions also open on right-click. */
import { IconArrowsRepeatRightLeft, IconBubbleQuestion, IconBubbleText, IconCircleCheck, IconCircleX, IconClipboard, IconClock, IconEyeOpen, IconLayersTwo, IconMerged, IconSparklesTwo, IconUser, IconUserAdd, IconUserAdded, IconUserRemove } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { memo, type MouseEvent, type ReactElement, type ReactNode, useRef, useState } from "react";
import { type PullRequestSummary, type LinkedPullRequest, prKey, type PullRequest, type PullRequestLink, pullRequestName, repoKey } from "../../../src/shared/github";
import { type MoveId, readyOnceChecksPass } from "../../../src/shared/moves";
import { canApprove, reviewDraftOf, waitsOnYou } from "../../../src/shared/review-drafts";
import type { HostStatus, PastSession, RosterHost, View } from "../../../src/shared/sessions";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuShortcut } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import { fixOwner, type ListChange, type SectionRow, MOVES, moveAction, reason, type StackPlace, threadStarters, withReviewer } from "../../pull-requests-model";
import { PULL_REQUEST_ACTIONS } from "../../../src/pull-request-actions";
import { hashForPullRequests, type OpenMode, sameView } from "../../routing";
import { usePageHash } from "../../page-hash";
import { hostLabel, LINK_VERB, modeOf, pastLabel, SPLIT_CLICK } from "../../labels";
import { type PullRequestActionId, pullRequestActions } from "../../../src/pull-request-actions";
import { QUICK_ACTIONS, type QuickActionId } from "../../quick-actions";
import { type Action, useAction } from "../../use-action";
import { DROP_LINE } from "../../order";
import type { DragItem } from "../../use-drag-order";
import { Age } from "../age";
import { BranchLabel } from "../git";
import { SessionChip } from "../session-chip";
import { useDashboardStatus } from "../dashboard-context";
import { StatusDot, statusLabel } from "../status-dot";
import { Avatar, IconTip, Reviewers } from "./avatars";
import { MergePopover, useMergeTarget } from "./merge-popover";
import { errorText } from "../../../src/json";
import { Spinner } from "../spinner";
import { toasts } from "../toaster";
import { type Busy, busyWords, useBusy } from "./busy";
import { type PullRequestOptionsRead, type ReviewerChange, ReviewersField, usePullRequestOptions } from "./pr-fields";
import { ConversationPeek } from "./conversation-peek";
import { PullRequestMenu, PullRequestMenuItems, type PullRequestMenuItemsProps } from "./pr-menu";

/** Whether an open pull request is a draft or live, for a row whose move badge does not say so already. */
function StateTag({ pr, move }: { pr: PullRequestSummary; move: MoveId }) {
	if (move === "draft" || (pr.state !== "draft" && pr.state !== "open")) return null;
	const draft = pr.state === "draft";
	return (
		<span
			className={cn(
				"shrink-0 rounded-full px-1.5 text-[10px] leading-4 font-medium",
				draft ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
			)}
		>
			{draft ? "Draft" : "Live"}
		</span>
	);
}

/** **Review draft** while a Review session's draft of the pull request waits for you to post it. */
function ReviewDraftTag({ pr }: { pr: PullRequest }) {
	const { reviewDrafts } = useDashboardStatus();
	if (!waitsOnYou(reviewDraftOf(reviewDrafts, pr))) return null;
	return (
		<Tooltip content="A review draft waits for you to post it">
			<span className="flex shrink-0 items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 text-[10px] leading-4 font-medium text-violet-700 dark:text-violet-300">
				<IconClipboard className="size-3" />
				Review draft
			</span>
		</Tooltip>
	);
}

const MUTED = "bg-muted text-muted-foreground";

/** Each move's badge: its colour, and for a move that is yours, the icon that tells it apart at a glance. */
const MOVE_LOOK: Record<MoveId, [string, IconComponent | null]> = {
	review: ["bg-blue-500/10 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300", IconEyeOpen],
	merge: ["bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300", IconMerged],
	"fix-ci": ["bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300", IconCircleX],
	rebase: ["bg-orange-500/10 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300", IconArrowsRepeatRightLeft],
	reply: ["bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300", IconBubbleText],
	answer: ["bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300", IconBubbleQuestion],
	agent: [MUTED, null],
	approval: ["bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300", null],
	"in-review": [MUTED, null],
	"checks-running": [MUTED, null],
	draft: [MUTED, null],
	merged: [MUTED, null],
};

const BADGE = "flex h-5 w-16 shrink-0 items-center justify-center gap-1 rounded-[5px] px-1 text-[11px] whitespace-nowrap";

const BADGE_BUTTON = "cursor-pointer outline-none hover:ring-1 hover:ring-current/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default";

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
function MoveBadge({ move }: { move: MoveId }) {
	return (
		<span className={cn(BADGE, MOVE_LOOK[move][0])} style={{ fontVariationSettings: fontWeights.semibold }}>
			<BadgeFace move={move} />
		</span>
	);
}

/** A row's changes to its pull request, pending until GitHub answers; a refusal shows as a toast. */
const useRowChange = (pr: PullRequestSummary, onChange: RowProps["onChange"]): Action<[ListChange]> =>
	useAction((change: ListChange) => onChange(pr, change), "GitHub refused the change");

/** A row's review requests, and the row's pull request with them shown. */
interface ReviewRequests {
	shown: PullRequestSummary;
	send: (change: ReviewerChange) => void;
}

/**
 * A row's review requests: each shows at once over the row's reviewers and goes to GitHub after the ones before it, so
 * quick picks all land, in order, and a pick reads the requests before it; a refusal drops its pick and shows as a toast.
 */
function useReviewRequests(pr: PullRequestSummary, options: PullRequestOptionsRead, onChange: RowProps["onChange"]): ReviewRequests {
	const [queued, setQueued] = useState<ReviewerChange[]>([]);
	const chain = useRef(Promise.resolve());
	const send = (change: ReviewerChange): void => {
		setQueued(current => [...current, change]);
		chain.current = chain.current
			.then(() => onChange(pr, change))
			.catch((error: unknown) => { toasts({ title: "GitHub refused the change", description: errorText(error) }); })
			// GitHub's answer reaches the list before the pick leaves the queue, and showing a pick twice changes nothing.
			.finally(() => setQueued(current => current.slice(1)));
	};
	if (queued.length === 0) return { shown: pr, send };
	const people = options.data?.reviewers ?? [];
	const reviewers = queued.reduce((list, { login, on }) => withReviewer(list, login, on, people.find(person => person.login === login)?.avatarUrl ?? null), pr.reviewers);
	return { shown: { ...pr, reviewers }, send };
}

/**
 * A **Merge** badge, or a **Checks running** one on a pull request that is ready but for them: a button that merges after the
 * same confirmation as the details, reading what the merge needs while it is open; once queued, **Queued** or **Stopped**.
 */
function MergeBadge({ pr, move }: { pr: PullRequestSummary; move: "merge" | "checks-running" }) {
	const [open, setOpen] = useState(false);
	const target = useMergeTarget(pr, open);
	const label = move === "merge" ? `Merge ${pullRequestName(pr)} on GitHub` : `Checks running: merge ${pullRequestName(pr)} once they pass`;
	return (
		<MergePopover pr={pr} target={target.data} error={target.error} open={open} onOpenChange={setOpen} tooltip={label} align="start">
			{({ queued, pending }) => (
				<button
					type="button"
					aria-label={queued ? `${label}: ${queued.state.kind === "failed" ? "stopped" : "queued"}` : label}
					aria-busy={pending || queued?.state.kind === "waiting"}
					disabled={pending}
					className={cn(BADGE, MOVE_LOOK[move][0], BADGE_BUTTON, (pending || queued?.state.kind === "waiting") && "motion-safe:animate-pulse")}
					style={{ fontVariationSettings: fontWeights.semibold }}
				>
					{queued ? (
						<>
							<IconMerged className="size-3 shrink-0" />
							{queued.state.kind === "failed" ? "Stopped" : "Queued"}
						</>
					) : (
						<BadgeFace move={move} />
					)}
				</button>
			)}
		</MergePopover>
	);
}

/**
 * A pull request's move badge while it is busy: what it is busy with, spinning, at the move badge's size so the row
 * holds still. Its padding, gap, and tracking are tighter than a move's, so **Rebasing** fits beside the spinner.
 */
function RowBusyBadge({ busy }: { busy: Busy }) {
	const { label, short } = busyWords(busy);
	return (
		<Tooltip content={label}>
			<span aria-busy className={cn(BADGE, MUTED, "gap-0.5 px-0.5 tracking-tight")} style={{ fontVariationSettings: fontWeights.semibold }}>
				<Spinner className="size-3" strokeWidth={2} />
				<span aria-hidden>{short}</span>
				<span className="sr-only">{label}</span>
			</span>
		</Tooltip>
	);
}

/**
 * A row's move badge: while the pull request rebases or a session starts on it, what it is busy with; for **Merge**, and
 * **Checks running** on a pull request ready but for them, a button that merges; else a button that starts the quick
 * action handing the move to an agent, when one applies, whose label says whether a fix goes to the session that owns
 * the pull request or to a new one; else the plain badge.
 */
function RowMoveBadge({ pr, move, sessions, pending, cwd, onQuickAction }: { pr: PullRequestSummary; move: MoveId } & Pick<RowProps, "sessions" | "pending" | "cwd" | "onQuickAction">) {
	const busy = useBusy(pr, pending);
	if (busy) return <RowBusyBadge busy={busy} />;
	if (move === "merge" || (move === "checks-running" && readyOnceChecksPass(pr))) return <MergeBadge pr={pr} move={move} />;
	const action = moveAction(pr, move);
	if (!action) return <MoveBadge move={move} />;
	const owner = fixOwner(sessions, action);
	const goesTo = owner ? ` · Send to ${owner.label}` : PULL_REQUEST_ACTIONS[action].reachesOwner ? " · New session" : "";
	const label = `${MOVES[move].label}: ${QUICK_ACTIONS[action].label}${goesTo}`;
	return (
		<Tooltip content={`${label}. ${QUICK_ACTIONS[action].description}`}>
			<button
				type="button"
				aria-label={label}
				onClick={() => onQuickAction(pr, cwd, action)}
				className={cn(BADGE, MOVE_LOOK[move][0], BADGE_BUTTON)}
				style={{ fontVariationSettings: fontWeights.semibold }}
			>
				<BadgeFace move={move} />
			</button>
		</Tooltip>
	);
}

/** Whether `move` on `pr` waits on a fix, which goes to the session that owns the pull request. */
const fixes = (pr: PullRequestSummary, move: MoveId): boolean => {
	const action = moveAction(pr, move);
	return action !== null && PULL_REQUEST_ACTIONS[action].reachesOwner;
};

/** The sessions cell of a row whose fix no session owns, so the fix starts a new one. */
function NoSession() {
	return (
		<Tooltip content="No session opened or worked on this pull request, so its fix starts a new one">
			<span className="italic text-muted-foreground">no session</span>
		</Tooltip>
	);
}

const CHECKS_ICON: Record<PullRequestSummary["checks"], [IconComponent, string, string] | null> = {
	passing: [IconCircleCheck, "text-emerald-600 dark:text-emerald-400", "Checks pass"],
	failing: [IconCircleX, "text-red-600 dark:text-red-400", "Checks fail"],
	pending: [IconClock, "text-amber-600 dark:text-amber-400", "Checks are running"],
	none: null,
};

/** How the head commit's checks went; nothing for a pull request without checks. */
export function ChecksIcon({ checks }: { checks: PullRequestSummary["checks"] }) {
	const icon = CHECKS_ICON[checks];
	return icon && <IconTip icon={icon} />;
}

const REVIEW_ICON: Record<PullRequestSummary["review"], [IconComponent, string, string] | null> = {
	approved: [IconUserAdded, "text-emerald-600 dark:text-emerald-400", "Approved"],
	"changes-requested": [IconUserRemove, "text-red-600 dark:text-red-400", "Changes requested"],
	"review-required": [IconEyeOpen, "text-muted-foreground", "Waiting on a review"],
	none: null,
};

/** Where review stands: the reviewers' pictures, each marked with what they did, else GitHub's review decision as an icon. */
export function ReviewState({ pr, max, className }: { pr: PullRequestSummary; max: number; className?: string }) {
	if (pr.reviewers.length > 0) return <Reviewers reviewers={pr.reviewers} max={max} />;
	const icon = REVIEW_ICON[pr.review];
	return icon && <IconTip icon={icon} className={className} />;
}

/** The review column: where review stands, on a button that asks for reviews or withdraws them; a merged pull request's only shows it. */
function ReviewPicker({ options, review: { shown, send } }: { options: PullRequestOptionsRead; review: ReviewRequests }) {
	if (shown.state === "merged") return <ReviewState pr={shown} max={2} />;
	const shows = shown.reviewers.length > 0 || REVIEW_ICON[shown.review] !== null;
	return (
		<ReviewersField pr={shown} options={options} onChange={send} className="-mx-1 h-6 px-1 font-normal">
			{shows ? <ReviewState pr={shown} max={2} /> : <IconUserAdd className="size-4 text-muted-foreground/60" />}
		</ReviewersField>
	);
}

/** How many review threads on the pull request are still unresolved, opening its latest comments on hover; nothing when none are. */
function ConversationCount({ pr }: { pr: PullRequestSummary }) {
	const open = pr.unresolved.count;
	if (open === 0) return null;
	const label = `${open} unresolved ${open === 1 ? "conversation" : "conversations"}`;
	return (
		<ConversationPeek pr={pr}>
			<span role="img" aria-label={label} tabIndex={0} className="flex shrink-0 items-center gap-0.5 rounded-sm text-xs tabular-nums text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
				<IconBubbleText className="size-3.5" />
				{open}
			</span>
		</ConversationPeek>
	);
}

/** Who started the open threads a **Reply** waits on, AI or people, each with its count; nothing for any other move. */
function ThreadStartersTag({ pr, move }: { pr: PullRequestSummary; move: MoveId }) {
	const starters = threadStarters(pr, move);
	if (!starters) return null;
	return (
		<Tooltip content={starters.label}>
			<span role="img" aria-label={starters.label} className="flex shrink-0 items-center gap-1.5 tabular-nums">
				{starters.ai > 0 && <span className="flex items-center gap-0.5"><IconSparklesTwo className="size-3.5" />{starters.ai}</span>}
				{starters.human > 0 && <span className="flex items-center gap-0.5"><IconUser className="size-3.5" />{starters.human}</span>}
			</span>
		</Tooltip>
	);
}

/** The lines the pull request adds and removes. */
export function DiffSize({ pr }: { pr: PullRequestSummary }) {
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

/**
 * The sessions linked to each pull request, by {@link prKey}, in one pass over the sessions: running ones first, so a
 * row's first chips show the work under way, then those that submitted it before those that worked on it.
 */
export function sessionsByPullRequest(hosts: RosterHost[], past: PastSession[]): Map<string, SessionLink[]> {
	const byKey = new Map<string, SessionLink[]>();
	const add = (pullRequests: LinkedPullRequest[], link: (linked: LinkedPullRequest) => SessionLink): void => {
		const seen = new Set<string>();
		for (const pr of pullRequests) {
			const key = prKey(pr);
			// A session names a pull request once, by the first link it lists.
			if (seen.has(key)) continue;
			seen.add(key);
			const links = byKey.get(key);
			if (links) links.push(link(pr));
			else byKey.set(key, [link(pr)]);
		}
	};
	for (const host of hosts) {
		const view: View = { kind: "live", instanceId: host.instanceId, agentId: null };
		add(host.pullRequests, linked => ({ view, sessionId: host.sessionId, label: hostLabel(host), link: linked.link, status: host.status }));
	}
	for (const session of past) {
		const view: View = { kind: "past", sessionId: session.sessionId };
		add(session.pullRequests, linked => ({ view, sessionId: session.sessionId, label: pastLabel(session), link: linked.link, status: null }));
	}
	for (const links of byKey.values()) links.sort((a, b) => Number(a.view.kind === "past") - Number(b.view.kind === "past") || Number(a.link === "worked") - Number(b.link === "worked"));
	return byKey;
}

/** The first session on the pull request as a chip, then the others behind a `+N` menu that lists every one. */
function SessionChips({ sessions, onOpen }: { sessions: SessionLink[]; onOpen: (view: View, mode: OpenMode) => void }) {
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

/** Where the row sits in its stack, with the branch it stacks on in its tooltip; a PR on a branch the list leaves out names that branch. */
function StackInfo({ stack, base }: { stack: StackPlace | null; base: string | null }) {
	if (!stack && !base) return null;
	const label = stack ? `Pull request ${stack.position} of ${stack.size} in a stack, on ${base ?? "the default branch"}` : `Stacked on ${base}`;
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className="flex min-w-0 items-center gap-1 tabular-nums">
				<IconLayersTwo className="size-3 shrink-0" />
				{stack ? `${stack.position}/${stack.size}` : base && <BranchLabel name={base} className="max-w-24 font-mono" />}
			</span>
		</Tooltip>
	);
}

/** The DOM id of a pull request's row, which a link to that PR on the Pull requests page scrolls to. */
export const rowId = (pr: PullRequest): string => `pull-request-${repoKey(pr)}/${pr.number}`;

/** The row's element: what the list's keys reach by id, so the markup below is their contract. */
export const rowElement = (pr: PullRequest): HTMLElement | null => document.getElementById(rowId(pr));

/** What a pull request's row takes from the functions every row shares; the list adds its drag and move id. */
export interface RowBase {
	row: SectionRow;
	sessions: SessionLink[];
	/** The pull request whose details the main area shows. */
	targeted: boolean;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The quick action whose session is starting for this PR, if any. */
	pending: QuickActionId | null;
	/** The workspace a session on the pull request starts in. */
	cwd: string;
	/** The same function for every row, so a row that its props leave unchanged is not drawn again. */
	onQuickAction: (pr: PullRequestSummary, cwd: string, action: PullRequestActionId) => void;
	/** Queues the rebase of the pull request on its base, from `cwd`; the same function for every row, like `onQuickAction`. */
	onRebase: (pr: PullRequestSummary, cwd: string) => void;
	/** Whether the row's `⋯` menu is open, which the `.` shortcut also sets. */
	actionsOpen: boolean;
	/** The same function for every row, like `onQuickAction`. */
	onActionsOpenChange: (pr: PullRequest, open: boolean) => void;
	/** Makes `change` on GitHub and shows it in the list; the same function for every row, like `onQuickAction`. */
	onChange: (pr: PullRequestSummary, change: ListChange) => Promise<void>;
}

export interface RowProps extends RowBase {
	/** `NO_DRAG` where the rows keep the list's order, as under a grouping other than by repository. */
	drag: DragItem;
	/** What the move shortcuts name the row by; `undefined` where it does not move. */
	moveId: string | undefined;
}

const sameStack = (a: StackPlace | null, b: StackPlace | null): boolean =>
	a === b || (a !== null && b !== null && a.position === b.position && a.size === b.size && a.joinsAbove === b.joinsAbove && a.joinsBelow === b.joinsBelow);

/** Two lists of a pull request's sessions that draw the same chips. */
export const sameSessions = (a: SessionLink[], b: SessionLink[]): boolean =>
	a.length === b.length && a.every((link, at) => link.sessionId === b[at]!.sessionId && link.label === b[at]!.label && link.link === b[at]!.link && link.status === b[at]!.status && sameView(link.view, b[at]!.view));

/**
 * How each prop of a row is compared, which decides whether it draws again. The list keeps each prop the same object
 * while what it shows holds, `sessions` included, except the row's data, which it rebuilds whenever the roster or the
 * sort changes, compared by what it holds, and its drag item, compared by its handlers, which stay the same, and where a
 * drop would land.
 */
const ROW_EQUAL: { [K in keyof RowProps]: (a: RowProps[K], b: RowProps[K]) => boolean } = {
	row: (a, b) => a === b || (a.pr === b.pr && a.move === b.move && a.unit === b.unit && sameStack(a.stack, b.stack)),
	sessions: Object.is,
	targeted: Object.is,
	onOpen: Object.is,
	pending: Object.is,
	cwd: Object.is,
	onQuickAction: Object.is,
	onRebase: Object.is,
	actionsOpen: Object.is,
	onActionsOpenChange: Object.is,
	onChange: Object.is,
	drag: (a, b) => a.handle === b.handle && a.target === b.target && a.dropAt === b.dropAt && a.dragging === b.dragging,
	moveId: Object.is,
};

const sameRowProps = (a: RowProps, b: RowProps): boolean => (Object.keys(ROW_EQUAL) as (keyof RowProps)[]).every(<K extends keyof RowProps>(key: K) => ROW_EQUAL[key](a[key], b[key]));

/** What a row's `⋯` menu and its right-click menu list. */
function rowMenuItems({ pr, change, review, options, pending, cwd, onQuickAction, onRebase }: Pick<RowProps, "pending" | "cwd" | "onQuickAction" | "onRebase"> & { pr: PullRequestSummary; change: Action<[ListChange]>; review: ReviewRequests; options: PullRequestOptionsRead }): PullRequestMenuItemsProps {
	return {
		pr,
		state: pr.state,
		// The menu lists `pullRequestActions(pr)`, so it runs only one of those.
		quick: { actions: pullRequestActions(pr), pending, onRun: action => onQuickAction(pr, cwd, action as PullRequestActionId) },
		rebase: { facts: pr, run: () => onRebase(pr, cwd) },
		onState: to => change.run({ field: "state", state: to }),
		onApprove: canApprove({ state: pr.state, byViewer: pr.role === "author" }) && !pr.viewerApproved ? () => change.run({ field: "review", verdict: "approve", body: "" }) : undefined,
		reviewers: { pr: review.shown, options, onChange: review.send },
		ask: { pr, cwd },
		pending: change.pending,
	};
}

function RowMenu({ items, actionsOpen, onActionsOpenChange }: Pick<RowProps, "actionsOpen" | "onActionsOpenChange"> & { items: PullRequestMenuItemsProps }) {
	return <PullRequestMenu {...items} open={actionsOpen} onOpenChange={open => onActionsOpenChange(items.pr, open)} label="Pull request actions" />;
}

/** A row or card, drawn by `render` around `children`, whose `⋯` menu's actions also open on right-click. */
function RowContextMenu({ items, render, children }: { items: PullRequestMenuItemsProps; render: ReactElement; children: ReactNode }) {
	return (
		<ContextMenu>
			<ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>
			<ContextMenuContent className="min-w-56">
				<PullRequestMenuItems {...items} />
			</ContextMenuContent>
		</ContextMenu>
	);
}

function openFromRow(event: MouseEvent<HTMLElement>, pr: PullRequest): void {
	const target = event.target;
	if (!(target instanceof Element) || event.defaultPrevented || !event.currentTarget.contains(target) || target.closest("a, button, [role=menuitem]")) return;
	if (window.getSelection()?.isCollapsed === false) return;
	rowElement(pr)?.querySelector("a")?.dispatchEvent(new window.MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		shiftKey: event.shiftKey,
		altKey: event.altKey,
	}));
}

/** The pull request's title link remains the keyboard and modifier-click target. */
function TitleLink({ pr, targeted, className }: { pr: PullRequestSummary; targeted: boolean; className: string }) {
	const to = usePageHash();
	return (
		<Tooltip content={`${pullRequestName(pr)} · ${pr.title}`}>
			<a
				href={hashForPullRequests(pr, to)}
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

/**
 * The page's columns: move, title, sessions, stack, checks, review, size, age, and the `⋯` menu. The sessions, stack,
 * and size columns drop out when the page is too narrow for them; on a phone the title takes a line of its own above the rest.
 */
const TABLE_COLUMNS =
	"grid grid-cols-[4rem_minmax(0,1fr)_1.25rem_3.5rem_2rem_1.75rem] items-center gap-x-3 @3xl/pull-requests:grid-cols-[4rem_minmax(0,1fr)_10rem_3.5rem_1.25rem_3.5rem_6rem_2rem_1.75rem] max-phone:grid-cols-[4rem_1.25rem_3.5rem_minmax(0,1fr)_1.75rem] max-phone:gap-y-1.5";

const WIDE = "hidden @3xl/pull-requests:flex";

/** A pull request in the Pull requests page's table: one line per column, with the author, number, and reason under its title. */
export const PullRequestTableRow = memo(function PullRequestTableRow({ row: { pr, move, stack }, sessions, targeted, onOpen, drag, moveId, onChange, ...actions }: RowProps) {
	const change = useRowChange(pr, onChange);
	const options = usePullRequestOptions(pr);
	const review = useReviewRequests(pr, options, onChange);
	const items = rowMenuItems({ pr, change, review, options, ...actions });
	// A review's reason names its author, which this row shows already.
	const why = move === "review" ? null : reason(pr, move);
	return (
		<RowContextMenu
			items={items}
			render={
				<li
					id={rowId(pr)}
					{...drag.handle}
					{...drag.target}
					data-move={moveId}
					onClick={event => openFromRow(event, pr)}
					className={cn("group/row relative cursor-pointer px-3 py-2", targeted ? "bg-muted" : "hover:bg-muted/40", TABLE_COLUMNS, drag.dragging && "opacity-50", drag.dropAt && DROP_LINE[drag.dropAt])}
				/>
			}
		>
			<RowMoveBadge pr={pr} move={move} sessions={sessions} {...actions} />
			<div className="min-w-0 max-phone:order-first max-phone:col-span-full">
				<TitleLink pr={pr} targeted={targeted} className="block truncate" />
				<p className="flex min-w-0 items-center gap-x-1.5 text-xs text-muted-foreground max-phone:flex-wrap max-phone:gap-x-2 max-phone:gap-y-0.5">
					<Avatar person={pr.author} label={`Opened by ${pr.author.login}`} className="size-4 ring-0" />
					<span className="shrink-0">{pr.author.login}</span>
					<span aria-hidden className="max-phone:hidden">·</span>
					<StateTag pr={pr} move={move} />
					<ReviewDraftTag pr={pr} />
					<span className="shrink-0 tabular-nums">#{pr.number}</span>
					<ConversationCount pr={pr} />
					{why && (
						<>
							<span aria-hidden className="max-phone:hidden">·</span>
							<span className="min-w-0 truncate">{why}</span>
							<ThreadStartersTag pr={pr} move={move} />
						</>
					)}
				</p>
			</div>
			<span className={cn(WIDE, "min-w-0 text-xs")}>
				{sessions.length === 0 && fixes(pr, move) ? <NoSession /> : <SessionChips sessions={sessions} onOpen={onOpen} />}
			</span>
			<span className={cn(WIDE, "min-w-0 text-xs text-muted-foreground")}>
				<StackInfo stack={stack} base={pr.stackedOn} />
			</span>
			<span><ChecksIcon checks={pr.checks} /></span>
			<span><ReviewPicker options={options} review={review} /></span>
			<span className={cn(WIDE, "justify-end")}>
				<DiffSize pr={pr} />
			</span>
			<Age at={pr.updatedAt} compact exact className="shrink-0 text-right text-xs tabular-nums text-muted-foreground" />
			<span className="flex justify-end">
				<RowMenu items={items} {...actions} />
			</span>
		</RowContextMenu>
	);
}, sameRowProps);
