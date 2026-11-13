import { expect, test } from "bun:test";
import { routeFromHash } from "../../routing";
import { hashForTickets } from "../../tickets-model";

test("the tickets hash opens the list or one issue's details, and no tickets hash is read as a layout", () => {
	expect(hashForTickets(null)).toBe("#tickets");
	expect(hashForTickets("ENG-2368")).toBe("#tickets/ENG-2368");
	expect(routeFromHash("#tickets")).toEqual({ kind: "page", page: { kind: "tickets", target: null } });
	expect(routeFromHash("#tickets/ENG-2368")).toEqual({ kind: "page", page: { kind: "tickets", target: "ENG-2368" } });
	expect(routeFromHash("#tickets/not-an-issue")).toEqual({ kind: "page", page: { kind: "tickets", target: null } });
	expect(routeFromHash("#ticketsx").kind).toBe("panes");
	expect(routeFromHash("#7c51f77b2a1bf7ba").kind).toBe("panes");
	for (const hash of ["#tickets", "#tickets/ENG-2368", "#tickets/x"]) expect(routeFromHash(hash).kind).toBe("page");
});
