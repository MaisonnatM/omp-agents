import {
	Box,
	Calendar,
	Circle,
	CircleArrowOutUpRight,
	CircleCheck,
	CircleDashed,
	CircleAlert,
	CircleX,
	Contrast,
	Ellipsis,
	type LucideIcon,
	RefreshCw,
	SignalHigh,
	SignalLow,
	SignalMedium,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Ticket, TicketPriority, TicketStatusType } from "../../../src/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { age, readTime } from "../../labels";
import type { SectionTarget } from "../../section";
import { PRIORITY_LABEL, type TicketGroup, ticketGroups, ticketSection } from "../../tickets-model";
import { refreshTickets, useTickets } from "../../use-tickets";
import { Header } from "../conversation";
import { FoldButton, useCollapsed, useRevealSection } from "../fold";
import { IconTip } from "../inbox/avatars";

/** Folded status groups, by status name. */
const COLLAPSED_KEY = "omp-agents.tickets-collapsed";

/** Linear's glyph for each state type. */
const STATUS_ICON: Record<TicketStatusType, [LucideIcon, string]> = {
	triage: [CircleArrowOutUpRight, "text-orange-500 dark:text-orange-400"],
	started: [Contrast, "text-amber-500 dark:text-amber-400"],
	unstarted: [Circle, "text-muted-foreground"],
	backlog: [CircleDashed, "text-muted-foreground"],
	completed: [CircleCheck, "text-indigo-500 dark:text-indigo-400"],
	canceled: [CircleX, "text-muted-foreground"],
};

const PRIORITY_ICON: Record<TicketPriority, [LucideIcon, string]> = {
	0: [Ellipsis, "text-muted-foreground"],
	1: [CircleAlert, "text-orange-500 dark:text-orange-400"],
	2: [SignalHigh, "text-foreground"],
	3: [SignalMedium, "text-foreground"],
	4: [SignalLow, "text-foreground"],
};

/** `2026-10-05` as `Oct 5`, read as a local date so it does not shift a day west of UTC. */
const dueLabel = (dueDate: string): string => new Date(`${dueDate}T00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function TicketRow({ ticket }: { ticket: Ticket }) {
	return (
		<li>
			<a
				href={ticket.url}
				target="_blank"
				rel="noreferrer"
				className="flex h-9 items-center gap-3 px-3 text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
			>
				<IconTip icon={[...PRIORITY_ICON[ticket.priority], PRIORITY_LABEL[ticket.priority]]} />
				<span className="w-20 shrink-0 truncate font-mono text-xs tabular-nums text-muted-foreground">{ticket.id}</span>
				<IconTip icon={[...STATUS_ICON[ticket.statusType], ticket.status]} />
				<span className="min-w-0 flex-1 truncate" title={ticket.title}>
					{ticket.title}
				</span>
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
				<span className="w-10 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground" title={`Updated ${new Date(ticket.updatedAt).toLocaleString()}`}>
					{age(Date.parse(ticket.updatedAt))}
				</span>
			</a>
		</li>
	);
}

function GroupSection({ group, open, onToggle }: { group: TicketGroup; open: boolean; onToggle: () => void }) {
	const { id } = ticketSection(group.status);
	const [Icon, color] = STATUS_ICON[group.statusType];
	return (
		// Focused when its sidebar link is chosen.
		<section id={id} tabIndex={-1} aria-labelledby={`${id}-heading`} className="scroll-mt-6 overflow-hidden rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring">
			<h3 id={`${id}-heading`} className="bg-muted/50 px-3 py-1.5 text-sm font-medium">
				<FoldButton open={open} onToggle={onToggle} controls={`${id}-list`} className="items-center">
					<Icon aria-hidden className={`size-4 shrink-0 ${color}`} />
					{group.status}
					<span className="text-xs tabular-nums text-muted-foreground">{group.tickets.length}</span>
				</FoldButton>
			</h3>
			{open && (
				<ul id={`${id}-list`} className="divide-y divide-border border-t border-border">
					{group.tickets.map(ticket => (
						<TicketRow key={ticket.id} ticket={ticket} />
					))}
				</ul>
			)}
		</section>
	);
}

interface TicketsPageProps {
	/** The group a sidebar link last chose, to unfold, scroll to, and focus. */
	section: SectionTarget | null;
}

/** The viewer's assigned Linear issues by workflow state, as Linear's My issues lists them. */
export function TicketsPage({ section }: TicketsPageProps) {
	const { read, error, refreshing } = useTickets(true);
	const [collapsed, toggleCollapsed, expand] = useCollapsed(COLLAPSED_KEY);
	useRevealSection(section, collapsed, expand);

	let body: ReactNode;
	if (!read && error) body = <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot load the tickets: {error}</p>;
	else if (!read) body = <p className="text-sm text-muted-foreground">Asking Linear for your issues…</p>;
	else {
		const groups = ticketGroups(read.data.tickets);
		body = (
			<>
				{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the tickets: {error}</p>}
				{groups.length === 0 && <p className="text-sm text-muted-foreground">No issues assigned to you.</p>}
				{groups.map(group => (
					<GroupSection key={group.status} group={group} open={!collapsed.has(group.status)} onToggle={() => toggleCollapsed(group.status)} />
				))}
			</>
		);
	}

	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header title="Tickets" meta={read ? `Your assigned issues on Linear · updated ${readTime(read.at)}` : "Your assigned issues on Linear"}>
				<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={refreshing} onClick={() => void refreshTickets(true)}>
					{refreshing ? "Refreshing…" : "Refresh"}
				</Button>
			</Header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<TooltipProvider>
					<div className="mx-auto w-full max-w-5xl space-y-4 px-6 py-6">{body}</div>
				</TooltipProvider>
			</div>
		</div>
	);
}
