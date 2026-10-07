import { expect, test } from "bun:test";
import type { Ticket, TicketsAnswer } from "../src/shared/tickets";

const cachedTicket: Ticket = {
	id: "ENG-1",
	title: "Cached ticket",
	url: "https://linear.app/team/issue/ENG-1",
	status: "Todo",
	statusType: "unstarted",
	priority: 3,
	labels: [],
	project: null,
	team: "ENG",
	dueDate: null,
	createdAt: "2026-09-01T12:00:00.000Z",
	updatedAt: "2026-10-01T12:00:00.000Z",
	branch: "eng-1-cached-ticket",
};
const { createdAt: _createdAt, ...legacyTicket } = cachedTicket;
const refreshed: TicketsAnswer = {
	tickets: [{ ...cachedTicket, id: "ENG-2", title: "Fetched ticket", createdAt: "2026-10-06T12:00:00.000Z" }],
};

// A new process hydrates the real singleton without reusing another test's import or module mocks.
const scenario = String.raw`
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dayLabel } from "./labels.ts";

const cacheKey = "omp-agents.tickets-cache";
const memory = new Map([[cacheKey, process.env.TICKETS_CACHE]]);
const descriptors = ["localStorage", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	writable: true,
	value: {
		getItem: key => memory.get(key) ?? null,
		setItem: (key, value) => memory.set(key, value),
		removeItem: key => memory.delete(key),
		clear: () => memory.clear(),
		key: index => [...memory.keys()][index] ?? null,
		get length() { return memory.size; },
	},
});
globalThis.fetch = async () => new Response(process.env.TICKETS_FRESH, { status: 200 });
try {
	// A static import would hydrate the singleton before the test installs its storage.
	const { ticketsStore } = await import("./reads.ts");
	function TicketList() {
		const entry = ticketsStore.use();
		return createElement("span", null, entry.read
			? entry.read.data.tickets.map(ticket => ticket.id + " " + dayLabel(ticket.createdAt, new Date("2026-10-07T12:00:00.000Z"))).join(", ")
			: "loading");
	}
	const initial = renderToStaticMarkup(createElement(TicketList));
	await ticketsStore.refresh(null, { fresh: true });
	console.log(JSON.stringify({
		initial,
		refreshed: renderToStaticMarkup(createElement(TicketList)),
		persisted: JSON.parse(memory.get(cacheKey))[""].data,
	}));
} finally {
	for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
}
`;

test.each([
	{
		name: "a mixed current and legacy cache is discarded as a whole",
		tickets: [cachedTicket, { ...legacyTicket, id: "ENG-0" }],
		shown: false,
	},
	{
		name: "a cache with a non-string opening date is discarded as a whole",
		tickets: [cachedTicket, { ...cachedTicket, id: "ENG-0", createdAt: 42 }],
		shown: false,
	},
	{
		name: "a compatible cache remains immediately usable",
		tickets: [cachedTicket],
		shown: true,
	},
])("tickets cache: $name", async ({ tickets, shown }) => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], {
		cwd: import.meta.dir,
		env: {
			...process.env,
			TZ: "UTC",
			TICKETS_CACHE: JSON.stringify({ "": { data: { tickets }, at: 1 } }),
			TICKETS_FRESH: JSON.stringify(refreshed),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	const result = JSON.parse(stdout);
	if (shown) expect(result.initial).toMatch(/^<span>ENG-1 [^<]+<\/span>$/);
	else expect(result.initial).toBe("<span>loading</span>");
	expect(result.refreshed).toMatch(/^<span>ENG-2 [^<]+<\/span>$/);
	expect(result.persisted).toEqual(refreshed);
});
