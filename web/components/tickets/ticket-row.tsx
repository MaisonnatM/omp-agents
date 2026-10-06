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
	Ellipsis,
	type LucideIcon,
	SignalHigh,
	SignalLow,
	SignalMedium,
} from "lucide-react";
import type { RosterHost, View } from "../../../src/shared/sessions";
import type { Ticket, TicketPriority, TicketStatus } from "../../../src/shared/tickets";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { age } from "../../labels";
import { type QuickActionId, type TicketActionId, ticketActions } from "../../quick-actions";
import { hashForTickets, type OpenMode } from "../../routing";
import { PRIORITY_LABEL, type StatusKind, statusKind } from "../../tickets-model";
import { IconTip } from "../inbox/avatars";
import { AddToTodo } from "../todo/add-button";
import { QuickActionsMenu } from "../quick-actions";
import { LiveSessionChips } from "../session-chip";

/** Linear's glyph for each state type, and In Review's own green one. */
const STATUS_ICON: Record<StatusKind, [LucideIcon, string]> = {
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

/** `2026-10-05` as `Oct 5`, read as a local date so it does not shift a day west of UTC. */
export const dueLabel = (dueDate: string): string => new Date(`${dueDate}T00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The element id of an issue's row, used to restore focus after its details close. */
export const ticketRowId = (id: string): string => `ticket-${id}`;

interface TicketRowProps {
	ticket: Ticket;
	/** The running sessions that work on this issue. */
	sessions: RosterHost[];
	onOpen: (view: View, mode: OpenMode) => void;
	/** The quick action whose session is starting for this issue, if any. */
	pending: QuickActionId | null;
	onQuickAction: (action: TicketActionId) => void;
}

export function TicketRow({ ticket, sessions, onOpen, pending, onQuickAction }: TicketRowProps) {
	return (
		<li id={ticketRowId(ticket.id)} className="flex scroll-my-6 items-center hover:bg-muted/50">
			<Tooltip content={`${ticket.id} · ${ticket.title}`}>
				<a
					href={hashForTickets(ticket.id)}
					className="flex h-9 min-w-0 flex-1 items-center gap-3 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
				>
					<IconTip icon={[...PRIORITY_ICON[ticket.priority], PRIORITY_LABEL[ticket.priority]]} />
					<span className="w-20 shrink-0 truncate font-mono text-xs tabular-nums text-muted-foreground">{ticket.id}</span>
					<IconTip icon={[...statusIcon(ticket), ticket.status]} />
					<span className="min-w-0 flex-1 truncate">{ticket.title}</span>
					{ticket.labels.length > 0 && (
						<span className="hidden max-w-64 shrink items-center gap-1 overflow-hidden md:flex">
							{ticket.labels.map(({ name, color }) => (
								<Badge key={name} variant="dot" size="compact" color={color || undefined}>
									{name}
								</Badge>
							))}
						</span>
					)}
					{ticket.project && (
						<Tooltip content={ticket.project}>
							<span className="hidden max-w-40 shrink-0 items-center gap-1 text-xs text-muted-foreground lg:flex">
								<Box aria-hidden className="size-3.5 shrink-0" />
								<span className="truncate">{ticket.project}</span>
							</span>
						</Tooltip>
					)}
					{ticket.dueDate && (
						<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title={`Due ${ticket.dueDate}`}>
							<Calendar aria-hidden className="size-3.5" />
							{dueLabel(ticket.dueDate)}
						</span>
					)}
				</a>
			</Tooltip>
			<div className="flex shrink-0 items-center gap-3 px-3 text-xs">
				<LiveSessionChips hosts={sessions.slice(0, 2)} onOpen={onOpen} />
				<AddToTodo text={ticket.title} body={`Linear issue ${ticket.id}: ${ticket.url}`} link={{ kind: "ticket", identifier: ticket.id }} label={`Add ${ticket.id} to your todo list`} />
				<QuickActionsMenu actions={ticketActions(ticket)} pending={pending} onRun={onQuickAction} label="Quick actions: start a session in the background that works on this issue" />
				<span className="w-10 whitespace-nowrap text-right tabular-nums text-muted-foreground" title={`Updated ${new Date(ticket.updatedAt).toLocaleString()}`}>
					{age(Date.parse(ticket.updatedAt))}
				</span>
			</div>
		</li>
	);
}
