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
import { cn } from "@/lib/utils";
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

/** A time as Linear's lists date it: `Oct 6` this year, `Mar 2025` before. */
function dayLabel(iso: string): string {
	const date = new Date(iso);
	const thisYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString(undefined, thisYear ? { month: "short", day: "numeric" } : { month: "short", year: "numeric" });
}

/** The element id of an issue's row, used to restore focus after its details close. */
export const ticketRowId = (id: string): string => `ticket-${id}`;

/** A pill for a value on an issue: a label, the project, or the due date. */
export const TICKET_CHIP = "flex h-6 min-w-0 max-w-48 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground";

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
		<li id={ticketRowId(ticket.id)} className="group/row relative flex scroll-mt-12 scroll-mb-2 items-center rounded-md hover:bg-muted has-[:focus-visible]:bg-muted">
			<a
				href={hashForTickets(ticket.id)}
				className="@container flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
			>
				<IconTip icon={[...PRIORITY_ICON[ticket.priority], PRIORITY_LABEL[ticket.priority]]} />
				<span className="min-w-[4.75rem] shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{ticket.id}</span>
				<IconTip icon={[...statusIcon(ticket), ticket.status]} />
				<span className="min-w-0 truncate">{ticket.title}</span>
				<span className="min-w-4 flex-1" />
				{/* Chips that do not fit wrap onto a second line that the fixed height hides, so the title keeps its room. */}
				<span className="hidden h-6 min-w-0 shrink-[100] flex-wrap justify-end gap-1.5 overflow-hidden @2xl:flex">
					{ticket.dueDate && (
						<span className={TICKET_CHIP} title={`Due ${ticket.dueDate}`}>
							<Calendar aria-hidden className="size-3.5 shrink-0" />
							<span className="truncate">{dueLabel(ticket.dueDate)}</span>
						</span>
					)}
					{ticket.labels.map(({ name, color }) => (
						<span key={name} className={TICKET_CHIP}>
							<span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color || "var(--muted-foreground)" }} />
							<span className="truncate">{name}</span>
						</span>
					))}
					{ticket.project && (
						<span className={TICKET_CHIP} title={ticket.project}>
							<Box aria-hidden className="size-3.5 shrink-0" />
							<span className="truncate">{ticket.project}</span>
						</span>
					)}
				</span>
				<span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground @4xl:block" title={`Created ${new Date(ticket.createdAt).toLocaleString()}`}>
					{dayLabel(ticket.createdAt)}
				</span>
				<span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground" title={`Updated ${new Date(ticket.updatedAt).toLocaleString()}`}>
					{dayLabel(ticket.updatedAt)}
				</span>
			</a>
			{sessions.length > 0 && (
				<div className="shrink-0 pr-3">
					<LiveSessionChips hosts={sessions.slice(0, 2)} onOpen={onOpen} />
				</div>
			)}
			<div
				className={cn(
					"absolute inset-y-0 right-1 flex items-center gap-1 rounded-md bg-muted px-2 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[data-popup-open]]:opacity-100 [@media(hover:none)]:opacity-100",
					pending === null && "opacity-0",
				)}
			>
				<AddToTodo text={ticket.title} body={`Linear issue ${ticket.id}: ${ticket.url}`} link={{ kind: "ticket", identifier: ticket.id }} label={`Add ${ticket.id} to your todo list`} />
				<QuickActionsMenu actions={ticketActions(ticket)} pending={pending} onRun={onQuickAction} label="Quick actions: start a session in the background that works on this issue" />
			</div>
		</li>
	);
}
