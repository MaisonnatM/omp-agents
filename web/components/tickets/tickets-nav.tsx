import { SidebarGroup, SidebarMenu } from "@/components/ui/sidebar";
import type { SectionTarget } from "../../section";
import { ticketsStore } from "../../reads";
import { hashForTickets, ticketGroups, ticketSection } from "../../tickets-model";
import { SectionLink } from "../section-link";

const navNote = (text: string) => <p className="px-2 py-1 text-xs text-muted-foreground">{text}</p>;

/** The tickets page's status groups with their issue counts, each a link to its group on the page. */
export function TicketsNav({ section: chosen, onSection }: { section: SectionTarget | null; onSection: (section: SectionTarget) => void }) {
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
						chosen={chosen}
						title={status}
						label={`${status}, ${length} issue${length === 1 ? "" : "s"}`}
						count={length}
						onChoose={section => {
							location.hash = hashForTickets(null);
							onSection(section);
						}}
					/>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
