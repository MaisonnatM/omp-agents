import { RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { Ticket, View } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readTime } from "../../labels";
import { type TicketActionId, ticketActions, ticketStart } from "../../quick-actions";
import { hashForTickets, type OpenMode } from "../../routing";
import type { SectionTarget } from "../../section";
import type { QuickOp, StartOf } from "../../starts";
import { type TicketGroup, ticketGroups, ticketSection } from "../../tickets-model";
import { refreshTickets, useTickets } from "../../use-tickets";
import { Header } from "../conversation";
import { FoldButton, useCollapsed, useRevealSection } from "../fold";
import { QuickActionButtons, QuickStartNotice } from "../quick-actions";
import { LinearConnection } from "../settings/linear-connection";
import { TicketSheetContent } from "./ticket-details";
import { STATUS_ICON, TicketRow, ticketRowId } from "./ticket-row";

/** Folded status groups, by status name. */
const COLLAPSED_KEY = "omp-agents.tickets-collapsed";

/** The action of the quick start under way for issue `id`, if any. */
function pendingOf(quick: StartOf<"quick"> | null, id: string): TicketActionId | null {
	const subject = quick?.phase === "starting" ? quick.op.subject : null;
	return subject?.kind === "ticket" && subject.id === id ? subject.action : null;
}

interface GroupProps {
	group: TicketGroup;
	open: boolean;
	onToggle: () => void;
	target: string | null;
	quick: StartOf<"quick"> | null;
	onQuickAction: (ticket: Ticket, action: TicketActionId) => void;
}

function GroupSection({ group, open, onToggle, target, quick, onQuickAction }: GroupProps) {
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
							targeted={ticket.id === target}
							pending={pendingOf(quick, ticket.id)}
							onQuickAction={action => onQuickAction(ticket, action)}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

interface TicketsPageProps {
	/** The issue a tickets link named: its group unfolds, its row scrolls into view and stays highlighted while its details show in a sheet. */
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
	const { read, error, refreshing } = useTickets(true);
	const [collapsed, toggleCollapsed, expand] = useCollapsed(COLLAPSED_KEY);
	const tickets = read?.data.tickets ?? [];
	const targetGroup = target === null ? null : (tickets.find(ticket => ticket.id === target)?.status ?? null);
	/** The target whose row the page already unfolded and scrolled to; folding it again afterwards stays folded. */
	const shown = useRef<string | null>(null);
	/** The issue the sheet shows, kept after the hash drops it so the sheet's content stays through its exit slide. */
	const sheetId = useRef<string | null>(null);
	if (target) sheetId.current = target;
	const sheetListed = tickets.find(ticket => ticket.id === sheetId.current) ?? null;
	const start = (ticket: Ticket, action: TicketActionId) => onQuickAction(ticketStart(ticket, action, cwd));

	useEffect(() => {
		if (targetGroup === null || target === null || shown.current === target) return;
		if (collapsed.has(targetGroup)) {
			// Unfolding renders the row; this effect runs again and then scrolls to it.
			expand([targetGroup]);
			return;
		}
		shown.current = target;
		document.getElementById(ticketRowId(target))?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [targetGroup, target, collapsed]);

	useRevealSection(section, collapsed, expand);

	let body: ReactNode;
	if (!read && error) body = <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot load the tickets: {error}</p>;
	else if (!read) body = <p className="text-sm text-muted-foreground">Asking Linear for your issues…</p>;
	else {
		const groups = ticketGroups(tickets);
		body = (
			<>
				{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the tickets: {error}</p>}
				{target && targetGroup === null && (
					<p role="status" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
						{target} is not on this page, which lists the issues assigned to you that are open or closed in the last seven days.
					</p>
				)}
				{groups.length === 0 && <p className="text-sm text-muted-foreground">No issues assigned to you.</p>}
				{groups.map(group => (
					<GroupSection
						key={group.status}
						group={group}
						open={!collapsed.has(group.status)}
						onToggle={() => toggleCollapsed(group.status)}
						target={target}
						quick={quick}
						onQuickAction={start}
					/>
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
					<div className="mx-auto w-full max-w-5xl space-y-4 px-6 py-6">
						{quick && <QuickStartNotice quick={quick} onOpen={onOpen} onDismiss={onDismissQuick} />}
						{body}
					</div>
					{sheetId.current && (
						<Sheet open={target !== null} onClose={() => (location.hash = hashForTickets(null))}>
							<TicketSheetContent
								key={sheetId.current}
								id={sheetId.current}
								listed={sheetListed}
								actions={
									sheetListed && (
										<>
											<QuickActionButtons
												actions={ticketActions(sheetListed)}
												pending={pendingOf(quick, sheetListed.id)}
												onRun={action => start(sheetListed, action)}
											/>
											{quick && quick.op.subject.kind === "ticket" && quick.op.subject.id === sheetListed.id && (
												<QuickStartNotice quick={quick} onOpen={onOpen} onDismiss={onDismissQuick} />
											)}
										</>
									)
								}
							/>
						</Sheet>
					)}
				</TooltipProvider>
			</div>
		</div>
	);
}

/** The tickets page while omp is not signed in to Linear: the connection, to sign in from here as from the settings. */
export function TicketsDisconnected() {
	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header title="Tickets" meta="Your assigned issues on Linear" />
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-5xl px-6 py-6">
					<LinearConnection />
				</div>
			</div>
		</div>
	);
}
