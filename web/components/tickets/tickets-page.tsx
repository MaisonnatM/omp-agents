import type { Ticket, View } from "../../../src/shared";
import { readPinnedSkill } from "../../pinned-skill";
import { pendingOf, type TicketActionId, ticketActions, ticketStart } from "../../quick-actions";
import { hashForTickets, type OpenMode } from "../../routing";
import type { SectionTarget } from "../../section";
import type { QuickOp, StartOf } from "../../starts";
import { useStoredKeys } from "../../stored-keys";
import { type TicketGroup, ticketGroups, ticketSection } from "../../tickets-model";
import { refreshTickets, useTickets } from "../../use-tickets";
import { FoldButton, useRevealRow, useRevealSection } from "../fold";
import { ListSheetPage, PageFrame, TargetSheet } from "../list-sheet-page";
import { QuickStartNotice, SheetQuickActions } from "../quick-actions";
import { LinearConnection } from "../settings/linear-connection";
import { TicketSheetContent } from "./ticket-details";
import { STATUS_ICON, TicketRow, ticketRowId } from "./ticket-row";

/** Folded status groups, by status name. */
const COLLAPSED_KEY = "omp-agents.tickets-collapsed";

const TITLE = "Tickets";
const META = "Your assigned issues on Linear";

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
	const poll = useTickets(true);
	const tickets = poll.read?.data.tickets ?? [];
	const [collapsed, toggleCollapsed, expand] = useStoredKeys(COLLAPSED_KEY);
	const targetGroup = target === null ? null : (tickets.find(ticket => ticket.id === target)?.status ?? null);
	const start = (ticket: Ticket, action: TicketActionId) => onQuickAction(ticketStart(ticket, action, cwd, readPinnedSkill()));
	useRevealRow(target !== null && targetGroup !== null ? { id: ticketRowId(target), folds: [targetGroup] } : null, collapsed, expand);
	useRevealSection(section, collapsed, expand);

	return (
		<ListSheetPage
			title={TITLE}
			meta={META}
			noun="the tickets"
			loading="Asking Linear for your issues…"
			poll={poll}
			onRefresh={() => void refreshTickets(true)}
			missing={
				target && targetGroup === null
					? `${target} is not on this page, which lists the issues assigned to you that are open or closed in the last seven days.`
					: null
			}
			notice={quick && <QuickStartNotice quick={quick} onOpen={onOpen} onDismiss={onDismissQuick} />}
			spacing="space-y-4"
			sheet={
				<TargetSheet target={target} onClose={() => (location.hash = hashForTickets(null))}>
					{id => {
						const listed = tickets.find(ticket => ticket.id === id) ?? null;
						return (
							<TicketSheetContent
								key={id}
								id={id}
								listed={listed}
								actions={
									listed && (
										<SheetQuickActions
											item={{ kind: "ticket", id }}
											actions={ticketActions(listed)}
											onRun={action => start(listed, action)}
											quick={quick}
											onOpen={onOpen}
											onDismiss={onDismissQuick}
										/>
									)
								}
							/>
						);
					}}
				</TargetSheet>
			}
		>
			{() => {
				const groups = ticketGroups(tickets);
				return (
					<>
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
