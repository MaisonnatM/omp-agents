import { GitPullRequest, Link2 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { Ticket, TicketDetail } from "../../../src/shared/tickets";
import { age } from "../../labels";
import type { ReadState } from "../../reads";
import { BranchName } from "../git";
import { Comment, DetailSection, LoadNote, Markdown, OutLink } from "../sheet-details";
import { TicketFields } from "./ticket-fields";

const ago = (at: string): string => `${age(Date.parse(at))} ago`;

const PULL_REQUEST = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

interface TicketDetailContentProps {
	id: string;
	/** The issue as the page lists it, which names it while Linear answers; `null` when the page does not list it. */
	listed: Ticket | null;
	/** Linear's answer for the issue, which the page also heads with its title. */
	read: ReadState<TicketDetail> & { replace: (detail: TicketDetail) => void; reload: () => void };
	actions?: (ticket: Ticket) => ReactNode;
}

/**
 * A Linear issue laid out as Linear lays it out: the title, description, and comments in a wide column, and beside it
 * the actions, the editable fields, the branch, the links, and who opened the issue. On a narrow page the side column
 * follows the title.
 */
export function TicketDetailContent({ id, listed, read: { data: detail, error, replace, reload }, actions }: TicketDetailContentProps) {
	const ticket = detail ?? listed;
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
	}, []);
	return (
		<div className="grid gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_1fr]">
			<h1 ref={headingRef} tabIndex={-1} className="text-2xl leading-tight font-semibold tracking-tight outline-none lg:col-start-1 lg:row-start-1">
				{ticket?.title ?? id}
			</h1>
			<aside aria-label="Issue properties" className="grid content-start gap-6 sm:grid-cols-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid-cols-1">
				{ticket && actions && <div className="sm:col-span-2 lg:col-span-1">{actions(ticket)}</div>}
				{ticket && <TicketFields ticket={ticket} detail={detail} replace={replace} reload={reload} />}
				{detail && <TicketLinks detail={detail} />}
				{ticket && (
					<p className="space-y-1 text-xs text-muted-foreground">
						<span className="block tabular-nums">{id}</span>
						{detail && (
							<span className="block" title={new Date(detail.createdAt).toLocaleString()}>
								Opened{detail.createdBy && ` by ${detail.createdBy}`} {ago(detail.createdAt)}
							</span>
						)}
						<span className="block">
							<OutLink href={ticket.url}>Open in Linear</OutLink>
						</span>
					</p>
				)}
			</aside>
			<div className="min-w-0 space-y-10 lg:col-start-1 lg:row-start-2">
				{detail ? <TicketBody detail={detail} /> : <LoadNote loading="Asking Linear for the issue…" error={error && `Cannot load the issue: ${error}`} />}
			</div>
		</div>
	);
}

/** An issue's description, then its comment threads. */
function TicketBody({ detail: { description, threads } }: { detail: TicketDetail }) {
	return (
		<>
			{description.trim() ? <Markdown text={description} className="text-[15px] leading-relaxed" /> : <p className="text-sm text-muted-foreground">No description.</p>}
			{threads.length > 0 && (
				<section className="space-y-4 border-t border-border pt-6">
					<h2 className="flex items-baseline gap-2 text-sm font-medium">
						Comments <span className="text-muted-foreground tabular-nums">{threads.reduce((count, thread) => count + thread.length, 0)}</span>
					</h2>
					<ul className="space-y-3">
						{threads.map((thread, index) => (
							<li key={index} className="rounded-lg border border-border p-3">
								<ul className="space-y-3">
									{thread.map(({ author, body, createdAt }, position) => (
										<Comment
											key={position}
											comment={{ body, at: Date.parse(createdAt), url: null }}
											author={author}
											action={position === 0 ? "commented" : "replied"}
										/>
									))}
								</ul>
							</li>
						))}
					</ul>
				</section>
			)}
		</>
	);
}

/** The issue's branch and the pull requests, documents, and pages Linear links it to. */
function TicketLinks({ detail: { branch, attachments } }: { detail: TicketDetail }) {
	return (
		<>
			{branch && (
				<DetailSection title="Branch">
					<BranchName name={branch} className="max-w-full truncate font-mono text-xs" />
				</DetailSection>
			)}
			{attachments.length > 0 && (
				<DetailSection
					title={
						<>
							Links <span className="tabular-nums">{attachments.length}</span>
						</>
					}
				>
					<ul className="space-y-1.5 text-sm">
						{attachments.map(({ title, url }, index) => {
							const Icon = PULL_REQUEST.test(url) ? GitPullRequest : Link2;
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
				</DetailSection>
			)}
		</>
	);
}
