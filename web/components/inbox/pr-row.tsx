import { Check, CircleCheck, CircleDashed, CircleX, GitMerge, Layers, Link2, type LucideIcon, MessageSquare } from "lucide-react";
import { useState } from "react";
import {
	type CheckState,
	type HostStatus,
	type InboxPullRequest,
	type PastSession,
	type PullRequest,
	type PullRequestLink,
	type RosterHost,
	type SessionLinksEdit,
	type SessionLinksResult,
	repoKey,
	samePullRequest,
	type View,
} from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { errorText, putJson } from "../../api";
import { type InboxRow, pullRequestUrl, type RowVerdict, rowVerdict, type StackPlace } from "../../inbox-model";
import { hashForInbox, type OpenMode } from "../../routing";
import { age, hostLabel, modeOf, pastLabel, SPLIT_CLICK } from "../../labels";
import { type PullRequestActionId, pullRequestActions, type QuickActionId } from "../../quick-actions";
import { BranchName } from "../git";
import { AddToTodo } from "../add-to-todo";
import { QuickActionsMenu } from "../quick-actions";
import { SessionChip } from "../session-chip";
import { StatusDot, statusLabel } from "../status-dot";
import { Avatar, IconTip, Reviewers, STATE_ICON } from "./avatars";

const CHECK_ICON: Record<Exclude<CheckState, "none">, [LucideIcon, string, string]> = {
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400", "Checks on the latest commit passed"],
	failing: [CircleX, "text-red-600 dark:text-red-400", "Checks on the latest commit failed"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400", "Checks on the latest commit are still running"],
};

const CONFLICTS_ICON: [LucideIcon, string, string] = [GitMerge, "text-red-600 dark:text-red-400", "Merge conflicts with its base branch"];

const VERDICT_LABEL: Record<Exclude<RowVerdict, null>, [string, string]> = {
	ready: ["Ready to merge", "text-emerald-600 dark:text-emerald-400"],
	approved: ["Approved", "text-emerald-600 dark:text-emerald-400"],
	"changes-requested": ["Changes requested", "text-red-600 dark:text-red-400"],
};

/** How many review threads wait for a resolution, shown only while some might. */
function Unresolved({ unresolved: { count, exact } }: { unresolved: InboxPullRequest["unresolved"] }) {
	if (count === 0 && exact) return null;
	const label = exact
		? `${count} unresolved ${count === 1 ? "comment" : "comments"}`
		: `At least ${count} unresolved comments; GitHub listed only some threads`;
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground">
				<MessageSquare aria-hidden className="size-4" />
				{exact ? count : `${count}+`}
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

const LINK_VERB: Record<PullRequestLink, string> = { submitted: "submitted", worked: "worked on" };

/** The first session on the pull request as a chip, then the others behind a `+N` menu that lists every one. */
function SessionChips({ sessions, onOpen }: { sessions: SessionLink[]; onOpen: (view: View, mode: OpenMode) => void }) {
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
				<DropdownMenu>
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
					<DropdownMenuContent align="start" className="max-w-80">
						{sessions.map(session => (
							<MenuItem key={session.sessionId} title={`Open it (${SPLIT_CLICK} to split)`} onClick={event => onOpen(session.view, modeOf(event))}>
								{session.status ? <StatusDot status={session.status} /> : <span className="w-1.5 shrink-0" />}
								<span className="min-w-0 flex-1 truncate">{session.label}</span>
								<span className="shrink-0 text-xs text-muted-foreground">{LINK_VERB[session.link]}</span>
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
	/** The PR the inbox link named, highlighted while its sheet shows. */
	targeted: boolean;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The quick action whose session is starting for this PR, if any. */
	pending: QuickActionId | null;
	onQuickAction: (action: PullRequestActionId) => void;
}

export function PullRequestRow({ row: { pr, stack }, sessions, targeted, onOpen, pending, onQuickAction }: RowProps) {
	const verdict = rowVerdict(pr);
	return (
		<li id={rowId(pr)} data-targeted={targeted || undefined} className={cn("group/row relative scroll-my-6", targeted && "ring-2 ring-inset ring-ring")}>
			{stack?.joinsAbove && <span aria-hidden className="absolute top-0 left-[19.5px] h-3 w-px bg-border" />}
			{stack?.joinsBelow && <span aria-hidden className="absolute top-7 bottom-0 left-[19.5px] w-px bg-border" />}
			<div className={cn("flex items-start gap-3 px-3 py-2.5", targeted ? "bg-accent/60" : "hover:bg-muted/50")}>
				<IconTip icon={STATE_ICON[pr.state]} className="mt-0.5" />
				{pr.role === "reviewer" && <Avatar person={pr.author} label={`Opened by ${pr.author.login}`} className="mt-px" />}
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="flex min-w-0 items-baseline gap-2">
						<a
							href={hashForInbox(pr)}
							aria-haspopup="dialog"
							title={`Show the details of ${pr.owner}/${pr.repo}#${pr.number}`}
							className="truncate rounded-sm text-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
						>
							{pr.title}
						</a>
						<span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{pr.number}</span>
					</div>
					<p className="flex min-w-0 items-center gap-x-1.5 text-xs text-muted-foreground">
						<BranchName name={pr.head} className="min-w-0 truncate font-mono" />
						{stack ? (
							<StackChip stack={stack} base={pr.stackedOn} />
						) : (
							pr.stackedOn && (
								<span className="min-w-0 truncate" title={`Stacked on ${pr.stackedOn}`}>
									on <span className="font-mono">{pr.stackedOn}</span>
								</span>
							)
						)}
						{pr.role === "reviewer" && <span className="shrink-0">· by {pr.author.login}</span>}
						<SessionChips sessions={sessions} onOpen={onOpen} />
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-3 text-xs">
					<Reviewers reviewers={pr.reviewers} />
					{verdict && <span className={VERDICT_LABEL[verdict][1]}>{VERDICT_LABEL[verdict][0]}</span>}
					<Unresolved unresolved={pr.unresolved} />
					{pr.checks !== "none" && <IconTip icon={CHECK_ICON[pr.checks]} />}
					{pr.conflicts && <IconTip icon={CONFLICTS_ICON} />}
					<span
						className={cn(
							"flex items-center gap-1 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[data-busy]]:opacity-100 has-[[data-popup-open]]:opacity-100 [@media(hover:none)]:opacity-100",
							pending === null && "opacity-0",
						)}
					>
						<AddToTodo
							text={pr.title}
							body={`Pull request https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`}
							link={{ kind: "pull-request", owner: pr.owner, repo: pr.repo, number: pr.number }}
							label={`Add ${pr.repo}#${pr.number} to your todo list`}
						/>
						<span data-row-actions className="flex">
							<QuickActionsMenu
								actions={pullRequestActions(pr)}
								pending={pending}
								onRun={onQuickAction}
								label="Quick actions: start a session in the background that works on this pull request"
							/>
						</span>
						{sessions.length > 0 && <LinkSessionsButton pr={pr} sessions={sessions} />}
					</span>
					<span className="w-14 whitespace-nowrap text-right tabular-nums text-muted-foreground" title={new Date(pr.updatedAt).toLocaleString()}>
						{age(pr.updatedAt)}
					</span>
				</div>
			</div>
		</li>
	);
}
