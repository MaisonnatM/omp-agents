import { describe, expect, test } from "bun:test";
import type { Ticket } from "../src/shared/tickets";
import { DAY } from "./list-filter";
import {
	DEFAULT_DISPLAY,
	decodeDisplay,
	decodeFilter,
	encodeDisplay,
	encodeFilter,
	filteredTickets,
	filters,
	groupedTickets,
	labelOptions,
	listedRows,
	NO_FILTER,
	offersTeams,
	priorityOptions,
	statusOptions,
	type TicketFilter,
	withoutFilters,
} from "./tickets-filter";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

const ticket = (id: string, fields: Partial<Ticket> = {}): Ticket => ({
	id,
	title: `Issue ${id}`,
	url: `https://linear.app/acme/issue/${id}`,
	status: "Todo",
	statusType: "unstarted",
	priority: 3,
	labels: [],
	project: null,
	team: "Engineering",
	dueDate: null,
	createdAt: "2026-09-01T00:00:00.000Z",
	updatedAt: "2026-10-01T10:00:00.000Z",
	branch: id.toLowerCase(),
	parentId: null,
	...fields,
});

const ids = (tickets: readonly Ticket[]): string[] => tickets.map(({ id }) => id);

const filter = (change: Partial<TicketFilter>): TicketFilter => ({ ...NO_FILTER, ...change });

const review = ticket("ENG-1", { status: "In Review", statusType: "started", priority: 1, labels: [{ name: "Bug", color: "" }], project: "Login" });
const progress = ticket("ENG-2", { status: "In Progress", statusType: "started", priority: 2, labels: [{ name: "Feature", color: "" }], project: "Billing" });
const todo = ticket("ENG-3", { title: "Fix the login redirect", priority: 0, labels: [{ name: "Bug", color: "" }, { name: "Web", color: "" }] });
const backlog = ticket("OPS-4", { status: "Backlog", statusType: "backlog", priority: 4, team: "Operations", project: "Login" });
const triage = ticket("ENG-5", { status: "Triage", statusType: "triage" });
const everyTicket = [review, progress, todo, backlog, triage];

describe("the stored filter and display", () => {
	test("reads back what it stored", () => {
		const stored = filter({ view: "active", statuses: new Set(["In Review"]), priorities: new Set(["1", "0"]), labels: new Set(["Bug"]), projects: new Set(["Login"]), teams: new Set(["Engineering"]), created: 7, updated: 1 });
		expect(decodeFilter(encodeFilter(stored))).toEqual(stored);
		expect(decodeDisplay(encodeDisplay({ grouping: "project" }))).toEqual({ grouping: "project" });
	});

	test("falls back to no filter and the grouping by status for what is missing or unreadable", () => {
		expect(decodeFilter(null)).toEqual(NO_FILTER);
		expect(decodeFilter("not json")).toEqual(NO_FILTER);
		expect(decodeFilter(JSON.stringify({ view: "mine", priorities: ["1", "9"], labels: "Bug", teams: ["Ops", 2], created: 5, updated: 30 }))).toEqual(filter({ priorities: new Set(["1"]), updated: 30 }));
		expect(decodeDisplay(null)).toEqual(DEFAULT_DISPLAY);
		expect(decodeDisplay(JSON.stringify({ grouping: "assignee" }))).toEqual({ grouping: "status" });
	});

	test("counts a tab as no filter, and clearing the filters keeps the tab", () => {
		expect(filters(filter({ view: "backlog" }))).toBe(false);
		expect(filters(filter({ updated: 1 }))).toBe(true);
		expect(withoutFilters(filter({ view: "todo", labels: new Set(["Bug"]), created: 3 }))).toEqual(filter({ view: "todo" }));
	});
});

describe("filtering and searching tickets", () => {
	const kept = (change: Partial<TicketFilter>, query = "") => ids(filteredTickets(everyTicket, filter(change), query, NOW));

	test("each tab keeps one kind of state, Active with In Review, and All keeps triage too", () => {
		expect(kept({})).toEqual(ids(everyTicket));
		expect(kept({ view: "active" })).toEqual(["ENG-1", "ENG-2"]);
		expect(kept({ view: "todo" })).toEqual(["ENG-3"]);
		expect(kept({ view: "backlog" })).toEqual(["OPS-4"]);
	});

	test("the tab and the status filter both apply, so a status outside the tab keeps nothing", () => {
		expect(kept({ view: "active", statuses: new Set(["In Review"]) })).toEqual(["ENG-1"]);
		expect(kept({ view: "active", statuses: new Set(["Todo"]) })).toEqual([]);
		expect(kept({ statuses: new Set(["Todo", "Backlog"]) })).toEqual(["ENG-3", "OPS-4"]);
	});

	test("keeps any checked priority, label, project, or team, and every field must pass", () => {
		expect(kept({ priorities: new Set(["0", "4"]) })).toEqual(["ENG-3", "OPS-4"]);
		expect(kept({ labels: new Set(["Bug"]) })).toEqual(["ENG-1", "ENG-3"]);
		expect(kept({ projects: new Set(["Login"]) })).toEqual(["ENG-1", "OPS-4"]);
		expect(kept({ teams: new Set(["Operations"]) })).toEqual(["OPS-4"]);
		expect(kept({ labels: new Set(["Bug"]), projects: new Set(["Login"]) })).toEqual(["ENG-1"]);
	});

	test("a date range keeps an issue on its boundary and drops one a moment older", () => {
		const edge = new Date(NOW - 3 * DAY).toISOString();
		const older = new Date(NOW - 3 * DAY - 1).toISOString();
		const tickets = [ticket("A-1", { createdAt: edge, updatedAt: older }), ticket("A-2", { createdAt: older, updatedAt: edge })];
		expect(ids(filteredTickets(tickets, filter({ created: 3 }), "", NOW))).toEqual(["A-1"]);
		expect(ids(filteredTickets(tickets, filter({ updated: 3 }), "", NOW))).toEqual(["A-2"]);
	});

	test("the search needs every word, in any case, among the identifier, title, labels, project, and team", () => {
		expect(kept({}, "login BUG")).toEqual(["ENG-1", "ENG-3"]);
		expect(kept({}, "ops-4")).toEqual(["OPS-4"]);
		expect(kept({}, "operations login")).toEqual(["OPS-4"]);
		expect(kept({}, "redirect web")).toEqual(["ENG-3"]);
		expect(kept({}, "redirect billing")).toEqual([]);
		expect(kept({ view: "backlog" }, "redirect")).toEqual([]);
	});
});

describe("filter options", () => {
	test("lists the statuses in the groups' order with their counts, then a checked one no issue has", () => {
		expect(statusOptions([todo, progress, review, ticket("ENG-9")], new Set(["Done"]))).toEqual([
			{ key: "In Review", label: "In Review", count: 1 },
			{ key: "In Progress", label: "In Progress", count: 1 },
			{ key: "Todo", label: "Todo", count: 2 },
			{ key: "Done", label: "Done", count: 0 },
		]);
	});

	test("lists every priority, urgent first and no priority last, with its count", () => {
		expect(priorityOptions(everyTicket).map(({ label, count }) => [label, count])).toEqual([
			["Urgent", 1],
			["High", 1],
			["Medium", 1],
			["Low", 1],
			["No priority", 1],
		]);
	});

	test("lists labels most worn first, then by name, then a checked one no issue wears", () => {
		expect(labelOptions(everyTicket, new Set(["Docs"])).map(({ key, count }) => [key, count])).toEqual([
			["Bug", 2],
			["Feature", 1],
			["Web", 1],
			["Docs", 0],
		]);
	});

	test("offers teams only once the issues come from several, or while one is still checked", () => {
		expect(offersTeams(everyTicket, NO_FILTER)).toBe(true);
		expect(offersTeams([review, todo], NO_FILTER)).toBe(false);
		expect(offersTeams([review, todo], filter({ teams: new Set(["Operations"]) }))).toBe(true);
	});
});

describe("grouping", () => {
	const parent = ticket("ENG-10", { status: "In Progress", statusType: "started", project: "Login" });
	const child = ticket("ENG-11", { parentId: "ENG-10", priority: 1 });
	const shape = (grouping: Parameters<typeof groupedTickets>[0], tickets: readonly Ticket[]) =>
		groupedTickets(grouping, tickets).map(({ foldKey, heading, count, entries }) => [foldKey, heading?.title, count, entries.map(({ ticket: row, subIssues }) => [row.id, ...ids(subIssues)])]);

	test("by status, nests a sub-issue under its listed parent and folds by the status's name", () => {
		expect(shape("status", [parent, child, todo])).toEqual([
			["In Progress", "In Progress", 2, [["ENG-10", "ENG-11"]]],
			["Todo", "Todo", 1, [["ENG-3"]]],
		]);
	});

	test("a sub-issue whose parent the filter leaves out is a row of its own", () => {
		const shown = filteredTickets([parent, child], filter({ view: "todo" }), "", NOW);
		expect(shape("status", shown)).toEqual([["Todo", "Todo", 1, [["ENG-11"]]]]);
	});

	test("by priority, lists sub-issues flat under their own priority, urgent first, leaving out empty priorities", () => {
		expect(shape("priority", [parent, child, todo])).toEqual([
			["priority:1", "Urgent", 1, [["ENG-11"]]],
			["priority:3", "Medium", 1, [["ENG-10"]]],
			["priority:0", "No priority", 1, [["ENG-3"]]],
		]);
	});

	test("by project, by name with the issues in none last", () => {
		expect(shape("project", [parent, child, progress, backlog])).toEqual([
			["project:Billing", "Billing", 1, [["ENG-2"]]],
			["project:Login", "Login", 2, [["ENG-10"], ["OPS-4"]]],
			["project:", "No project", 1, [["ENG-11"]]],
		]);
	});

	test("under no grouping, one group without a heading in priority order, and none for no issue", () => {
		const groups = groupedTickets("none", [todo, parent, child]);
		expect(groups.map(({ heading }) => heading)).toEqual([null]);
		expect(ids(listedRows(groups))).toEqual(["ENG-11", "ENG-10", "ENG-3"]);
		expect(groupedTickets("none", [])).toEqual([]);
	});

	test("another grouping's fold keys never match a status's, so its folds start open", () => {
		const statusKeys = new Set(groupedTickets("status", everyTicket).map(({ foldKey }) => foldKey));
		for (const grouping of ["priority", "project", "none"] as const) for (const { foldKey } of groupedTickets(grouping, everyTicket)) expect(statusKeys.has(foldKey)).toBe(false);
	});
});
