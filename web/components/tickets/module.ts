/**
 * The Tickets module's page half, which `WEB_MODULES` in `web/modules.ts` lists: the Tickets page and its sidebar list.
 * Ticket links, the new-ticket dialog, and a session's Tickets tab are the core's, so they work with the page gone.
 */
import { TICKET_ID } from "../../../src/shared/tickets";
import { PAGE_ICON } from "../../page-icons";
import type { PageModule } from "../../modules";

/** The tickets list, or the Linear issue whose details replace it when `target` is non-null. */
export interface TicketsRoute {
	/** The issue's identifier: `ENG-2368`. */
	target: string | null;
}

export const TICKETS_PAGE: PageModule<"tickets", TicketsRoute, "ticketsNew"> = {
	id: "tickets",
	tab: { label: "Tickets", icon: PAGE_ICON.tickets, place: 20, integration: "linear" },
	home: { target: null },
	/** `#tickets` lists the viewer's assigned Linear issues, and `#tickets/<identifier>` opens that issue's details beside them; any other `#tickets/…` opens the list alone. */
	address: {
		parse: rest => ({ target: rest !== null && TICKET_ID.test(rest) ? rest : null }),
		rest: ({ target }) => target || null,
		query: () => null,
	},
	title: ({ target }) => target ?? "Tickets",
	views: [
		{ key: "tickets", label: "Tickets" },
		{ key: "tickets/item", label: "A ticket" },
	],
	view: ({ target }) => (target === null ? "tickets" : "tickets/item"),
	shortcuts: {
		category: "Tickets",
		goTo: { label: "Go to your Linear tickets", command: "Go to tickets", keys: [] },
		rows: [{ id: "ticketsNew", label: "Tickets page: create a Linear ticket, in place of a new session", keys: [{ chord: { key: "n", mod: true }, scope: "anywhere" }] }],
	},
	controls: [],
	split: true,
};
