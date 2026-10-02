import { describe, expect, test } from "bun:test";
import type { Ticket } from "../src/shared";
import { ticketGroups } from "./tickets-model";

describe("ticket groups", () => {
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
		updatedAt: "2026-10-01T10:00:00.000Z",
		branch: id.toLowerCase(),
		...fields,
	});
	const shape = (tickets: Ticket[]) => ticketGroups(tickets).map(({ status, tickets }) => [status, tickets.map(({ id }) => id)]);

	test("groups by state name, ordered by state type as Linear lists them, then by name", () => {
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
			["Triage", ["F"]],
			["In Progress", ["E"]],
			["In Review", ["C", "H"]],
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
});
