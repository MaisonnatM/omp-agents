import { Box, Calendar } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Ticket, TicketDetail } from "../../../src/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { age } from "../../labels";
import { useRead } from "../../reads";
import { PRIORITY_LABEL } from "../../tickets-model";
import { IconTip } from "../inbox/avatars";
import { Comment, DetailSection, Markdown, OutLink } from "../sheet-details";
import { TicketFields } from "./ticket-fields";
import { dueLabel, PRIORITY_ICON, STATUS_ICON } from "./ticket-row";

const ago = (at: string): string => `${age(Date.parse(at))} ago`;

interface TicketDetailContentProps {
	id: string;
	/** The issue as the page lists it, which names it while Linear answers; `null` when the page does not list it. */
	listed: Ticket | null;
	actions?: (ticket: Ticket) => ReactNode;
}

/** A Linear issue's editable fields, actions, description, links, and comments in the tickets page's main content. */
export function TicketDetailContent({ id, listed, actions }: TicketDetailContentProps) {
	const read = useRead<TicketDetail>(`/api/ticket?${new URLSearchParams({ id })}`);
	// Field changes replace the read; the component mounts anew by key for another issue.
	const [replaced, replace] = useState<TicketDetail | null>(null);
	const detail = replaced ?? read.data;
	const error = replaced ? null : read.error;
	const ticket = detail ?? listed;
	const [PriorityIcon, priorityColor] = PRIORITY_ICON[ticket?.priority ?? 0];
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
	}, []);
	let body: ReactNode = <p className="text-sm text-muted-foreground">Asking Linear for the issue…</p>;
	if (detail) body = <TicketSections detail={detail} />;
	else if (error) {
		body = (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				Cannot load the issue: {error}
			</p>
		);
	}
	return (
		<>
			<header className="space-y-3">
				<h1 ref={headingRef} tabIndex={-1} className="flex items-start gap-2.5 text-base leading-snug font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
					{ticket && <IconTip icon={[...STATUS_ICON[ticket.statusType], ticket.status]} className="mt-1" />}
					<span className="min-w-0">{ticket?.title ?? id}</span>
				</h1>
				<p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<span className="font-mono tabular-nums">{id}</span>
					{ticket && !detail && (
						<>
							<span>{ticket.status}</span>
							<span className="flex items-center gap-1">
								<PriorityIcon aria-hidden className={cn("size-3.5", priorityColor)} />
								{PRIORITY_LABEL[ticket.priority]}
							</span>
							{ticket.project && (
								<span className="flex min-w-0 items-center gap-1">
									<Box aria-hidden className="size-3.5 shrink-0" />
									<span className="truncate">{ticket.project}</span>
								</span>
							)}
							{ticket.dueDate && (
								<span className="flex items-center gap-1" title={`Due ${ticket.dueDate}`}>
									<Calendar aria-hidden className="size-3.5" />
									{dueLabel(ticket.dueDate)}
								</span>
							)}
						</>
					)}
					{detail && (
						<span title={new Date(detail.createdAt).toLocaleString()}>
							opened{detail.createdBy && ` by ${detail.createdBy}`} {ago(detail.createdAt)}
						</span>
					)}
					{ticket && (
						<span className="ml-auto">
							<OutLink href={ticket.url}>Linear</OutLink>
						</span>
					)}
				</p>
				{detail && <TicketFields detail={detail} replace={replace} />}
				{!detail && ticket && ticket.labels.length > 0 && (
					<p className="flex flex-wrap gap-1">
						{ticket.labels.map(label => (
							<Badge key={label} variant="dot" size="compact">
								{label}
							</Badge>
						))}
					</p>
				)}
				{ticket && actions?.(ticket)}
			</header>
			<div className="space-y-5">{body}</div>
		</>
	);
}

/** An issue's description, the links Linear keeps for it, and its comment threads. */
function TicketSections({ detail: { description, attachments, threads, branch } }: { detail: TicketDetail }) {
	return (
		<>
			<DetailSection title="Description">
				{description.trim() ? <Markdown text={description} /> : <p className="text-sm text-muted-foreground">No description.</p>}
			</DetailSection>
			{branch && (
				<DetailSection title="Branch">
					<p className="truncate font-mono text-xs" title={branch}>
						{branch}
					</p>
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
					<ul className="space-y-1 text-sm">
						{attachments.map(({ title, url }, index) => (
							// Linear can attach one address twice.
							<li key={index} className="min-w-0 truncate">
								<OutLink href={url}>{title}</OutLink>
							</li>
						))}
					</ul>
				</DetailSection>
			)}
			{threads.length > 0 && (
				<DetailSection
					title={
						<>
							Comments <span className="tabular-nums">{threads.reduce((count, thread) => count + thread.length, 0)}</span>
						</>
					}
				>
					<ul className="space-y-3">
						{threads.map((thread, index) => (
							<li key={index} className="rounded-md border border-border p-3">
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
				</DetailSection>
			)}
		</>
	);
}
