/**
 * `TicketsPage`: your assigned Linear issues grouped by workflow state, as Linear's My issues lists them, or by
 * **Display**'s grouping, under a bar of tabs, **Filter**, and **Display**, with the open one beside them.
 */
import { IconBox, IconPlusLarge, IconTodos } from "central-icons";
import { useRef, useState } from "react";
import { callable } from "../../../src/shared/accounts";
import type { RosterHost } from "../../../src/shared/sessions";
import type { Ticket, TicketDetail } from "../../../src/shared/tickets";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { readPinnedSkill } from "../../pinned-skill";
import { pendingOf, ticketActions, ticketStart, type WorkActionId } from "../../quick-actions";
import { useEditableRead } from "../../editable-read";
import { integrationsStore, ticketsStore } from "../../reads";
import { sessionsOn } from "../../sessions";
import type { StartOf } from "../../starts";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { activityControl } from "../../activity";
import { hashForTickets } from "../../tickets-model";
import { filteredTickets, filters, groupedTickets, listedRows, type TicketListGroup, VIEW_PRESETS, withoutFilters } from "../../tickets-filter";
import { useTicketsDisplay, useTicketsFilter } from "../../tickets-state";
import { sectionId } from "../../section";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { DisconnectedPage } from "../integrations/disconnected-page";
import type { CoreData } from "../module-views";
import { FoldButton, useFolds } from "../fold";
import { PolledContent, PolledPageFrame, useReturnFocus } from "../list-page";
import { type BarAction, CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { DetailQuickActions, QuickStartNotice } from "../quick-actions";
import { SearchField } from "../search-field";
import type { TicketsRoute } from "./module";
import { TicketDetailContent } from "./ticket-details";
import { PRIORITY_ICON, statusIcon, TicketRow, ticketRowId } from "./ticket-row";
import { TicketViewBar } from "./ticket-view-bar";

/** Folded groups, by fold key: a status's name, `priority:<n>`, or `project:<name>`. */
const COLLAPSED_KEY = "omp-agents.tickets-collapsed";

const TICKETS_TITLE = "Linear tickets";
const TICKETS_META = "Your assigned issues";

interface GroupProps {
	group: TicketListGroup;
	open: boolean;
	/** The issue whose details show beside the list. */
	target: string | null;
	onToggle: () => void;
	quick: StartOf<"quick"> | null;
	onQuickAction: (ticket: Ticket, action: WorkActionId) => void;
}

/** A group's heading, which folds its rows, and its rows; under no grouping, the rows alone. */
function GroupSection({ group, open, target, onToggle, quick, onQuickAction }: GroupProps) {
	const id = sectionId("tickets", group.foldKey);
	const { heading } = group;
	const rows = (
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
	);
	if (heading === null) return rows;
	const [Icon, color] = heading.by === "status" ? statusIcon(heading.status) : heading.by === "priority" ? PRIORITY_ICON[heading.priority] : [IconBox, "text-muted-foreground"];
	return (
		<section aria-labelledby={`${id}-heading`}>
			<h3 id={`${id}-heading`} className="sticky top-0 z-10 flex h-10 items-center rounded-md bg-muted px-3 text-sm font-medium">
				<FoldButton open={open} onToggle={onToggle} controls={`${id}-list`} className="items-center gap-2.5">
					<Icon aria-hidden className={`size-4 shrink-0 ${color}`} />
					{group.title}
					<span className="tabular-nums text-muted-foreground">{group.count}</span>
				</FoldButton>
			</h3>
			{open && rows}
		</section>
	);
}

interface TicketsListProps {
	/** The issue whose details show beside the list; `null` shows the list alone. */
	target: string | null;
	/**
	 * Where a quick action's session starts. A Linear issue names no repository, so the caller passes the directory a
	 * new session would start in, which the sidebar's workspace decides.
	 */
	cwd: string;
	/** Running sessions, which the issues they work on name. */
	hosts: RosterHost[];
}

/** The Tickets page: Linear's integration row while Linear refuses omp's sign-in, else the viewer's assigned issues once the sessions are listed. */
export function TicketsPage({ route: { target }, core }: { route: TicketsRoute; core: CoreData }) {
	const linear = integrationsStore.use().read?.data.integrations.linear;
	if (linear && !callable(linear.connection)) return <DisconnectedPage title={TICKETS_TITLE} meta={TICKETS_META} integration={linear} />;
	// Until the sessions are listed, the workspace a quick action starts in is not known yet.
	if (!core.listed) return <p className="m-auto text-sm text-muted-foreground">Listing sessions…</p>;
	return <TicketsList target={target} cwd={core.cwd} hosts={core.hosts} />;
}

/** The note and the button of a list that the search, **Filter**, or the tab leave empty. */
function nothingMatches(search: string, filtering: boolean, view: string): { text: string; clear: string } {
	if (search && filtering) return { text: "No issues match the search and these filters.", clear: "Clear the search and filters" };
	if (search) return { text: `No issues match “${search}”.`, clear: "Clear the search" };
	if (filtering) return { text: "No issues match these filters.", clear: "Clear the filters" };
	return { text: `No ${view.toLowerCase()} issues assigned to you.`, clear: "Show all issues" };
}

/** What a list with assigned issues shows while the search, **Filter**, or the tab keep none: a note and a button that clears them, the tab last. */
function NothingMatches({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
	const [filter, setFilter] = useTicketsFilter();
	const search = query.trim();
	const filtering = filters(filter);
	const { text, clear } = nothingMatches(search, filtering, VIEW_PRESETS[filter.view].label);
	return (
		<div className="space-y-3 px-3 py-2">
			<p className="text-sm text-muted-foreground">{text}</p>
			<Button
				{...activityControl(search || filtering ? "tickets.filter.clear" : "tickets.view")}
				size="compact"
				variant="outline"
				onClick={() => {
					if (search) onQuery("");
					if (filtering) setFilter(withoutFilters(filter));
					if (!search && !filtering) setFilter({ ...filter, view: "all" });
				}}
			>
				{clear}
			</Button>
		</div>
	);
}

/**
 * The viewer's assigned Linear issues that the tab, **Filter**, and the search keep, by workflow state as Linear's My
 * issues lists them or by **Display**'s grouping, and beside them the issue `target` names.
 */
function TicketsList({ target, cwd, hosts }: TicketsListProps) {
	const { open, start: startSession, dismissStart, openNewTicket } = useDashboardActions();
	const { starts: { quick } } = useDashboardStatus();
	const poll = ticketsStore.usePolling();
	const tickets = poll.read?.data.tickets ?? [];
	const detailRead = useEditableRead<TicketDetail>(target && `/api/ticket?${new URLSearchParams({ id: target })}`);
	const folds = useFolds(COLLAPSED_KEY);
	const [query, setQuery] = useState("");
	const [filter] = useTicketsFilter();
	const [{ grouping }] = useTicketsDisplay();
	const start = (ticket: Ticket, action: WorkActionId) => startSession(ticketStart(ticket, action, cwd, readPinnedSkill()));
	const listRef = useRef<HTMLDivElement>(null);
	useReturnFocus(target, id => id, id => document.getElementById(ticketRowId(id))?.querySelector<HTMLElement>("a"), poll.read, () => listRef.current);
	// On this page ⌘⇧O creates a ticket, where the App's binding of it starts a session.
	useShortcuts({ ticketsNew: () => openNewTicket("") });

	const groups = groupedTickets(grouping, filteredTickets(tickets, filter, query, Date.now()));
	// The rows in the list's order, sub-issues under their parents, which the open issue's previous and next step through.
	const rows = listedRows(groups);
	const at = rows.findIndex(row => row.id === target);
	const stepTo = (row: Ticket | undefined, label: string, icon: BarAction["icon"]): BarAction => (row ? { label, icon, href: hashForTickets(row.id) } : { label, icon, onClick: undefined });

	return (
		<PolledPageFrame
			title={TICKETS_TITLE}
			meta={TICKETS_META}
			poll={poll}
			onRefresh={() => void ticketsStore.refresh(null, { fresh: true })}
			actions={
				<>
					<span {...activityControl("tickets.search")}>
						<SearchField label="Search tickets" placeholder="Search" query={query} onQuery={setQuery} className="w-36" />
					</span>
					<Tooltip content="Create a Linear issue, assigned to you" shortcut={[...shortcutLabels("ticketsNew"), ...shortcutLabels("newTicket")]} side="bottom">
						<Button variant="ghost" size="compact" leadingIcon={IconPlusLarge} onClick={() => openNewTicket("")}>
							New ticket
						</Button>
					</Tooltip>
				</>
			}
		>
			<TooltipProvider>
				<ListSplit
					widthKey="omp-agents.tickets-list-width"
					resizeLabel="Resize the ticket list"
					detailLabel="Open issue"
					empty={{ icon: IconTodos, title: "No issue open", hint: "Click one to see its details here." }}
					list={
						<div className="space-y-1 px-2 pt-2 pb-6">
							{quick && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
							<PolledContent noun="the tickets" loading="Asking Linear for your issues…" poll={poll}>
								{() => (
									<>
										{tickets.length > 0 && <TicketViewBar tickets={tickets} />}
										<div ref={listRef} tabIndex={-1} className="space-y-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
											{tickets.length === 0 && <p className="px-3 text-sm text-muted-foreground">No issues assigned to you.</p>}
											{tickets.length > 0 && groups.length === 0 && <NothingMatches query={query} onQuery={setQuery} />}
											{groups.map(group => (
												<GroupSection
													key={group.foldKey}
													group={group}
													open={group.heading === null || !folds.isFolded(group.foldKey)}
													target={target}
													onToggle={() => folds.toggle(group.foldKey)}
													quick={quick}
													onQuickAction={start}
												/>
											))}
										</div>
									</>
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
								<div className="flex min-h-0 flex-1 flex-col">
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
