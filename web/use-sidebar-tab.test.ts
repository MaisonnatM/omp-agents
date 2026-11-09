import { expect, test } from "bun:test";
import { type Page, routeFromHash } from "./routing";
import { pageSpace } from "./use-sidebar-tab";

const pageAt = (hash: string): Page => {
	const route = routeFromHash(hash);
	if (route.kind !== "page") throw new Error(`${hash} names no page`);
	return route.page;
};

test("a link to Sport takes the window to Personal and a link to Tickets to Work, whichever of their pages it opens", () => {
	expect(pageSpace(pageAt("#sport"))).toBe("personal");
	expect(pageSpace(pageAt("#sport/journal"))).toBe("personal");
	expect(pageSpace(pageAt("#tickets"))).toBe("work");
	expect(pageSpace(pageAt("#tickets/ENG-12"))).toBe("work");
});

test("every other page shows in both spaces and leaves the window's space as it is", () => {
	for (const hash of ["#todo", "#notes", "#calendar", "#pull-requests", "#bots", "#settings/models", "#get-started", "#scheduled"]) expect(pageSpace(pageAt(hash))).toBeNull();
});
