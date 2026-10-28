import { useState } from "react";
import type { TicketDetail } from "../../src/shared/tickets";
import { Button } from "@/components/ui/button";
import { useEditableRead } from "../editable-read";
import { ticketsStore } from "../reads";
import { TicketDetailContent } from "./tickets/ticket-details";

interface SessionTicketsTabProps {
	/** The Linear issues the session and its subagents worked on, by identifier, the session's own first; never empty. */
	tickets: string[];
	/** A change reads the shown issue from Linear again. */
	version?: unknown;
}

/** The session's Linear issues in the right sidebar: one in full, as the Tickets page shows it, the first until another is picked above it or from the shown one's parent and sub-issues. */
export function SessionTicketsTab({ tickets, version }: SessionTicketsTabProps) {
	const [picked, setPicked] = useState<string | null>(null);
	const shown = picked ?? tickets[0];
	const read = useEditableRead<TicketDetail>(shown ? `/api/ticket?${new URLSearchParams({ id: shown })}` : null, version);
	const listed = ticketsStore.use().read?.data.tickets.find(ticket => ticket.id === shown) ?? null;
	if (!shown) return null;
	return (
		<div className="flex min-h-0 flex-1 flex-col pt-2">
			{tickets.length > 1 && (
				<div role="group" aria-label="This session's Linear issues" className="flex shrink-0 flex-wrap gap-1 px-4 pb-2">
					{tickets.map(id => (
						<Button key={id} variant="ghost" size="compact" active={id === shown} aria-pressed={id === shown} onClick={() => setPicked(id)} className="tabular-nums">
							{id}
						</Button>
					))}
				</div>
			)}
			<TicketDetailContent key={shown} id={shown} listed={listed} read={read} placement="sidebar" onPick={setPicked} />
		</div>
	);
}
