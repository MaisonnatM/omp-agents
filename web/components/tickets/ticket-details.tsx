import { CornerLeftUp, ExternalLink, GitPullRequest, Link2 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { pullRequestOfUrl } from "../../../src/shared/github";
import type { Ticket, TicketDetail, TicketRelative } from "../../../src/shared/tickets";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Editable } from "../../editable-read";
import { age } from "../../labels";
import { hashForTickets } from "../../routing";
import { PRIORITY_LABEL, subIssueOrder } from "../../tickets-model";
import { CopyableCode } from "../copyable-code";
import { IconTip } from "../pull-requests/avatars";
import { SummarySection } from "../pull-requests/pr-details/section";
import { Rail, RailRow } from "../rail";
import { Comment, LoadNote, Markdown } from "../sheet-details";
import { TicketFields } from "./ticket-fields";
import { PRIORITY_ICON, statusIcon } from "./ticket-row";

interface TicketDetailContentProps {
	id: string;
	/** The issue as the page lists it, which names it while Linear answers; `null` when the page does not list it. */
	listed: Ticket | null;
	/** Linear's answer for the issue, which the fields edit. */
	read: Editable<TicketDetail>;
	actions?: (ticket: Ticket) => ReactNode;
	/** The tickets page focuses its title; the session details sidebar leaves focus where it is. */
	placement?: "page" | "sidebar";
	/** Shows the parent or a sub-issue in place, as the sidebar does; without it they link to the Tickets page. */
	onPick?: (id: string) => void;
}

/**
 * A Linear issue laid out as a pull request's Summary is: a header with the team, the identifier, the quick actions,
 * the title, who opened it, and its branch; then its properties, and its description, sub-issues, links, and comments
 * in sections that fold.
 */
export function TicketDetailContent({ id, listed, read, actions, placement = "page", onPick }: TicketDetailContentProps) {
	const { data: detail, error } = read;
	const ticket = detail ?? listed;
	const page = placement === "page";
	return (
		<div className="min-w-0">
			<TicketHeader id={id} ticket={ticket} detail={detail} actions={actions} page={page} onPick={onPick} />
			<div className="border-t border-border/60">
				{ticket && (
					<div className="px-4 pt-2.5 pb-1">
						<TicketFields ticket={ticket} detail={detail} edit={read.edit} saveError={read.saveError} />
					</div>
				)}
				{detail ? (
					<TicketBody detail={detail} page={page} onPick={onPick} />
				) : (
					<div className="px-4 py-4">
						<LoadNote loading="Asking Linear for the issue…" error={error && `Cannot load the issue: ${error}`} />
					</div>
				)}
			</div>
		</div>
	);
}

interface TicketHeaderProps extends Pick<TicketDetailContentProps, "id" | "actions" | "onPick"> {
	ticket: Ticket | null;
	detail: TicketDetail | null;
	page: boolean;
}

/** The pull request header's shape: the team and identifier with the actions beside them, the parent, the title, then who opened it and the branch. */
function TicketHeader({ id, ticket, detail, actions, page, onPick }: TicketHeaderProps) {
	/** The page's title is its `h1`; the sidebar's tabs sit under its `h2`. */
	const Heading = page ? "h1" : "h3";
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (page) headingRef.current?.focus({ preventScroll: true });
	}, [page]);
	const [StatusIcon, tone] = ticket ? statusIcon(ticket) : [null, ""];
	return (
		<header className="min-w-0 pt-2">
			<div className="flex min-h-7 min-w-0 items-center gap-2 px-4">
				<div className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
					{ticket && <span className="min-w-0 truncate font-medium">{ticket.team}</span>}
					{ticket && <span aria-hidden className="text-muted-foreground/50">/</span>}
					<a
						href={ticket?.url ?? undefined}
						target="_blank"
						rel="noreferrer"
						className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground tabular-nums underline-offset-2 hover:underline"
					>
						{StatusIcon && <StatusIcon aria-hidden className={cn("size-3.5", tone)} />}
						{id}
						<ExternalLink aria-hidden className="size-2.5 text-muted-foreground" />
					</a>
				</div>
				{ticket && actions && <div className="flex shrink-0 items-center justify-end">{actions(ticket)}</div>}
			</div>
			<div className="space-y-2 px-4 pt-1 pb-4">
				{ticket?.parentId && <ParentLink id={ticket.parentId} parent={detail?.parent ?? null} onPick={onPick} />}
				<Heading ref={headingRef} tabIndex={-1} className="text-base leading-snug font-semibold outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring">
					{ticket?.title ?? id}
				</Heading>
				{ticket && (
					<div className="flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
						{detail && (
							<>
								<span className="min-w-0 truncate">
									Opened by <span className="text-foreground">{detail.createdBy ?? "Linear"}</span>
								</span>
								<span aria-hidden className="text-muted-foreground/50">
									·
								</span>
							</>
						)}
						<Tooltip content={`Updated ${new Date(ticket.updatedAt).toLocaleString()}`}>
							<span className="shrink-0">updated {age(Date.parse(ticket.updatedAt))} ago</span>
						</Tooltip>
						{ticket.branch && <CopyableCode value={ticket.branch} label="Copy branch" className="ml-auto font-mono text-muted-foreground/70" />}
					</div>
				)}
			</div>
		</header>
	);
}

/** The issue a sub-issue belongs to, above its title: its identifier from the list at once, its status and title once Linear answers; `onPick` shows it in place. */
function ParentLink({ id, parent, onPick }: { id: string; parent: TicketRelative | null; onPick?: (id: string) => void }) {
	const className =
		"flex h-5 w-fit max-w-full min-w-0 items-center gap-1.5 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
	const content = (
		<>
			<CornerLeftUp aria-hidden className="size-3.5 shrink-0" />
			<span className="shrink-0">Sub-issue of</span>
			{parent && <IconTip icon={[...statusIcon(parent), parent.status]} />}
			<span className="shrink-0 tabular-nums">{id}</span>
			{parent && <span className="min-w-0 truncate text-foreground">{parent.title}</span>}
		</>
	);
	const title = parent ? `${id} ${parent.title}` : id;
	return onPick ? (
		<button type="button" onClick={() => onPick(id)} title={title} className={className}>
			{content}
		</button>
	) : (
		<a href={hashForTickets(id)} title={title} className={className}>
			{content}
		</a>
	);
}

/** Done of those still to do: a canceled sub-issue counts neither way. */
function subIssueProgress(subIssues: TicketRelative[]): { done: number; total: number } {
	const total = subIssues.filter(({ statusType }) => statusType !== "canceled").length;
	return { done: subIssues.filter(({ statusType }) => statusType === "completed").length, total };
}

/** The sub-issues, under how many are done: on the page a list of links to their details, in the sidebar a rail down to the issue `id`, as a pull request's stack runs down to its base branch, whose rows `onPick` shows in place. */
function SubIssues({ id, subIssues, owner, page, onPick }: { id: string; subIssues: TicketRelative[]; owner: string | null; page: boolean; onPick?: (id: string) => void }) {
	const { done, total } = subIssueProgress(subIssues);
	const sorted = subIssues.toSorted(subIssueOrder);
	return (
		<SummarySection
			title={`Sub-issues (${done}/${total})`}
			actions={
				total > 0 && (
					<span aria-hidden className="h-1 w-16 overflow-hidden rounded-full bg-muted">
						<span className="block h-full rounded-full bg-indigo-500 dark:bg-indigo-400" style={{ width: `${(done / total) * 100}%` }} />
					</span>
				)
			}
		>
			{page ? (
				<ul className="-mx-2">
					{sorted.map(issue => {
						const closed = issue.statusType === "completed" || issue.statusType === "canceled";
						return (
							<li key={issue.id}>
								<a
									href={hashForTickets(issue.id)}
									className="flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
								>
									<IconTip icon={[...statusIcon(issue), issue.status]} />
									<span className="shrink-0 tabular-nums text-muted-foreground">{issue.id}</span>
									<span className={cn("min-w-0 flex-1 truncate", closed && "text-muted-foreground", issue.statusType === "canceled" && "line-through")}>{issue.title}</span>
									{issue.assignee && issue.assignee !== owner && <span className="hidden max-w-32 shrink-0 truncate text-muted-foreground sm:block">{issue.assignee}</span>}
									<IconTip icon={[...PRIORITY_ICON[issue.priority], PRIORITY_LABEL[issue.priority]]} />
								</a>
							</li>
						);
					})}
				</ul>
			) : (
				<Rail end={id} className="rounded-md border border-border">
					{sorted.map((issue, index) => {
						const closed = issue.statusType === "completed" || issue.statusType === "canceled";
						const className = "min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline";
						const label = (
							<>
								<span className="tabular-nums text-muted-foreground">{issue.id}</span>{" "}
								<span className={cn(closed && "text-muted-foreground", issue.statusType === "canceled" && "line-through")}>{issue.title}</span>
							</>
						);
						return (
							<RailRow key={issue.id} first={index === 0}>
								<IconTip icon={[...statusIcon(issue), issue.status]} />
								{onPick ? (
									<button type="button" onClick={() => onPick(issue.id)} className={className}>
										{label}
									</button>
								) : (
									<a href={hashForTickets(issue.id)} className={className}>
										{label}
									</a>
								)}
								<IconTip icon={[...PRIORITY_ICON[issue.priority], PRIORITY_LABEL[issue.priority]]} />
							</RailRow>
						);
					})}
				</Rail>
			)}
		</SummarySection>
	);
}

/** The issue's description, sub-issues, links, and comment threads, each a section that folds. */
function TicketBody({ detail, page, onPick }: { detail: TicketDetail; page: boolean; onPick?: (id: string) => void }) {
	const { id, description, subIssues, assignee, attachments, threads } = detail;
	return (
		<>
			<SummarySection title="Description">
				{description.trim() ? <Markdown text={description} className="leading-relaxed" /> : <p className="text-xs text-muted-foreground">No description provided.</p>}
			</SummarySection>
			{subIssues.length > 0 && <SubIssues id={id} subIssues={subIssues} owner={assignee?.name ?? null} page={page} onPick={onPick} />}
			{attachments.length > 0 && (
				<SummarySection title={`Links (${attachments.length})`}>
					<ul className="space-y-1.5 text-xs">
						{attachments.map(({ title, url }, index) => {
							const Icon = pullRequestOfUrl(url) ? GitPullRequest : Link2;
							return (
								// Linear can attach one address twice.
								<li key={index} className="flex min-w-0 items-center gap-2">
									<Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
									<a href={url} target="_blank" rel="noreferrer" title={title} className="min-w-0 truncate underline-offset-2 hover:underline">
										{title}
									</a>
								</li>
							);
						})}
					</ul>
				</SummarySection>
			)}
			<SummarySection title={`Comments (${threads.reduce((count, thread) => count + thread.length, 0)})`}>
				{threads.length === 0 ? (
					<p className="text-xs text-muted-foreground">No comments yet.</p>
				) : (
					<ul className="space-y-3">
						{threads.map((thread, index) => (
							<li key={index} className="rounded-lg border border-border p-3">
								<ul className="space-y-3">
									{thread.map(({ author, body, createdAt }, position) => (
										<Comment key={position} comment={{ body, at: Date.parse(createdAt), url: null }} author={author} action={position === 0 ? "commented" : "replied"} />
									))}
								</ul>
							</li>
						))}
					</ul>
				)}
			</SummarySection>
		</>
	);
}
