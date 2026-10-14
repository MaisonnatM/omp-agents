import { GitPullRequest, Link2 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { pullRequestOfUrl } from "../../../src/shared/github";
import type { Ticket, TicketDetail } from "../../../src/shared/tickets";
import { cn } from "@/lib/utils";
import type { Editable } from "../../editable-read";
import { age } from "../../labels";
import { BranchName } from "../git";
import { Comment, DetailSection, LoadNote, Markdown, OutLink } from "../sheet-details";
import { TicketFields } from "./ticket-fields";

interface TicketDetailContentProps {
	id: string;
	/** The issue as the page lists it, which names it while Linear answers; `null` when the page does not list it. */
	listed: Ticket | null;
	/** Linear's answer for the issue, which the page also heads with its title, and which the fields edit. */
	read: Editable<TicketDetail>;
	actions?: (ticket: Ticket) => ReactNode;
	/** The tickets page lays the issue out in two columns and focuses its title; the session details sidebar stacks them and leaves focus where it is. */
	placement?: "page" | "sidebar";
}

/**
 * A Linear issue laid out as Linear lays it out: the title, description, and comments in a wide column, and beside it
 * {@link TicketSide}. On a narrow page, and in the sidebar, the side column follows the title.
 */
export function TicketDetailContent({ id, listed, read, actions, placement = "page" }: TicketDetailContentProps) {
	const { data: detail, error } = read;
	const ticket = detail ?? listed;
	const page = placement === "page";
	/** The page's title is its `h1`; the sidebar's tabs sit under its `h2`. */
	const Heading = page ? "h1" : "h3";
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (page) headingRef.current?.focus({ preventScroll: true });
	}, [page]);
	return (
		<div className={page ? "grid gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_1fr]" : "grid grid-cols-[minmax(0,1fr)] gap-y-6"}>
			<Heading
				ref={headingRef}
				tabIndex={-1}
				className={cn(
					"rounded-md leading-tight font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring",
					page ? "text-2xl lg:col-start-1 lg:row-start-1" : "text-base",
				)}
			>
				{ticket?.title ?? id}
			</Heading>
			{ticket && <TicketSide ticket={ticket} read={read} actions={actions} page={page} />}
			<div className={cn("min-w-0", page ? "space-y-10 lg:col-start-1 lg:row-start-2" : "space-y-6")}>
				{detail ? <TicketBody detail={detail} page={page} /> : <LoadNote loading="Asking Linear for the issue…" error={error && `Cannot load the issue: ${error}`} />}
			</div>
		</div>
	);
}

interface TicketSideProps extends Pick<TicketDetailContentProps, "actions" | "read"> {
	ticket: Ticket;
	page: boolean;
}

/** The side column: the quick actions, the editable fields, the branch, the links, and who opened the issue. */
function TicketSide({ ticket, read, actions, page }: TicketSideProps) {
	const detail = read.data;
	return (
		<aside aria-label="Issue properties" className={cn("space-y-6", page && "lg:col-start-2 lg:row-span-2 lg:row-start-1")}>
			{actions?.(ticket)}
			<TicketFields ticket={ticket} detail={detail} edit={read.edit} saveError={read.saveError} />
			{detail && <TicketLinks detail={detail} />}
			<div className="space-y-1 text-xs text-muted-foreground">
				<p className="tabular-nums">{ticket.id}</p>
				{detail && (
					<p title={new Date(detail.createdAt).toLocaleString()}>
						Opened{detail.createdBy && ` by ${detail.createdBy}`} {age(Date.parse(detail.createdAt))} ago
					</p>
				)}
				<p>
					<OutLink href={ticket.url}>Open in Linear</OutLink>
				</p>
			</div>
		</aside>
	);
}

/** An issue's description, then its comment threads; the sidebar sets the description at its own text size. */
function TicketBody({ detail: { description, threads }, page }: { detail: TicketDetail; page: boolean }) {
	return (
		<>
			{description.trim() ? <Markdown text={description} className={cn("leading-relaxed", page ? "text-[15px]" : "text-sm")} /> : <p className="text-sm text-muted-foreground">No description.</p>}
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
					<BranchName name={branch} className="max-w-full font-mono text-xs" />
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
				</DetailSection>
			)}
		</>
	);
}
