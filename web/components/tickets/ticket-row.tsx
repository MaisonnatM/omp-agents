/** `TicketRow`: a Linear issue's row on the Tickets page, with its status and priority icons and chips. */
import {
	Box,
	Calendar,
	Circle,
	CircleAlert,
	CircleArrowOutUpRight,
	CircleCheck,
	CircleDashed,
	CircleDot,
	CircleX,
	Contrast,
	CornerDownRight,
	Ellipsis,
	type LucideIcon,
	SignalHigh,
	SignalLow,
	SignalMedium,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Ticket, TicketPriority, TicketStatus } from "../../../src/shared/tickets";
import { cn } from "@/lib/utils";
import { dateLabel, dayLabel } from "../../labels";
import { type QuickActionId, ticketActions, type WorkActionId } from "../../quick-actions";
import { hashForTickets } from "../../routing";
import { PRIORITY_LABEL, type StatusKind, statusKind } from "../../tickets-model";
import { IconTip } from "../pull-requests/avatars";
import { AddToTodo } from "../todo/add-button";
import { QuickActionsMenu } from "../quick-actions";

/** Linear's glyph for each state type, and In Review's own green one. */
export const STATUS_ICON: Record<StatusKind, [LucideIcon, string]> = {
	review: [CircleDot, "text-green-600 dark:text-green-400"],
	triage: [CircleArrowOutUpRight, "text-orange-500 dark:text-orange-400"],
	started: [Contrast, "text-amber-500 dark:text-amber-400"],
	unstarted: [Circle, "text-muted-foreground"],
	backlog: [CircleDashed, "text-muted-foreground"],
	completed: [CircleCheck, "text-indigo-500 dark:text-indigo-400"],
	canceled: [CircleX, "text-muted-foreground"],
};

export const statusIcon = (status: TicketStatus): [LucideIcon, string] => STATUS_ICON[statusKind(status)];

export const PRIORITY_ICON: Record<TicketPriority, [LucideIcon, string]> = {
	0: [Ellipsis, "text-muted-foreground"],
	1: [CircleAlert, "text-orange-500 dark:text-orange-400"],
	2: [SignalHigh, "text-foreground"],
	3: [SignalMedium, "text-foreground"],
	4: [SignalLow, "text-foreground"],
};

/** The element id of an issue's row, used to restore focus after its details close. */
export const ticketRowId = (id: string): string => `ticket-${id}`;

/** A pill for a value on an issue, its glyph then its truncating text: a label, the project, or the due date. */
export function TicketChip({ icon, title, className, children }: { icon: ReactNode; title?: string; className?: string; children: ReactNode }) {
	return (
		<span title={title} className={cn("flex h-6 min-w-0 max-w-48 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground", className)}>
			{icon}
			<span className="truncate">{children}</span>
		</span>
	);
}

/** A label's dot in the color Linear gives the label. */
export const LabelDot = ({ color }: { color: string }) => (
	<span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color || "var(--muted-foreground)" }} />
);

interface TicketRowProps {
	ticket: Ticket;
	/** A sub-issue listed under its parent's row, which indents it. */
	nested?: boolean;
	/** The issue whose details show beside the list, which the row marks as selected. */
	open?: boolean;
	/** The quick action whose session is starting for this issue, if any. */
	pending: QuickActionId | null;
	onQuickAction: (action: WorkActionId) => void;
}

export function TicketRow({ ticket, nested = false, open = false, pending, onQuickAction }: TicketRowProps) {
	return (
		<li id={ticketRowId(ticket.id)} className={cn("group/row relative flex items-center rounded-md", open ? "bg-accent before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary" : "hover:bg-muted has-[:focus-visible]:bg-muted")}>
			<a
				href={hashForTickets(ticket.id)}
				aria-current={open ? "true" : undefined}
				className={cn(
					"@container flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 text-sm outline-none",
					// The open row looks selected, so its focus needs no ring of its own.
					!open && "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
					nested && "pl-10",
				)}
			>
				<IconTip icon={[...PRIORITY_ICON[ticket.priority], PRIORITY_LABEL[ticket.priority]]} />
				<span className="min-w-[4.75rem] shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{ticket.id}</span>
				<IconTip icon={[...statusIcon(ticket), ticket.status]} />
				<span className="min-w-0 truncate">
					{ticket.title}
					{nested && ticket.parentId && <span className="sr-only">, sub-issue of {ticket.parentId}</span>}
				</span>
				<span className="min-w-4 flex-1" />
				{/* Chips that do not fit wrap onto a second line that the fixed height hides, so the title keeps its room. */}
				<span className="hidden h-6 min-w-0 shrink-[100] flex-wrap justify-end gap-1.5 overflow-hidden @2xl:flex">
					{!nested && ticket.parentId && (
						<TicketChip icon={<CornerDownRight aria-hidden className="size-3.5 shrink-0" />} title={`Sub-issue of ${ticket.parentId}`}>
							{ticket.parentId}
						</TicketChip>
					)}
					{ticket.dueDate && (
						<TicketChip icon={<Calendar aria-hidden className="size-3.5 shrink-0" />} title={`Due ${ticket.dueDate}`}>
							{dateLabel(ticket.dueDate)}
						</TicketChip>
					)}
					{ticket.labels.map(({ name, color }) => (
						<TicketChip key={name} icon={<LabelDot color={color} />}>
							{name}
						</TicketChip>
					))}
					{ticket.project && (
						<TicketChip icon={<Box aria-hidden className="size-3.5 shrink-0" />} title={ticket.project}>
							{ticket.project}
						</TicketChip>
					)}
				</span>
				<span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground @4xl:block" title={`Created ${new Date(ticket.createdAt).toLocaleString()}`}>
					{dayLabel(ticket.createdAt)}
				</span>
			</a>
			{/* The updated day and the row's buttons share one cell: the buttons show in the day's place on hover or focus. */}
			<div className="grid shrink-0 items-center justify-items-end pr-2 pl-1 *:col-start-1 *:row-start-1">
				<span
					className={cn(
						"w-14 pr-1 text-right text-xs tabular-nums text-muted-foreground transition-opacity group-focus-within/row:opacity-0 group-hover/row:opacity-0 group-has-[[data-popup-open]]/row:opacity-0 [@media(hover:none)]:hidden",
						pending !== null && "opacity-0",
					)}
					title={`Updated ${new Date(ticket.updatedAt).toLocaleString()}`}
				>
					{dayLabel(ticket.updatedAt)}
				</span>
				<div
					className={cn(
						"flex items-center gap-1 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[data-popup-open]]:opacity-100 [@media(hover:none)]:opacity-100",
						pending === null && "opacity-0",
					)}
				>
					<AddToTodo text={ticket.title} body={`Linear issue ${ticket.id}: ${ticket.url}`} link={{ kind: "ticket", identifier: ticket.id }} label={`Add ${ticket.id} to your todo list`} />
					<QuickActionsMenu actions={ticketActions(ticket)} pending={pending} onRun={onQuickAction} label="Quick actions: start a session in the background that works on this issue" />
				</div>
			</div>
		</li>
	);
}
