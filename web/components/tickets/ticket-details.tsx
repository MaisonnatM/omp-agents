import { Box, Calendar } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { Ticket, TicketDetail } from "../../../src/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { age } from "../../labels";
import type { ReadState } from "../../reads";
import { PRIORITY_LABEL } from "../../tickets-model";
import { BranchName } from "../git";
import { IconTip } from "../inbox/avatars";
import { Comment, DetailSection, LoadNote, Markdown, OutLink } from "../sheet-details";
import { TicketFields } from "./ticket-fields";
import { dueLabel, PRIORITY_ICON, statusIcon } from "./ticket-row";

const ago = (at: string): string => `${age(Date.parse(at))} ago`;

interface TicketDetailContentProps {
	id: string;
	/** The issue as the page lists it, which names it while Linear answers; `null` when the page does not list it. */
	listed: Ticket | null;
	/** Linear's answer for the issue, which the page also heads with its title. */
	read: ReadState<TicketDetail> & { replace: (detail: TicketDetail) => void };
	actions?: (ticket: Ticket) => ReactNode;
}

/** A Linear issue's editable fields, actions, description, links, and comments in the tickets page's main content. */
export function TicketDetailContent({ id, listed, read: { data: detail, error, replace }, actions }: TicketDetailContentProps) {
	const ticket = detail ?? listed;
	const [PriorityIcon, priorityColor] = PRIORITY_ICON[ticket?.priority ?? 0];
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
	}, []);
	const body = detail ? <TicketSections detail={detail} /> : <LoadNote loading="Asking Linear for the issue…" error={error && `Cannot load the issue: ${error}`} />;
	return (
		<>
			<header className="space-y-3">
				<h1 ref={headingRef} tabIndex={-1} className="flex items-start gap-2.5 text-base leading-snug font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
					{ticket && <IconTip icon={[...statusIcon(ticket.status, ticket.statusType), ticket.status]} className="mt-1" />}
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
						{ticket.labels.map(({ name, color }) => (
							<Badge key={name} variant="dot" size="compact" color={color || undefined}>
								{name}
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
