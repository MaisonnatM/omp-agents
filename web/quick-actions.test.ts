import { describe, expect, test } from "bun:test";
import type { Ticket } from "../src/shared/tickets";
import { ticketActions, ticketStart } from "./quick-actions";

const ticket = (fields: Partial<Ticket>): Ticket => ({
	id: "ENG-7",
	title: "Show feedback",
	url: "https://linear.app/acme/issue/ENG-7/show-feedback",
	status: "Todo",
	statusType: "unstarted",
	priority: 3,
	labels: [],
	project: null,
	team: "Engineering",
	dueDate: null,
	createdAt: "2026-09-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:00:00.000Z",
	branch: "eng-7-show-feedback",
	...fields,
});

describe("ticketActions", () => {
	test("an issue not started yet offers work and a plan", () => {
		for (const statusType of ["triage", "backlog", "unstarted"] as const) expect(ticketActions(ticket({ statusType }))).toEqual(["work", "plan"]);
	});

	test("a started issue offers only work, which continues it", () => {
		expect(ticketActions(ticket({ statusType: "started", status: "In Review" }))).toEqual(["work"]);
	});

	test("a completed or canceled issue offers nothing", () => {
		expect(ticketActions(ticket({ statusType: "completed" }))).toEqual([]);
		expect(ticketActions(ticket({ statusType: "canceled" }))).toEqual([]);
	});
});

