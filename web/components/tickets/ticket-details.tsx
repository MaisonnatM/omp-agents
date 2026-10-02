import { Box, Calendar } from "lucide-react";
import type { ReactNode } from "react";
import type { Ticket, TicketComment, TicketDetail } from "../../../src/shared";
import { Badge } from "@/components/ui/badge";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { age } from "../../labels";
import { PRIORITY_LABEL } from "../../tickets-model";
import { useDetail } from "../../use-detail";
import { IconTip } from "../inbox/avatars";
import { DetailSection, OutLink } from "../inbox/pr-details";
import { MessageMarkdown } from "../message-markdown";
import { dueLabel, PRIORITY_ICON, STATUS_ICON } from "./ticket-row";

const ago = (at: string): string => `${age(Date.parse(at))} ago`;

/** Linear's markdown can hold raw HTML too, which GitHub's sanitizing renders safely and whose unknown tags it unwraps. */
const Markdown = ({ text }: { text: string }) => (
	<div className="text-sm [&_img]:max-w-full">
		<MessageMarkdown text={text} github />
	</div>
);

function Comment({ comment: { author, body, createdAt }, action }: { comment: TicketComment; action: string }) {
	return (
		<li className="space-y-1.5">
			<p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
				<span className="font-medium text-foreground">{author}</span>
				{action}
				<span title={new Date(createdAt).toLocaleString()}>{ago(createdAt)}</span>
			</p>
			{body.trim() && <Markdown text={body} />}
		</li>
	);
}

interface TicketSheetContentProps {
	id: string;
	/** The issue as the page lists it, which names it while Linear answers; `null` when the page does not list it. */
	listed: Ticket | null;
	actions?: ReactNode;
}

/** A Linear issue, as the tickets page's sheet shows it: a header that names it, with `actions` below, then its description, links, and comments. */
export function TicketSheetContent({ id, listed, actions }: TicketSheetContentProps) {
	const { detail, error } = useDetail<TicketDetail>(`/api/ticket?${new URLSearchParams({ id })}`);
	const ticket = detail ?? listed;
	const [PriorityIcon, priorityColor] = PRIORITY_ICON[ticket?.priority ?? 0];
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
			<header className="space-y-1.5 border-b border-border py-3 pr-12 pl-5">
				<SheetTitle className="flex items-start gap-2.5 text-base leading-snug font-semibold">
					{ticket && <IconTip icon={[...STATUS_ICON[ticket.statusType], ticket.status]} className="mt-1" />}
					<span className="min-w-0">{ticket?.title ?? id}</span>
				</SheetTitle>
				<p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<span className="font-mono tabular-nums">{id}</span>
					{ticket && (
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
				{ticket && ticket.labels.length > 0 && (
					<p className="flex flex-wrap gap-1">
						{ticket.labels.map(label => (
							<Badge key={label} variant="dot" size="compact">
								{label}
							</Badge>
						))}
					</p>
				)}
				{actions}
			</header>
			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">{body}</div>
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
									{thread.map((comment, at) => (
										<Comment key={at} comment={comment} action={at === 0 ? "commented" : "replied"} />
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
