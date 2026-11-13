import { SidebarGroup, SidebarMenu } from "@/components/ui/sidebar";
import { hashForTickets } from "../../routing";
import type { SectionTarget } from "../../section";
import { ticketsStore } from "../../reads";
import { ticketGroups, ticketSection } from "../../tickets-model";
import { SectionLink } from "../section-link";

const navNote = (text: string) => <p className="px-2 py-1 text-xs text-muted-foreground">{text}</p>;

interface TicketsNavProps {
	target: SectionTarget | null;
	onTarget: (target: SectionTarget) => void;
}

/** The tickets page's status groups with their issue counts, each a link to its group on the page. */
export function TicketsNav({ target, onTarget }: TicketsNavProps) {
	const { read, error } = ticketsStore.use();
	if (!read) return <SidebarGroup>{navNote(error ? `Cannot load the tickets: ${error}` : "Asking Linear for your issues…")}</SidebarGroup>;
	const groups = ticketGroups(read.data.tickets);
	if (groups.length === 0) return <SidebarGroup>{navNote("No issues assigned to you.")}</SidebarGroup>;
	return (
		<SidebarGroup>
			<SidebarMenu aria-label="Ticket groups">
				{groups.map(({ status, count: length }) => (
					<SectionLink
						key={status}
						href={hashForTickets(null)}
						section={ticketSection(status)}
						chosen={target}
						title={status}
						label={`${status}, ${length} issue${length === 1 ? "" : "s"}`}
						count={length}
						onChoose={section => {
							location.hash = hashForTickets(null);
							onTarget(section);
						}}
					/>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
