import {
	Check,
	ChevronRight,
	CircleCheck,
	CircleDashed,
	CircleSlash,
	CircleX,
	ExternalLink,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	Link2,
	type LucideIcon,
	MessageSquare,
	RefreshCw,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type {
	CheckRunState,
	CheckState,
	Inbox,
	InboxPullRequest,
	PastSession,
	Person,
	PullRequest,
	PullRequestCheck,
	PullRequestComment,
	PullRequestDetail,
	PullRequestEvent,
	PullRequestLink,
	RepoInbox,
	ReviewDecision,
	Reviewer,
	ReviewerState,
	RosterHost,
	SessionLinksEdit,
	SessionLinksResult,
	View,
} from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { readJson } from "../settings-api";
import { refreshInbox, useInbox } from "../use-inbox";
import { usePullRequest } from "../use-pull-request";
import { graphiteUrl, hashForInbox, type InboxTarget, inboxRepoKey, inboxSectionId, inboxSections, type OpenMode, pullRequestUrl, samePullRequest } from "../view-model";
import { Header } from "./conversation";
import { MessageMarkdown } from "./message-markdown";
import { age, hostLabel, modeOf, pastLabel, projectName, SPLIT_CLICK } from "./roster";

/** Folded repositories and sections: `owner/repo`, and `owner/repo:<section title>`. */
const COLLAPSED_KEY = "omp-agents.inbox-collapsed";

const STATE_ICON: Record<PullRequestDetail["state"], [LucideIcon, string, string]> = {
	open: [GitPullRequest, "text-emerald-600 dark:text-emerald-400", "Open pull request"],
	draft: [GitPullRequestDraft, "text-muted-foreground", "Draft pull request, not ready for review"],
	merged: [GitMerge, "text-violet-600 dark:text-violet-400", "Merged pull request"],
	closed: [GitPullRequestClosed, "text-red-600 dark:text-red-400", "Closed pull request"],
};

const CHECK_ICON: Record<Exclude<CheckState, "none">, [LucideIcon, string, string]> = {
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400", "Checks on the latest commit passed"],
	failing: [CircleX, "text-red-600 dark:text-red-400", "Checks on the latest commit failed"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400", "Checks on the latest commit are still running"],
};

const CHECK_RUN_ICON: Record<CheckRunState, [LucideIcon, string]> = {
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400"],
	failing: [CircleX, "text-red-600 dark:text-red-400"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400"],
	skipped: [CircleSlash, "text-muted-foreground"],
};

/** What a comment or review did, after its author's name. */
const EVENT_ACTION: Record<NonNullable<PullRequestEvent["review"]> | "comment", string> = {
	approved: "approved",
	"changes-requested": "requested changes",
	commented: "reviewed",
	dismissed: "reviewed, since dismissed",
	comment: "commented",
};

const REVIEW_LABEL: Record<Exclude<ReviewDecision, "none">, [string, string]> = {
	approved: ["Approved", "text-emerald-600 dark:text-emerald-400"],
	"changes-requested": ["Changes requested", "text-red-600 dark:text-red-400"],
	"review-required": ["Review required", "text-muted-foreground"],
};

/** The dot on a reviewer's picture, and what their tooltip says they did. */
const REVIEWER_STATE: Record<ReviewerState, [string, (login: string) => string]> = {
	approved: ["bg-emerald-500", login => `${login} approved`],
	"changes-requested": ["bg-red-500", login => `${login} requested changes`],
	commented: ["bg-muted-foreground", login => `${login} commented`],
	requested: ["bg-amber-500", login => `Waiting on a review from ${login}`],
};

function storedCollapsed(): Set<string> {
	try {
		const keys: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
		return new Set(Array.isArray(keys) ? keys.filter(key => typeof key === "string") : []);
	} catch {
		return new Set();
	}
}

/** The folded repositories and sections, a toggle, and an unfold for a row the page must show; localStorage keeps them across reloads. */
function useCollapsed(): [ReadonlySet<string>, (key: string) => void, (keys: string[]) => void] {
	const [collapsed, setCollapsed] = useState(storedCollapsed);
	const store = (next: Set<string>): void => {
		setCollapsed(next);
		if (next.size === 0) localStorage.removeItem(COLLAPSED_KEY);
		else localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
	};
	const toggle = (key: string): void => {
		const next = new Set(collapsed);
		if (!next.delete(key)) next.add(key);
		store(next);
	};
	const expand = (keys: string[]): void => {
		const next = new Set(collapsed);
		if (keys.filter(key => next.delete(key)).length > 0) store(next);
	};
	return [collapsed, toggle, expand];
}

interface FoldProps {
	open: boolean;
	onToggle: () => void;
	/** The id of the region the button shows and hides. */
	controls: string;
	children: ReactNode;
	className?: string;
}

function FoldButton({ open, onToggle, controls, children, className }: FoldProps) {
	return (
		<button
			type="button"
			aria-expanded={open}
			aria-controls={controls}
			onClick={onToggle}
			className={cn("-ml-1 flex min-w-0 items-baseline gap-2 rounded px-1 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
		>
			<ChevronRight aria-hidden className={cn("size-3.5 shrink-0 self-center transition-transform", open && "rotate-90")} />
			{children}
		</button>
	);
}

/** An icon with its meaning on hover, and to screen readers. */
function IconTip({ icon: [Icon, color, label], className }: { icon: [LucideIcon, string, string]; className?: string }) {
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className={cn("flex shrink-0", className)}>
				<Icon aria-hidden className={cn("size-4", color)} />
			</span>
		</Tooltip>
	);
}

interface AvatarProps {
	person: Person;
	label: string;
	/** A dot in the corner that marks where a reviewer stands. */
	dot?: string;
	className?: string;
}

function Avatar({ person, label, dot, className }: AvatarProps) {
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className={cn("relative inline-flex size-5 shrink-0 rounded-full bg-muted ring-2 ring-background", className)}>
				{person.avatarUrl ? (
					<img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full rounded-full object-cover" />
				) : (
					<span aria-hidden className="m-auto text-[10px] font-medium uppercase text-muted-foreground">
						{person.login[0]}
					</span>
				)}
				{dot && <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background", dot)} />}
			</span>
		</Tooltip>
	);
}

function Reviewers({ reviewers }: { reviewers: Reviewer[] }) {
	if (reviewers.length === 0) return null;
	return (
		<span className="flex items-center -space-x-1">
			{reviewers.map(reviewer => {
				const [dot, says] = REVIEWER_STATE[reviewer.state];
				return <Avatar key={reviewer.login} person={reviewer} label={says(reviewer.login)} dot={dot} />;
			})}
		</span>
	);
}

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
function sessionsFor(pr: InboxPullRequest, hosts: RosterHost[], past: PastSession[]): SessionLink[] {
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
const rowId = (pr: PullRequest): string => `inbox-pr-${pr.owner}/${pr.repo}/${pr.number}`.toLowerCase();

type Writing = { phase: "idle" | "writing" } | { phase: "done"; changed: boolean } | { phase: "failed"; error: string };

/** Writes links to the PR's sessions into its description on GitHub. Only a click writes, and a rerun replaces the links it wrote. */
function LinkSessionsButton({ pr, sessions }: { pr: PullRequest; sessions: SessionLink[] }) {
	const [writing, setWriting] = useState<Writing>({ phase: "idle" });
	const write = async (): Promise<void> => {
		setWriting({ phase: "writing" });
		const edit: SessionLinksEdit = { owner: pr.owner, repo: pr.repo, number: pr.number, sessionIds: sessions.map(session => session.sessionId) };
		try {
			const response = await fetch("/api/pull-request/sessions", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(edit),
			});
			setWriting({ phase: "done", changed: (await readJson<SessionLinksResult>(response)).changed });
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
	/** The PR the inbox link named: highlighted, with its details open below it. */
	targeted: boolean;
	/** Changes when the page's Refresh asks GitHub again. */
	reload: number;
	onOpen: (view: View, mode: OpenMode) => void;
}

function PullRequestRow({ pr, sessions, targeted, reload, onOpen }: RowProps) {
	const review = pr.state === "merged" || pr.review === "none" ? null : REVIEW_LABEL[pr.review];
	const detailsId = `${rowId(pr)}-details`;
	return (
		<li id={rowId(pr)} data-targeted={targeted || undefined} className={cn("scroll-my-6", targeted && "ring-2 ring-inset ring-ring")}>
			<div className={cn("flex items-start gap-3 px-3 py-2.5", targeted ? "bg-accent/60" : "hover:bg-muted/50")}>
				<IconTip icon={STATE_ICON[pr.state]} className="mt-0.5" />
				<Avatar person={pr.author} label={`Opened by ${pr.author.login}`} className="mt-px" />
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="flex min-w-0 items-baseline gap-2">
						<a
							href={hashForInbox(targeted ? null : pr)}
							aria-expanded={targeted}
							aria-controls={targeted ? detailsId : undefined}
							title={targeted ? "Hide the details" : `Show the details of ${pr.owner}/${pr.repo}#${pr.number}`}
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
					{sessions.length > 0 && <LinkSessionsButton pr={pr} sessions={sessions} />}
					<span className="w-14 whitespace-nowrap text-right tabular-nums text-muted-foreground" title={new Date(pr.updatedAt).toLocaleString()}>
						{age(pr.updatedAt)}
					</span>
				</div>
			</div>
			{targeted && (
				// Indented under the title, past the state icon and the author's picture.
				<div id={detailsId} className="py-4 pr-3 pl-[3.75rem]">
					<PullRequestDetails pr={pr} reload={reload} withTitle={false} />
				</div>
			)}
		</li>
	);
}

/** A titled part of a pull request's details. */
function DetailSection({ title, children }: { title: ReactNode; children: ReactNode }) {
	return (
		<section className="space-y-2">
			<h5 className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">{title}</h5>
			{children}
		</section>
	);
}

/** An external link that says where it goes. */
function OutLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline">
			{children}
			<ExternalLink aria-hidden className="size-3" />
		</a>
	);
}

function Comment({ comment: { author, body, at, url }, action }: { comment: PullRequestComment; action: string }) {
	const when = `${age(at)} ago`;
	return (
		<li className="space-y-1.5">
			<p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
				<Avatar person={author} label={author.login} className="mr-0.5" />
				<span className="font-medium text-foreground">{author.login}</span>
				{action}
				<span title={new Date(at).toLocaleString()}>{url ? <OutLink href={url}>{when}</OutLink> : when}</span>
			</p>
			{body.trim() && (
				<div className="pl-7 text-sm [&_img]:max-w-full">
					<MessageMarkdown text={body} github />
				</div>
			)}
		</li>
	);
}

function CheckRow({ check: { name, state, url } }: { check: PullRequestCheck }) {
	const [Icon, color] = CHECK_RUN_ICON[state];
	return (
		<li className="flex min-w-0 items-center gap-2">
			<Icon aria-label={state} className={cn("size-3.5 shrink-0", color)} />
			{url ? (
				<a href={url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
					{name}
				</a>
			) : (
				<span className="truncate">{name}</span>
			)}
		</li>
	);
}

/** Failing and pending checks in full; passing and skipped ones folded behind their counts. */
function Checks({ checks }: { checks: PullRequestCheck[] }) {
	const waiting = checks.filter(check => check.state === "failing" || check.state === "pending");
	const settled = checks.filter(check => check.state === "passing" || check.state === "skipped");
	const passing = settled.filter(check => check.state === "passing").length;
	const skipped = settled.length - passing;
	return (
		<div className="space-y-1.5 text-xs">
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

interface DetailsProps {
	pr: PullRequest;
	/** Changes when the page's Refresh asks GitHub again. */
	reload: number;
	/** Shows the title and state, which a row already shows. */
	withTitle: boolean;
}

/** A pull request's description, checks, unresolved comments, conversation, and files, read from GitHub in place of opening it there. */
function PullRequestDetails({ pr, reload, withTitle }: DetailsProps) {
	const { detail, error } = usePullRequest(pr, reload);
	if (!detail) {
		return error ? (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				Cannot load the pull request: {error}
			</p>
		) : (
			<p className="text-sm text-muted-foreground">Asking GitHub for the pull request…</p>
		);
	}
	const { body, checks, threads, conversation, files } = detail;
	return (
		<div className="space-y-5">
			{withTitle && (
				<div className="flex items-start gap-3">
					<IconTip icon={STATE_ICON[detail.state]} className="mt-0.5" />
					<h4 className="min-w-0 text-sm font-medium">
						{detail.title} <span className="text-xs font-normal tabular-nums text-muted-foreground">#{detail.number}</span>
					</h4>
				</div>
			)}
			{error && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					Cannot refresh the pull request: {error}
				</p>
			)}
			<p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
				<span className="min-w-0 truncate">
					<span className="font-mono">{detail.head}</span> into <span className="font-mono">{detail.base}</span>
				</span>
				<span className="tabular-nums">
					<span className="text-emerald-600 dark:text-emerald-400">+{detail.additions}</span>{" "}
					<span className="text-red-600 dark:text-red-400">−{detail.deletions}</span> in {detail.changedFiles}{" "}
					{detail.changedFiles === 1 ? "file" : "files"}
				</span>
				<span title={new Date(detail.createdAt).toLocaleString()}>
					opened by {detail.author.login} {age(detail.createdAt)} ago
				</span>
				<span className="ml-auto flex gap-3">
					<OutLink href={pullRequestUrl(detail)}>GitHub</OutLink>
					<OutLink href={graphiteUrl(detail)}>Graphite</OutLink>
				</span>
			</p>
			<DetailSection title="Description">
				{body.trim() ? (
					<div className="text-sm [&_img]:max-w-full">
						<MessageMarkdown text={body} github />
					</div>
				) : (
					<p className="text-sm text-muted-foreground">No description.</p>
				)}
			</DetailSection>
			{checks.length > 0 && (
				<DetailSection title="Checks">
					<Checks checks={checks} />
				</DetailSection>
			)}
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
							<li key={index} className="space-y-3 rounded-md border border-border p-3">
								<p className="truncate font-mono text-xs text-muted-foreground" title={thread.path}>
									{thread.path}
									{thread.line !== null && `:${thread.line}`}
								</p>
								<ul className="space-y-3">
									{thread.comments.map((comment, at) => (
										<Comment key={at} comment={comment} action={at === 0 ? "commented" : "replied"} />
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
							<Comment key={index} comment={event} action={EVENT_ACTION[event.review ?? "comment"]} />
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
					<ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border font-mono text-xs">
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
		</div>
	);
}

interface RepoProps {
	inbox: RepoInbox;
	hosts: RosterHost[];
	past: PastSession[];
	target: PullRequest | null;
	reload: number;
	collapsed: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onOpen: (view: View, mode: OpenMode) => void;
}

function RepoSection({ inbox, hosts, past, target, reload, collapsed, onToggle, onOpen }: RepoProps) {
	const name = `${inbox.owner}/${inbox.repo}`;
	const key = inboxRepoKey(inbox);
	const headingId = `inbox-${name}`;
	const bodyId = `${headingId}-body`;
	const open = !collapsed.has(key);
	const sections = "error" in inbox ? [] : inboxSections(inbox.pullRequests);
	let body: ReactNode;
	if ("error" in inbox) {
		body = (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				Cannot read {name} from GitHub: {inbox.error}
			</p>
		);
	} else if (sections.length === 0) {
		body = <p className="text-sm text-muted-foreground">No open pull requests of yours and no reviews waiting on you.</p>;
	} else {
		body = sections.map(section => {
			const sectionKey = `${key}:${section.title}`;
			const sectionOpen = !collapsed.has(sectionKey);
			const sectionId = inboxSectionId({ repo: key, title: section.title });
			const listId = `${sectionId}-list`;
			return (
				// Focused when its sidebar link is chosen.
				<div key={section.title} id={sectionId} tabIndex={-1} className="scroll-mt-6 space-y-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<h4 className="text-xs font-medium text-muted-foreground">
						<FoldButton open={sectionOpen} onToggle={() => onToggle(sectionKey)} controls={listId}>
							{section.title}
							<span className="tabular-nums">{section.pullRequests.length}</span>
						</FoldButton>
					</h4>
					{sectionOpen && (
						<ul id={listId} className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{section.pullRequests.map(pr => (
								<PullRequestRow
									key={pr.number}
									pr={pr}
									sessions={sessionsFor(pr, hosts, past)}
									targeted={target !== null && samePullRequest(pr, target)}
									reload={reload}
									onOpen={onOpen}
								/>
							))}
						</ul>
					)}
				</div>
			);
		});
	}
	return (
		<section aria-labelledby={headingId} className="space-y-4">
			<h3 id={headingId} className="text-sm font-semibold">
				<FoldButton open={open} onToggle={() => onToggle(key)} controls={bodyId}>
					{name}
					<span className="truncate text-xs font-normal text-muted-foreground" title={inbox.cwds.join("\n")}>
						{inbox.cwds.length === 1 ? projectName(inbox.cwds[0]!) : `${inbox.cwds.length} workspaces`}
					</span>
				</FoldButton>
			</h3>
			{open && (
				<div id={bodyId} className="space-y-4">
					{body}
				</div>
			)}
		</section>
	);
}

/** The fold keys of the repository and the section that list `pr`, or `null` when the inbox does not list it. */
function placeOf(inbox: Inbox, pr: PullRequest): { repo: string; section: string } | null {
	for (const repo of inbox.repos) {
		if ("error" in repo) continue;
		const section = inboxSections(repo.pullRequests).find(({ pullRequests }) => pullRequests.some(other => samePullRequest(other, pr)));
		const key = `${repo.owner}/${repo.repo}`.toLowerCase();
		if (section) return { repo: key, section: `${key}:${section.title}` };
	}
	return null;
}

/** Why the inbox does not list the PR a link named, then that PR's details. `allProjects`: the sidebar shows every project. */
function MissingTarget({ target, inbox, allProjects, reload }: { target: PullRequest; inbox: Inbox; allProjects: boolean; reload: number }) {
	const repo = `${target.owner}/${target.repo}`;
	const covered = inbox.repos.some(other => `${other.owner}/${other.repo}`.toLowerCase() === repo.toLowerCase());
	let reason = `${repo}#${target.number} is not in this inbox, which covers only the project that the sidebar shows. Choose All projects in the sidebar to include ${repo}.`;
	if (covered) {
		reason = `${repo}#${target.number} is not in this inbox. The inbox lists your open pull requests, your merges from the last seven days, and the pull requests that wait for your review.`;
	} else if (allProjects) {
		reason = `${repo}#${target.number} is not in this inbox, because no session ran in ${repo}.`;
	}
	return (
		<div className="space-y-4 rounded-md border border-border p-4 ring-2 ring-inset ring-ring">
			<p role="status" className="text-sm text-muted-foreground">
				{reason}
			</p>
			<PullRequestDetails key={rowId(target)} pr={target} reload={reload} withTitle />
		</div>
	);
}

interface InboxPageProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** The PR an inbox link named: its row unfolds, scrolls into view, stays highlighted, and shows its details. */
	target: PullRequest | null;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The section a sidebar link last chose, to unfold, scroll to, and focus. */
	section: InboxTarget | null;
}

/** The pull requests of the sidebar's project, or of every project, in Graphite's inbox sections, read from GitHub. */
export function InboxPage({ project, hosts, past, target, onOpen, section }: InboxPageProps) {
	const { read, error, refreshing } = useInbox(project, true);
	const [collapsed, toggleCollapsed, expand] = useCollapsed();
	/** Counts the Refresh button's presses, which read the open pull request's details again too. */
	const [reload, setReload] = useState(0);
	const place = read && target ? placeOf(read.inbox, target) : null;
	const targetKey = target && rowId(target);
	/** The target whose row the page already unfolded and scrolled to; folding it again afterwards stays folded. */
	const shown = useRef<string | null>(null);
	/** The sidebar section the page already unfolded, scrolled to, and focused. */
	const revealed = useRef<InboxTarget | null>(null);

	useEffect(() => {
		if (!place || !targetKey || shown.current === targetKey) return;
		const folded = [place.repo, place.section].filter(key => collapsed.has(key));
		if (folded.length > 0) {
			// Unfolding renders the row; this effect runs again and then scrolls to it.
			expand(folded);
			return;
		}
		shown.current = targetKey;
		document.getElementById(targetKey)?.scrollIntoView({ block: "start", behavior: "smooth" });
	}, [place?.repo, place?.section, targetKey, collapsed]);

	// Waits for the section to unfold, and for an inbox that has it to load.
	useEffect(() => {
		if (!section || revealed.current === section) return;
		const folds = [section.repo, `${section.repo}:${section.title}`];
		if (folds.some(key => collapsed.has(key))) return expand(folds);
		const element = document.getElementById(inboxSectionId(section));
		if (!element) return;
		revealed.current = section;
		element.scrollIntoView({ block: "start" });
		element.focus({ preventScroll: true });
	});

	let body: ReactNode;
	if (!read && error) body = <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot load the inbox: {error}</p>;
	else if (!read) body = <p className="text-sm text-muted-foreground">Asking GitHub for pull requests…</p>;
	else {
		const { repos, unmatched } = read.inbox;
		body = (
			<>
				{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the inbox: {error}</p>}
				{target && !place && <MissingTarget target={target} inbox={read.inbox} allProjects={project === null} reload={reload} />}
				{repos.length === 0 && <p className="text-sm text-muted-foreground">No session ran in a GitHub repository.</p>}
				{repos.map(repo => (
					<RepoSection
						key={`${repo.owner}/${repo.repo}`}
						inbox={repo}
						hosts={hosts}
						past={past}
						target={target}
						reload={reload}
						collapsed={collapsed}
						onToggle={toggleCollapsed}
						onOpen={onOpen}
					/>
				))}
				{unmatched.length > 0 && (
					<p className="text-xs text-muted-foreground" title={unmatched.join("\n")}>
						{unmatched.length === 1 ? "1 workspace has" : `${unmatched.length} workspaces have`} no GitHub origin and is left out.
					</p>
				)}
			</>
		);
	}

	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header
				title="Inbox"
				meta={
					read
						? `Your pull requests and review requests on GitHub · updated ${
								new Date(read.at).toDateString() === new Date().toDateString()
									? new Date(read.at).toLocaleTimeString()
									: new Date(read.at).toLocaleString()
							}`
						: "Your pull requests and review requests on GitHub"
				}
			>
				<Button
					variant="ghost"
					size="compact"
					leadingIcon={RefreshCw}
					disabled={refreshing}
					onClick={() => {
						void refreshInbox(project, true);
						setReload(count => count + 1);
					}}
				>
					{refreshing ? "Refreshing…" : "Refresh"}
				</Button>
			</Header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<TooltipProvider>
					<div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-6">{body}</div>
				</TooltipProvider>
			</div>
		</div>
	);
}
