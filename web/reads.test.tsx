import { expect, test } from "bun:test";
import type { Ticket, TicketsAnswer } from "../src/shared/tickets";
import type { Analytics, AnalyticsRange } from "../src/shared/analytics";

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

function analytics(range: AnalyticsRange, requests: number): Analytics {
	return {
		range,
		sync: { phase: "idle", current: 1, total: 1, lastSyncedAt: 1, error: null },
		totals: { requests, failed: 0, tokens: { input: 100, output: 200, cacheRead: 0, cacheWrite: 0, total: 300 }, cost: 0.5, cacheRate: 0 },
		providers: [],
		series: [{ start: 1, tokens: 300, cost: 0.5, requests, providers: [] }],
		models: [],
		projects: [],
		agents: { main: 300, subagent: 0, advisor: 0 },
		tools: [],
		sessions: [],
	};
}

const analyticsScenario = String.raw`
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const cacheKey = "omp-agents.analytics-cache";
const memory = new Map([[cacheKey, process.env.ANALYTICS_CACHE]]);
globalThis.localStorage = {
	getItem: key => memory.get(key) ?? null,
	setItem: (key, value) => memory.set(key, value),
};
// Static imports would hydrate the cache before storage is installed in this fresh process.
const { analyticsStore } = await import("./reads.ts");
function Summary({ range }) {
	const entry = analyticsStore.use(range);
	return createElement("span", null, entry.read
		? entry.read.data.range + ":" + entry.read.data.totals.requests + ":" + (entry.error ? "failed" : "ok")
		: "loading");
}
const shown = range => renderToStaticMarkup(createElement(Summary, { range }));
const initial = [shown("24h"), shown("7d")];
globalThis.fetch = async () => new Response(process.env.ANALYTICS_FRESH);
await analyticsStore.refresh("24h");
const refreshed = [shown("24h"), shown("7d")];
globalThis.fetch = async () => new Response("unavailable", { status: 503 });
await analyticsStore.refresh("7d");
console.log(JSON.stringify({
	initial,
	refreshed,
	failed: shown("7d"),
	persisted: JSON.parse(memory.get(cacheKey)),
}));
`;

test.each([
	{ name: "cached ranges stay separate", data: analytics("24h", 12), shown: "<span>24h:12:ok</span>" },
	{ name: "a damaged token summary is discarded", data: { ...analytics("24h", 12), totals: { tokens: null } }, shown: "<span>loading</span>" },
	{ name: "a legacy chart without provider buckets is discarded", data: { ...analytics("24h", 12), series: [{ start: 1 }] }, shown: "<span>loading</span>" },
])("analytics cache: $name", async ({ data, shown }) => {
	const child = Bun.spawn([process.execPath, "--eval", analyticsScenario], {
		cwd: import.meta.dir,
		env: {
			...process.env,
			ANALYTICS_CACHE: JSON.stringify({ "24h": { data, at: 1 }, "7d": { data: analytics("7d", 31), at: 1 } }),
			ANALYTICS_FRESH: JSON.stringify(analytics("24h", 42)),
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
	expect(result.initial).toEqual([shown, "<span>7d:31:ok</span>"]);
	expect(result.refreshed).toEqual(["<span>24h:42:ok</span>", "<span>7d:31:ok</span>"]);
	expect(result.failed).toBe("<span>7d:31:failed</span>");
	expect(result.persisted["24h"].data.totals.requests).toBe(42);
	expect(result.persisted["7d"].data.totals.requests).toBe(31);
});
