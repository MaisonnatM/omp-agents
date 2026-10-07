import { useEffect, useRef, useState } from "react";
import type { RosterHost, View } from "../../../src/shared/sessions";
import type { McpIntegration } from "../../../src/shared/accounts";
import type { Ticket, TicketDetail } from "../../../src/shared/tickets";
import { readPinnedSkill } from "../../pinned-skill";
import { pendingOf, type TicketActionId, ticketActions, ticketStart } from "../../quick-actions";
import { ticketsStore, useReplaceableRead } from "../../reads";
import { hashForTickets, type OpenMode } from "../../routing";
import { sessionsOn } from "../../sessions";
import type { SectionTarget } from "../../section";
import type { StartOf } from "../../starts";
import { type TicketGroup, ticketGroups, ticketSection } from "../../tickets-model";
import { useDashboardContext } from "../dashboard-context";
import { FoldButton, useFolds, useReveal } from "../fold";
import { DetailPage, ListPage, PageFrame } from "../list-page";
import { DetailQuickActions, QuickStartNotice } from "../quick-actions";
import { IntegrationList } from "../integrations/integration-row";
import { McpIntegrationRow } from "../integrations/mcp-integration";
import { TicketDetailContent } from "./ticket-details";
import { statusIcon, TicketRow, ticketRowId } from "./ticket-row";

/** Folded status groups, by status name. */
const COLLAPSED_KEY = "omp-agents.tickets-collapsed";

const TITLE = "Tickets";
const META = "Your assigned issues on Linear";

interface GroupProps {
	group: TicketGroup;
	open: boolean;
	onToggle: () => void;
	hosts: RosterHost[];
	onOpen: (view: View, mode: OpenMode) => void;
	quick: StartOf<"quick"> | null;
	onQuickAction: (ticket: Ticket, action: TicketActionId) => void;
}

function GroupSection({ group, open, onToggle, hosts, onOpen, quick, onQuickAction }: GroupProps) {
	const { id } = ticketSection(group.status);
	const [Icon, color] = statusIcon(group);
	return (
		// Focused when its sidebar link is chosen.
		<section id={id} tabIndex={-1} aria-labelledby={`${id}-heading`} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
			<h3 id={`${id}-heading`} className="sticky top-0 z-10 flex h-10 items-center rounded-md bg-muted px-3 text-sm font-medium">
				<FoldButton open={open} onToggle={onToggle} controls={`${id}-list`} className="items-center gap-2.5">
					<Icon aria-hidden className={`size-4 shrink-0 ${color}`} />
					{group.status}
					<span className="tabular-nums text-muted-foreground">{group.tickets.length}</span>
				</FoldButton>
			</h3>
			{open && (
				// A row scrolled into view clears the sticky h-10 heading above it.
				<ul id={`${id}-list`} className="py-1 *:scroll-mt-12 *:scroll-mb-2">
					{group.tickets.map(ticket => (
						<TicketRow
							key={ticket.id}
							ticket={ticket}
							sessions={sessionsOn({ kind: "ticket", id: ticket.id }, hosts)}
							onOpen={onOpen}
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
	/** Running sessions, which the issues they work on name. */
	hosts: RosterHost[];
}

/** The viewer's assigned Linear issues by workflow state, as Linear's My issues lists them. */
export function TicketsPage({ target, section, cwd, hosts }: TicketsPageProps) {
	const { open, start: startSession, dismissStart, starts: { quick } } = useDashboardContext();
	const poll = ticketsStore.usePolling();
	const tickets = poll.read?.data.tickets ?? [];
	const [version, setVersion] = useState(0);
	const detailRead = useReplaceableRead<TicketDetail>(target && `/api/ticket?${new URLSearchParams({ id: target })}`, version);
	const folds = useFolds(COLLAPSED_KEY);
	const start = (ticket: Ticket, action: TicketActionId) => startSession(ticketStart(ticket, action, cwd, readPinnedSkill()));
	const listRef = useRef<HTMLDivElement>(null);
	const returnTo = useRef<string | null>(null);
	useEffect(() => {
		if (target !== null) returnTo.current = target;
	}, [target]);
	// Back from an issue's details, focus returns to its row, else the list: the lists mount only after a read.
	useEffect(() => {
		if (target !== null || returnTo.current === null) return;
		const destination = document.getElementById(ticketRowId(returnTo.current))?.querySelector("a") ?? listRef.current;
		if (!destination) return;
		destination.focus();
		returnTo.current = null;
	}, [target, poll.read]);
	useReveal(target === null ? section : null, folds, { token: section, block: "start", focus: true });

	if (target !== null) {
		const listed = tickets.find(ticket => ticket.id === target) ?? null;
		return (
			<DetailPage
				title={target}
				meta={(detailRead.data ?? listed)?.title ?? "Linear issue"}
				backHref={hashForTickets(null)}
				backLabel="Back to tickets"
				notice={quick && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
				className="max-w-6xl pt-8"
			>
				<TicketDetailContent
					key={target}
					id={target}
					listed={listed}
					read={{ ...detailRead, reload: () => setVersion(count => count + 1) }}
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
			</DetailPage>
		);
	}

	return (
		<ListPage
			title={TITLE}
			meta={META}
			noun="the tickets"
			loading="Asking Linear for your issues…"
			poll={poll}
			onRefresh={() => void ticketsStore.refresh(null, { fresh: true })}
			notice={quick && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
			className="max-w-none space-y-1 px-4 pt-3"
		>
			{() => {
				const groups = ticketGroups(tickets);
				return (
					<div ref={listRef} tabIndex={-1} className="space-y-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
						{groups.length === 0 && <p className="text-sm text-muted-foreground">No issues assigned to you.</p>}
						{groups.map(group => (
							<GroupSection
								key={group.status}
								group={group}
								open={!folds.isFolded(group.status)}
								onToggle={() => folds.toggle(group.status)}
								hosts={hosts}
								onOpen={open}
								quick={quick}
								onQuickAction={start}
							/>
						))}
					</div>
				);
			}}
		</ListPage>
	);
}

/** The tickets page while omp cannot read Linear: Linear's integration row, to connect from here as from Settings › Integrations. */
export function TicketsDisconnected({ linear }: { linear: McpIntegration }) {
	return (
		<PageFrame title={TITLE} meta={META}>
			<div className="mx-auto w-full max-w-3xl px-6 py-6">
				<IntegrationList label="Linear connection">
					<McpIntegrationRow integration={linear} />
				</IntegrationList>
			</div>
		</PageFrame>
	);
}
