import { describe, expect, test } from "bun:test";
import type { Ticket } from "../src/shared/tickets";
import { linearUrlOf, statusOrder, subIssueOrder, ticketGroups } from "./tickets-model";

const ticket = (id: string, fields: Partial<Ticket>): Ticket => ({
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

describe("ticket groups", () => {
	const shape = (tickets: Ticket[]) => ticketGroups(tickets).map(({ status, entries }) => [status, entries.map(({ ticket }) => ticket.id)]);

	test("groups by state name, with In Review first, then Linear's state-type order, then by name", () => {
		const groups = shape([
			ticket("A", { status: "Done", statusType: "completed" }),
			ticket("B", { status: "Backlog", statusType: "backlog" }),
			ticket("C", { status: "In Review", statusType: "started" }),
			ticket("D", { status: "Canceled", statusType: "canceled" }),
			ticket("E", { status: "In Progress", statusType: "started" }),
			ticket("F", { status: "Triage", statusType: "triage" }),
			ticket("G", {}),
			ticket("H", { status: "In Review", statusType: "started" }),
		]);
		expect(groups).toEqual([
			["In Review", ["C", "H"]],
			["Triage", ["F"]],
			["In Progress", ["E"]],
			["Todo", ["G"]],
			["Backlog", ["B"]],
			["Done", ["A"]],
			["Canceled", ["D"]],
		]);
	});

	test("orders a group urgent to low, then no priority, and the most recently updated first within a priority", () => {
		const groups = shape([
			ticket("none", { priority: 0, updatedAt: "2026-10-02T00:00:00.000Z" }),
			ticket("low", { priority: 4 }),
			ticket("medium-old", { priority: 3, updatedAt: "2026-09-01T00:00:00.000Z" }),
			ticket("urgent", { priority: 1 }),
			ticket("medium-new", { priority: 3, updatedAt: "2026-10-01T12:00:00.000Z" }),
			ticket("high", { priority: 2 }),
		]);
		expect(groups).toEqual([["Todo", ["urgent", "high", "medium-new", "medium-old", "low", "none"]]]);
	});

	test("nests a sub-issue under its topmost listed ancestor in that ancestor's group, and lists one whose parent is not listed on its own", () => {
		const groups = ticketGroups([
			ticket("ENG-10", { status: "In Progress", statusType: "started" }),
			ticket("ENG-12", { parentId: "ENG-10", status: "Done", statusType: "completed" }),
			ticket("ENG-11", { parentId: "ENG-10" }),
			ticket("ENG-13", { parentId: "ENG-11", status: "Backlog", statusType: "backlog" }),
			ticket("ENG-20", { parentId: "ENG-99" }),
		]);
		expect(groups.map(({ status, count, entries }) => [status, count, entries.map(({ ticket, subIssues }) => [ticket.id, subIssues.map(({ id }) => id)])])).toEqual([
			["In Progress", 4, [["ENG-10", ["ENG-11", "ENG-13", "ENG-12"]]]],
			["Todo", 1, [["ENG-20", []]]],
		]);
	});
});

describe("status order", () => {
	test("puts In Review first, then follows the page's groups, so the picker reads as the page does", () => {
		const statuses = [
			{ status: "Backlog", statusType: "backlog" },
			{ status: "Todo", statusType: "unstarted" },
			{ status: "In Progress", statusType: "started" },
			{ status: "Triage", statusType: "triage" },
			{ status: "In Review", statusType: "started" },
			{ status: "Blocked", statusType: "started" },
		] as const;
		expect(statuses.toSorted(statusOrder).map(({ status }) => status)).toEqual(["In Review", "Triage", "Blocked", "In Progress", "Todo", "Backlog"]);
	});
});

describe("sub-issue order", () => {
	test("follows the groups' status order, then the identifier's number, not its text", () => {
		const issues = [
			{ id: "ENG-100", status: "Todo", statusType: "unstarted" },
			{ id: "ENG-9", status: "Todo", statusType: "unstarted" },
			{ id: "ENG-50", status: "Done", statusType: "completed" },
			{ id: "ENG-70", status: "In Review", statusType: "started" },
		] as const;
		expect(issues.toSorted(subIssueOrder).map(({ id }) => id)).toEqual(["ENG-70", "ENG-9", "ENG-100", "ENG-50"]);
	});
});

describe("linear address", () => {
	test("takes the listed issue's own address, else one in a listed issue's workspace, else none", () => {
		const listed = [ticket("ENG-1", { url: "https://linear.app/acme/issue/ENG-1/fix-login" })];
		expect(linearUrlOf("ENG-1", listed)).toBe("https://linear.app/acme/issue/ENG-1/fix-login");
		expect(linearUrlOf("OPS-9", listed)).toBe("https://linear.app/acme/issue/OPS-9");
		expect(linearUrlOf("OPS-9", [])).toBeNull();
	});
});
