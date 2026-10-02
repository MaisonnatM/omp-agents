import {
	Box,
	Calendar,
	Circle,
	CircleAlert,
	CircleArrowOutUpRight,
	CircleCheck,
	CircleDashed,
	CircleX,
	Contrast,
	Ellipsis,
	type LucideIcon,
	SignalHigh,
	SignalLow,
	SignalMedium,
} from "lucide-react";
import type { Ticket, TicketPriority, TicketStatusType } from "../../../src/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { age } from "../../labels";
import { type TicketActionId, ticketActions } from "../../quick-actions";
import { hashForTickets, type OpenMode } from "../../routing";
import { PRIORITY_LABEL } from "../../tickets-model";
import { IconTip } from "../inbox/avatars";
import { QuickActionsMenu } from "../quick-actions";

/** Linear's glyph for each state type. */
export const STATUS_ICON: Record<TicketStatusType, [LucideIcon, string]> = {
	triage: [CircleArrowOutUpRight, "text-orange-500 dark:text-orange-400"],
	started: [Contrast, "text-amber-500 dark:text-amber-400"],
	unstarted: [Circle, "text-muted-foreground"],
	backlog: [CircleDashed, "text-muted-foreground"],
	completed: [CircleCheck, "text-indigo-500 dark:text-indigo-400"],
	canceled: [CircleX, "text-muted-foreground"],
};

export const PRIORITY_ICON: Record<TicketPriority, [LucideIcon, string]> = {
	0: [Ellipsis, "text-muted-foreground"],
	1: [CircleAlert, "text-orange-500 dark:text-orange-400"],
	2: [SignalHigh, "text-foreground"],
	3: [SignalMedium, "text-foreground"],
	4: [SignalLow, "text-foreground"],
};

/** `2026-10-05` as `Oct 5`, read as a local date so it does not shift a day west of UTC. */
export const dueLabel = (dueDate: string): string => new Date(`${dueDate}T00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The element id of an issue's row, which a `#tickets/<identifier>` link scrolls to. */
export const ticketRowId = (id: string): string => `ticket-${id}`;

interface TicketRowProps {
	ticket: Ticket;
	/** The issue a tickets link named, highlighted while its sheet shows. */
	targeted: boolean;
	/** The quick action whose session is starting for this issue, if any. */
	pending: TicketActionId | null;
	onQuickAction: (action: TicketActionId, mode: OpenMode) => void;
}

export function TicketRow({ ticket, targeted, pending, onQuickAction }: TicketRowProps) {
	return (
		<li
			id={ticketRowId(ticket.id)}
			data-targeted={targeted || undefined}
			className={cn("flex scroll-my-6 items-center", targeted ? "bg-accent/60 ring-2 ring-inset ring-ring" : "hover:bg-muted/50")}
		>
			<a
				href={hashForTickets(ticket.id)}
				aria-haspopup="dialog"
				title={`Show the details of ${ticket.id}`}
				className="flex h-9 min-w-0 flex-1 items-center gap-3 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
			>
				<IconTip icon={[...PRIORITY_ICON[ticket.priority], PRIORITY_LABEL[ticket.priority]]} />
				<span className="w-20 shrink-0 truncate font-mono text-xs tabular-nums text-muted-foreground">{ticket.id}</span>
				<IconTip icon={[...STATUS_ICON[ticket.statusType], ticket.status]} />
				<span className="min-w-0 flex-1 truncate">{ticket.title}</span>
				{ticket.labels.length > 0 && (
					<span className="hidden max-w-64 shrink items-center gap-1 overflow-hidden md:flex">
						{ticket.labels.map(label => (
							<Badge key={label} variant="dot" size="compact">
								{label}
							</Badge>
						))}
					</span>
				)}
				{ticket.project && (
					<span className="hidden max-w-40 shrink-0 items-center gap-1 text-xs text-muted-foreground lg:flex" title={ticket.project}>
						<Box aria-hidden className="size-3.5 shrink-0" />
						<span className="truncate">{ticket.project}</span>
					</span>
				)}
				{ticket.dueDate && (
					<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title={`Due ${ticket.dueDate}`}>
						<Calendar aria-hidden className="size-3.5" />
						{dueLabel(ticket.dueDate)}
					</span>
				)}
			</a>
			<div className="flex shrink-0 items-center gap-3 px-3 text-xs">
				<QuickActionsMenu actions={ticketActions(ticket)} pending={pending} onRun={onQuickAction} label="Quick actions: start a session that works on this issue" />
				<span className="w-10 whitespace-nowrap text-right tabular-nums text-muted-foreground" title={`Updated ${new Date(ticket.updatedAt).toLocaleString()}`}>
					{age(Date.parse(ticket.updatedAt))}
				</span>
			</div>
		</li>
	);
}
