import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Ticket, View } from "../../../src/shared";
import { readPinnedSkill } from "../../pinned-skill";
import { pendingOf, type TicketActionId, ticketActions, ticketStart } from "../../quick-actions";
import { ticketsStore } from "../../reads";
import { hashForTickets, type OpenMode } from "../../routing";
import type { SectionTarget } from "../../section";
import type { QuickOp, StartOf } from "../../starts";
import { useStoredKeys } from "../../stored-state";
import { type TicketGroup, ticketGroups, ticketSection } from "../../tickets-model";
import { FoldButton, useRevealSection } from "../fold";
import { ListSheetPage, PageFrame } from "../list-sheet-page";
import { QuickActionButtons, QuickStartNotice } from "../quick-actions";
import { LinearConnection } from "../settings/linear-connection";
import { TicketDetailContent } from "./ticket-details";
import { STATUS_ICON, TicketRow, ticketRowId } from "./ticket-row";

/** Folded status groups, by status name. */
const COLLAPSED_KEY = "omp-agents.tickets-collapsed";

const TITLE = "Tickets";
const META = "Your assigned issues on Linear";

interface GroupProps {
	group: TicketGroup;
	open: boolean;
	onToggle: () => void;
	quick: StartOf<"quick"> | null;
	onQuickAction: (ticket: Ticket, action: TicketActionId) => void;
}

function GroupSection({ group, open, onToggle, quick, onQuickAction }: GroupProps) {
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
						<TicketRow
							key={ticket.id}
							ticket={ticket}
							pending={pendingOf(quick, { kind: "ticket", id: ticket.id })}
							onQuickAction={action => onQuickAction(ticket, action)}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

interface TicketsPageProps {
	/** The issue whose details replace the list; `null` shows the list. */
	target: string | null;
	/** The group a sidebar link last chose, to unfold, scroll to, and focus. */
	section: SectionTarget | null;
	/**
	 * Where a quick action's session starts. A Linear issue names no repository, so the caller passes the sidebar
	 * project's workspace, as a new session would start in.
	 */
	cwd: string;
	/** The quick action's start under way, failed, or started, whichever the page last asked for. */
	quick: StartOf<"quick"> | null;
	onQuickAction: (op: QuickOp) => void;
	onDismissQuick: () => void;
	/** Opens the session a quick action started. */
	onOpen: (view: View, mode: OpenMode) => void;
}

/** The viewer's assigned Linear issues by workflow state, as Linear's My issues lists them. */
export function TicketsPage({ target, section, cwd, quick, onQuickAction, onDismissQuick, onOpen }: TicketsPageProps) {
	const poll = ticketsStore.usePolling();
	const tickets = poll.read?.data.tickets ?? [];
	const [collapsed, toggleCollapsed, expand] = useStoredKeys(COLLAPSED_KEY);
	const start = (ticket: Ticket, action: TicketActionId) => onQuickAction(ticketStart(ticket, action, cwd, readPinnedSkill()));
	const listRef = useRef<HTMLDivElement>(null);
	const listPageRef = useRef<HTMLDivElement>(null);
	const previousTarget = useRef(target);
	useEffect(() => {
		if (target !== null) {
			previousTarget.current = target;
			return;
		}
		if (previousTarget.current === null) return;
		const link = document.getElementById(ticketRowId(previousTarget.current))?.querySelector("a");
		const destination = link ?? listRef.current;
		if (destination) {
			destination.focus();
			previousTarget.current = null;
			return;
		}
		// The lists mount only after a read. Until then, wait; a failed read never mounts them.
		if (!poll.read && poll.error && listPageRef.current) {
			listPageRef.current.focus();
			previousTarget.current = null;
		}
	});
	useRevealSection(target === null ? section : null, collapsed, expand);

	if (target !== null) {
		const listed = tickets.find(ticket => ticket.id === target) ?? null;
		return (
			<PageFrame title={TITLE} meta={META}>
				<TooltipProvider>
					<div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-6">
						<Button variant="ghost" leadingIcon={ArrowLeft} render={<a href={hashForTickets(null)} />}>
							Back to tickets
						</Button>
						{quick && <QuickStartNotice quick={quick} onOpen={onOpen} onDismiss={onDismissQuick} />}
						<TicketDetailContent
							key={target}
							id={target}
							listed={listed}
							actions={ticket => (
								<QuickActionButtons
									actions={ticketActions(ticket)}
									pending={pendingOf(quick, { kind: "ticket", id: target })}
									onRun={action => start(ticket, action)}
								/>
							)}
						/>
					</div>
				</TooltipProvider>
			</PageFrame>
		);
	}

	return (
		<ListSheetPage
			title={TITLE}
			meta={META}
			noun="the tickets"
			loading="Asking Linear for your issues…"
			poll={poll}
			onRefresh={() => void ticketsStore.refresh(null, { fresh: true })}
			missing={null}
			notice={quick && <QuickStartNotice quick={quick} onOpen={onOpen} onDismiss={onDismissQuick} />}
			spacing="space-y-4"
			contentRef={listPageRef}
		>
			{() => {
				const groups = ticketGroups(tickets);
				return (
					<div ref={listRef} tabIndex={-1} className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
						{groups.length === 0 && <p className="text-sm text-muted-foreground">No issues assigned to you.</p>}
						{groups.map(group => (
							<GroupSection
								key={group.status}
								group={group}
								open={!collapsed.has(group.status)}
								onToggle={() => toggleCollapsed(group.status)}
								quick={quick}
								onQuickAction={start}
							/>
						))}
					</div>
				);
			}}
		</ListSheetPage>
	);
}

/** The tickets page while omp is not signed in to Linear: the connection, to sign in from here as from the settings. */
export function TicketsDisconnected() {
	return (
		<PageFrame title={TITLE} meta={META}>
			<div className="mx-auto w-full max-w-5xl px-6 py-6">
				<LinearConnection />
			</div>
		</PageFrame>
	);
}
