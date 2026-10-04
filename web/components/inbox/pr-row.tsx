import { Check, CircleCheck, CircleDashed, CircleX, GitMerge, Link2, type LucideIcon, MessageSquare } from "lucide-react";
import { useState } from "react";
import {
	type CheckState,
	type InboxPullRequest,
	type PastSession,
	type PullRequest,
	type PullRequestLink,
	type ReviewDecision,
	type RosterHost,
	type SessionLinksEdit,
	type SessionLinksResult,
	repoKey,
	samePullRequest,
	type View,
} from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { putJson } from "../../api";
import { hashForInbox, type OpenMode } from "../../routing";
import { age, hostLabel, modeOf, pastLabel, SPLIT_CLICK } from "../../labels";
import { type PullRequestActionId, pullRequestActions } from "../../quick-actions";
import { QuickActionsMenu } from "../quick-actions";
import { Avatar, IconTip, Reviewers, STATE_ICON } from "./avatars";

const CHECK_ICON: Record<Exclude<CheckState, "none">, [LucideIcon, string, string]> = {
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400", "Checks on the latest commit passed"],
	failing: [CircleX, "text-red-600 dark:text-red-400", "Checks on the latest commit failed"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400", "Checks on the latest commit are still running"],
};

const CONFLICTS_ICON: [LucideIcon, string, string] = [GitMerge, "text-red-600 dark:text-red-400", "Merge conflicts with its base branch"];

const REVIEW_LABEL: Record<Exclude<ReviewDecision, "none">, [string, string]> = {
	approved: ["Approved", "text-emerald-600 dark:text-emerald-400"],
	"changes-requested": ["Changes requested", "text-red-600 dark:text-red-400"],
	"review-required": ["Review required", "text-muted-foreground"],
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
}

/** The sessions that submitted `pr`, then those that worked on it, live ones first within each. */
export function sessionsFor(pr: InboxPullRequest, hosts: RosterHost[], past: PastSession[]): SessionLink[] {
	const linked = [
		...hosts.flatMap(host => {
			const found = host.pullRequests.find(other => samePullRequest(other, pr));
			const view: View = { kind: "live", instanceId: host.instanceId, agentId: null };
			return found ? [{ view, sessionId: host.sessionId, label: hostLabel(host), link: found.link }] : [];
		}),
		...past.flatMap(session => {
			const found = session.pullRequests.find(other => samePullRequest(other, pr));
			const view: View = { kind: "past", sessionId: session.sessionId };
			return found ? [{ view, sessionId: session.sessionId, label: pastLabel(session), link: found.link }] : [];
		}),
	];
	return linked.toSorted((a, b) => Number(a.link === "worked") - Number(b.link === "worked"));
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
			setWriting({ phase: "failed", error: err instanceof Error ? err.message : String(err) });
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
				className={cn("text-muted-foreground", writing.phase === "failed" && "text-red-600 dark:text-red-400")}
				onClick={() => void write()}
			>
				{writing.phase === "done" ? <Check /> : <Link2 />}
			</Button>
		</Tooltip>
	);
}

interface RowProps {
	pr: InboxPullRequest;
	sessions: SessionLink[];
	/** The PR the inbox link named, highlighted while its sheet shows. */
	targeted: boolean;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The quick action whose session is starting for this PR, if any. */
	pending: PullRequestActionId | null;
	onQuickAction: (action: PullRequestActionId) => void;
}

export function PullRequestRow({ pr, sessions, targeted, onOpen, pending, onQuickAction }: RowProps) {
	const review = pr.state === "merged" || pr.review === "none" ? null : REVIEW_LABEL[pr.review];
	return (
		<li id={rowId(pr)} data-targeted={targeted || undefined} className={cn("scroll-my-6", targeted && "ring-2 ring-inset ring-ring")}>
			<div className={cn("flex items-start gap-3 px-3 py-2.5", targeted ? "bg-accent/60" : "hover:bg-muted/50")}>
				<IconTip icon={STATE_ICON[pr.state]} className="mt-0.5" />
				<Avatar person={pr.author} label={`Opened by ${pr.author.login}`} className="mt-px" />
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
					<p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
						<span className="truncate font-mono" title={pr.head}>
							{pr.head}
						</span>
						{pr.stackedOn && (
							<span className="truncate" title={`Stacked on ${pr.stackedOn}`}>
								on <span className="font-mono">{pr.stackedOn}</span>
							</span>
						)}
						{pr.role === "reviewer" && <span>· by {pr.author.login}</span>}
						{sessions.slice(0, 3).map(session => (
							<button
								key={session.sessionId}
								type="button"
								title={`Open the session that ${session.link === "submitted" ? "submitted" : "worked on"} it (${SPLIT_CLICK} to split)`}
								onClick={event => onOpen(session.view, modeOf(event))}
								className={cn(
									"max-w-48 truncate rounded px-1.5 py-px text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
									session.link === "submitted" ? "bg-muted" : "ring-1 ring-inset ring-border",
								)}
							>
								{session.label}
							</button>
						))}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-3 text-xs">
					<Reviewers reviewers={pr.reviewers} />
					{review && <span className={review[1]}>{review[0]}</span>}
					<Unresolved unresolved={pr.unresolved} />
					{pr.checks !== "none" && <IconTip icon={CHECK_ICON[pr.checks]} />}
					{pr.conflicts && <IconTip icon={CONFLICTS_ICON} />}
					<QuickActionsMenu
						actions={pullRequestActions(pr)}
						pending={pending}
						onRun={onQuickAction}
						label="Quick actions: start a session in the background that works on this pull request"
					/>
					{sessions.length > 0 && <LinkSessionsButton pr={pr} sessions={sessions} />}
					<span className="w-14 whitespace-nowrap text-right tabular-nums text-muted-foreground" title={new Date(pr.updatedAt).toLocaleString()}>
						{age(pr.updatedAt)}
					</span>
				</div>
			</div>
		</li>
	);
}
