import { Check, Layers, Link2 } from "lucide-react";
import { useState } from "react";
import { type InboxPullRequest, type PullRequest, pullRequestUrl, type PullRequestLink, type SessionLinksEdit, type SessionLinksResult, repoKey, samePullRequest } from "../../../src/shared/github";
import type { HostStatus, PastSession, RosterHost, View } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuShortcut } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import { errorText, putJson } from "../../api";
import { type InboxRow, MOVES, type MoveId, reason, type StackPlace } from "../../inbox-model";
import { hashForInbox, type OpenMode } from "../../routing";
import { age, hostLabel, modeOf, pastLabel, SPLIT_CLICK } from "../../labels";
import { type PullRequestActionId, pullRequestActions } from "../../../src/pull-request-actions";
import type { QuickActionId } from "../../quick-actions";
import { DROP_LINE, type DragItem } from "../../use-drag-order";
import { AddToTodo } from "../todo/add-button";
import { QuickActionsMenu } from "../quick-actions";
import { SessionChip } from "../session-chip";
import { StatusDot, statusLabel } from "../status-dot";

const RED = "bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300";
const MUTED = "bg-muted text-muted-foreground";

const MOVE_TONE: Record<MoveId, string> = {
	review: "bg-blue-500/10 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300",
	merge: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
	"fix-ci": RED,
	rebase: RED,
	reply: "bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
	answer: "bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
	agent: MUTED,
	"in-review": MUTED,
	"checks-running": MUTED,
	draft: MUTED,
	merged: "bg-violet-500/5 text-violet-600/70 dark:bg-violet-400/10 dark:text-violet-300/70",
};

/** The move a pull request waits on, as a fixed-width verb; an agent's work leads with the green dot of a working session. */
export function MoveBadge({ move, className }: { move: MoveId; className?: string }) {
	return (
		<span
			className={cn("flex h-5 w-16 shrink-0 items-center justify-center gap-1 rounded-[5px] text-[11px] whitespace-nowrap", MOVE_TONE[move], className)}
			style={{ fontVariationSettings: fontWeights.semibold }}
		>
			{move === "agent" && <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />}
			{MOVES[move].label}
		</span>
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

const LINK_VERB: Record<PullRequestLink, string> = { submitted: "submitted", worked: "worked on" };

/** The first session on the pull request as a chip, then the others behind a `+N` menu that lists every one. */
function SessionChips({ sessions, onOpen }: { sessions: SessionLink[]; onOpen: (view: View, mode: OpenMode) => void }) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [first] = sessions;
	if (!first) return null;
	return (
		<>
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
		</>
	);
}

/** Where the row sits in its stack, with the branch it stacks on in its tooltip. */
function StackChip({ stack, base }: { stack: StackPlace; base: string | null }) {
	const label = `Pull request ${stack.position} of ${stack.size} in a stack, on ${base ?? "the default branch"}`;
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className="flex shrink-0 items-center gap-1 tabular-nums">
				<Layers aria-hidden className="size-3" />
				{stack.position}/{stack.size}
			</span>
		</Tooltip>
	);
}

/** The DOM id of a pull request's row, which an inbox link to that PR scrolls to. */
export const rowId = (pr: PullRequest): string => `inbox-pr-${repoKey(pr)}/${pr.number}`;

/** The row's element and its link: what the inbox's keys reach by id, so the markup below is their contract. */
export const rowElement = (pr: PullRequest): HTMLElement | null => document.getElementById(rowId(pr));
export const rowLink = (pr: PullRequest): HTMLAnchorElement | null => rowElement(pr)?.querySelector("a") ?? null;

type Writing = { phase: "idle" | "writing" } | { phase: "done"; changed: boolean } | { phase: "failed"; error: string };

/** Writes links to the PR's sessions into its description on GitHub. Only a click writes, and a rerun replaces the links it wrote. */
function LinkSessionsButton({ pr, sessions }: { pr: PullRequest; sessions: SessionLink[] }) {
	const [writing, setWriting] = useState<Writing>({ phase: "idle" });
	const write = async (): Promise<void> => {
		setWriting({ phase: "writing" });
		const edit: SessionLinksEdit = { owner: pr.owner, repo: pr.repo, number: pr.number, sessionIds: sessions.map(session => session.sessionId) };
		try {
			setWriting({ phase: "done", changed: (await putJson<SessionLinksResult>("/api/pull-request/sessions", edit)).changed });
		} catch (err) {
			setWriting({ phase: "failed", error: errorText(err) });
		}
	};
	const count = sessions.length === 1 ? "this session" : `these ${sessions.length} sessions`;
	const label =
		writing.phase === "done"
			? writing.changed
				? `Linked ${count} in the pull request's description`
				: `The pull request's description already links ${count}`
			: writing.phase === "failed"
				? `Cannot write the description: ${writing.error}`
				: `Link ${count} in the pull request's description on GitHub. The links open only on this machine.`;
	return (
		<Tooltip content={label}>
			<Button
				variant="ghost"
				size="icon-compact"
				aria-label={label}
				loading={writing.phase === "writing"}
				// Keeps the row's hover-only buttons shown while the write runs and after, so its outcome stays readable.
				data-busy={writing.phase === "idle" ? undefined : ""}
				className={cn("text-muted-foreground", writing.phase === "failed" && "text-red-600 dark:text-red-400")}
				onClick={() => void write()}
			>
				{writing.phase === "done" ? <Check /> : <Link2 />}
			</Button>
		</Tooltip>
	);
}

interface RowProps {
	row: InboxRow;
	sessions: SessionLink[];
	/** The pull request whose details the main area shows. */
	targeted: boolean;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The quick action whose session is starting for this PR, if any. */
	pending: QuickActionId | null;
	onQuickAction: (action: PullRequestActionId) => void;
	/** Whether the row's quick actions menu is open, which the `.` shortcut also sets. */
	actionsOpen: boolean;
	onActionsOpenChange: (open: boolean) => void;
	drag: DragItem;
	/** What the move shortcuts name the row by. */
	moveId: string;
}

/** A pull request in the sidebar's inbox: its move, title, and age, then why it waits on that move, with its actions on hover. */
export function PullRequestRow({ row: { pr, move, stack }, sessions, targeted, onOpen, pending, onQuickAction, actionsOpen, onActionsOpenChange, drag, moveId }: RowProps) {
	return (
		<li id={rowId(pr)} {...drag.handle} {...drag.target} data-move={moveId} className={cn("group/row relative", drag.dragging && "opacity-50", drag.dropAt && DROP_LINE[drag.dropAt])}>
			{stack?.joinsAbove && <span aria-hidden className="absolute top-0 left-[39.5px] h-1.5 w-px bg-border" />}
			{stack?.joinsBelow && <span aria-hidden className="absolute top-[26px] bottom-0 left-[39.5px] w-px bg-border" />}
			<div className={cn("flex items-start gap-2 rounded-md px-2 py-1.5", targeted ? "bg-sidebar-accent" : "group-hover/row:bg-sidebar-accent/50")}>
				<MoveBadge move={move} />
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="flex min-w-0 items-baseline gap-2">
						<Tooltip content={`${pr.owner}/${pr.repo}#${pr.number} · ${pr.title}`}>
							<a
								href={hashForInbox(pr)}
								// The row drags, not the link's address.
								draggable={false}
								aria-current={targeted ? "page" : undefined}
								className="min-w-0 flex-1 truncate rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{pr.title}
							</a>
						</Tooltip>
						<span className="shrink-0 text-xs tabular-nums text-muted-foreground" title={new Date(pr.updatedAt).toLocaleString()}>
							{age(pr.updatedAt)}
						</span>
					</div>
					<p className="flex min-w-0 items-center gap-x-1.5 overflow-hidden text-xs text-muted-foreground">
						<span className="shrink-0 tabular-nums">#{pr.number}</span>
						<span aria-hidden>·</span>
						{/* The reason is why the row is here, so the stack and session chips shrink before it does. */}
						<span className="max-w-full shrink-0 truncate">{reason(pr, move)}</span>
						{stack ? (
							<StackChip stack={stack} base={pr.stackedOn} />
						) : (
							pr.stackedOn && (
								<Tooltip content={`Stacked on ${pr.stackedOn}`}>
									<span className="min-w-0 truncate">
										on <span className="font-mono">{pr.stackedOn}</span>
									</span>
								</Tooltip>
							)
						)}
						<SessionChips sessions={sessions} onOpen={onOpen} />
					</p>
				</div>
			</div>
			<span
				className={cn(
					"absolute top-1 right-1 flex items-center gap-0.5 rounded-md bg-sidebar transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[data-busy]]:opacity-100 has-[[data-popup-open]]:opacity-100 [@media(hover:none)]:opacity-100",
					pending === null && "opacity-0",
				)}
			>
				<AddToTodo
					text={pr.title}
					body={`Pull request ${pullRequestUrl(pr)}`}
					link={{ kind: "pull-request", owner: pr.owner, repo: pr.repo, number: pr.number }}
					label={`Add ${pr.repo}#${pr.number} to your todo list`}
				/>
				<QuickActionsMenu
					actions={pullRequestActions(pr)}
					pending={pending}
					onRun={onQuickAction}
					open={actionsOpen}
					onOpenChange={onActionsOpenChange}
					label="Quick actions: start a session in the background that works on this pull request"
				/>
				{sessions.length > 0 && <LinkSessionsButton pr={pr} sessions={sessions} />}
			</span>
		</li>
	);
}
