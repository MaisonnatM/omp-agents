/** `TicketsPage`: your assigned Linear issues grouped by workflow state, as Linear's My issues lists them, with the open one beside them. */
import { ListTodo, Plus } from "lucide-react";
import { useRef } from "react";
import type { RosterHost } from "../../../src/shared/sessions";
import type { Ticket, TicketDetail } from "../../../src/shared/tickets";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { readPinnedSkill } from "../../pinned-skill";
import { pendingOf, ticketActions, ticketStart, type WorkActionId } from "../../quick-actions";
import { useEditableRead } from "../../editable-read";
import { ticketsStore } from "../../reads";
import { hashForTickets } from "../../routing";
import { sessionsOn } from "../../sessions";
import type { SectionTarget } from "../../section";
import type { StartOf } from "../../starts";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { type TicketGroup, ticketGroups, ticketSection } from "../../tickets-model";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { FoldButton, useFolds, useReveal } from "../fold";
import { PolledContent, PolledPageFrame, useReturnFocus } from "../list-page";
import { type BarAction, CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { DetailQuickActions, QuickStartNotice } from "../quick-actions";
import { TicketDetailContent } from "./ticket-details";
import { statusIcon, TicketRow, ticketRowId } from "./ticket-row";

/** Folded status groups, by status name. */
const COLLAPSED_KEY = "omp-agents.tickets-collapsed";

export const TICKETS_TITLE = "Tickets";
export const TICKETS_META = "Your assigned issues on Linear";

interface GroupProps {
	group: TicketGroup;
	open: boolean;
	/** The issue whose details show beside the list. */
	target: string | null;
	onToggle: () => void;
	quick: StartOf<"quick"> | null;
	onQuickAction: (ticket: Ticket, action: WorkActionId) => void;
}

function GroupSection({ group, open, target, onToggle, quick, onQuickAction }: GroupProps) {
	const { id } = ticketSection(group.status);
	const [Icon, color] = statusIcon(group);
	return (
		// Focused when its sidebar link is chosen.
		<section id={id} tabIndex={-1} aria-labelledby={`${id}-heading`} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
			<h3 id={`${id}-heading`} className="sticky top-0 z-10 flex h-10 items-center rounded-md bg-muted px-3 text-sm font-medium">
				<FoldButton open={open} onToggle={onToggle} controls={`${id}-list`} className="items-center gap-2.5">
					<Icon aria-hidden className={`size-4 shrink-0 ${color}`} />
					{group.status}
					<span className="tabular-nums text-muted-foreground">{group.count}</span>
				</FoldButton>
			</h3>
			{open && (
				// A row scrolled into view clears the sticky h-10 heading above it.
				<ul id={`${id}-list`} className="py-1 *:scroll-mt-12 *:scroll-mb-2">
					{group.entries.flatMap(({ ticket, subIssues }) =>
						[ticket, ...subIssues].map(row => (
							<TicketRow
								key={row.id}
								ticket={row}
								nested={row !== ticket}
								open={row.id === target}
								pending={pendingOf(quick, { kind: "ticket", id: row.id })}
								onQuickAction={action => onQuickAction(row, action)}
							/>
						)),
					)}
				</ul>
			)}
		</section>
	);
}

interface TicketsPageProps {
	/** The issue whose details show beside the list; `null` shows the list alone. */
	target: string | null;
	/** The group a sidebar link last chose, to unfold, scroll to, and focus. */
	section: SectionTarget | null;
	/**
	 * Where a quick action's session starts. A Linear issue names no repository, so the caller passes the directory a
	 * new session would start in, which the sidebar's workspace decides.
	 */
	cwd: string;
	/** Running sessions, which the issues they work on name. */
	hosts: RosterHost[];
}

/** The viewer's assigned Linear issues by workflow state, as Linear's My issues lists them, and beside them the issue `target` names. */
export function TicketsPage({ target, section, cwd, hosts }: TicketsPageProps) {
	const { open, start: startSession, dismissStart, openNewTicket } = useDashboardActions();
	const { starts: { quick } } = useDashboardStatus();
	const poll = ticketsStore.usePolling();
	const tickets = poll.read?.data.tickets ?? [];
	const detailRead = useEditableRead<TicketDetail>(target && `/api/ticket?${new URLSearchParams({ id: target })}`);
	const folds = useFolds(COLLAPSED_KEY);
	const start = (ticket: Ticket, action: WorkActionId) => startSession(ticketStart(ticket, action, cwd, readPinnedSkill()));
	const listRef = useRef<HTMLDivElement>(null);
	useReturnFocus(target, id => id, id => document.getElementById(ticketRowId(id))?.querySelector<HTMLElement>("a"), poll.read, () => listRef.current);
	useReveal(target === null ? section : null, folds, { token: section, block: "start", focus: true });
	// On this page ⌘N creates a ticket, where the App's binding of it starts a session.
	useShortcuts({ ticketsNew: () => openNewTicket("") });

	const groups = ticketGroups(tickets);
	// The rows in the list's order, sub-issues under their parents, which the open issue's previous and next step through.
	const rows = groups.flatMap(group => group.entries.flatMap(({ ticket, subIssues }) => [ticket, ...subIssues]));
	const at = rows.findIndex(row => row.id === target);
	const stepTo = (row: Ticket | undefined, label: string, icon: BarAction["icon"]): BarAction => (row ? { label, icon, href: hashForTickets(row.id) } : { label, icon, onClick: undefined });

	return (
		<PolledPageFrame
			title={TICKETS_TITLE}
			meta={TICKETS_META}
			poll={poll}
			onRefresh={() => void ticketsStore.refresh(null, { fresh: true })}
			actions={
				<Tooltip content="Create a Linear issue, assigned to you" shortcut={[...shortcutLabels("ticketsNew"), ...shortcutLabels("newTicket")]} side="bottom">
					<Button variant="ghost" size="compact" leadingIcon={Plus} onClick={() => openNewTicket("")}>
						New ticket
					</Button>
				</Tooltip>
			}
		>
			<TooltipProvider>
				<ListSplit
					widthKey="omp-agents.tickets-list-width"
					resizeLabel="Resize the ticket list"
					detailLabel="Open issue"
					empty={{ icon: ListTodo, title: "No issue open", hint: "Click one to see its details here." }}
					list={
						<div className="space-y-1 px-2 pt-2 pb-6">
							{quick && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
							<PolledContent noun="the tickets" loading="Asking Linear for your issues…" poll={poll}>
								{() => (
									<div ref={listRef} tabIndex={-1} className="space-y-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
										{groups.length === 0 && <p className="px-3 text-sm text-muted-foreground">No issues assigned to you.</p>}
										{groups.map(group => (
											<GroupSection
												key={group.status}
												group={group}
												open={!folds.isFolded(group.status)}
												target={target}
												onToggle={() => folds.toggle(group.status)}
												quick={quick}
												onQuickAction={start}
											/>
										))}
									</div>
								)}
							</PolledContent>
						</div>
					}
					detail={
						target === null ? null : (
							<section key={target} aria-label={target} className="flex h-full min-h-0 min-w-0 flex-col">
								<DetailBar
									leading={at >= 0 && <span className="tabular-nums">{at + 1} of {rows.length}</span>}
									previous={stepTo(rows[at - 1], "Previous issue", CH_PREVIOUS)}
									next={at >= 0 ? stepTo(rows[at + 1], "Next issue", CH_NEXT) : stepTo(undefined, "Next issue", CH_NEXT)}
									close={{ label: "Close", icon: CH_CLOSE, href: hashForTickets(null) }}
								/>
								<div className="min-h-0 flex-1 overflow-y-auto pb-6">
									<TicketDetailContent
										id={target}
										listed={rows[at] ?? null}
										read={detailRead}
										actions={ticket => (
											<DetailQuickActions
												actions={ticketActions(ticket)}
												pending={pendingOf(quick, { kind: "ticket", id: target })}
												onRun={action => {
													if (action === "work" || action === "plan") start(ticket, action);
												}}
												sessions={sessionsOn({ kind: "ticket", id: target }, hosts)}
												onOpen={open}
											/>
										)}
									/>
								</div>
							</section>
						)
					}
				/>
			</TooltipProvider>
		</PolledPageFrame>
	);
}
